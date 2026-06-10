/**
 * Stoop skill definitions — `defineSkill` shape.
 *
 * Migrated 2026-05-04 from the legacy `(args, ctx) => result` shape to
 * the SDK-native `({parts, from, agent}) => Parts[]` shape.  Handlers
 * register on a real `core.Agent` and dispatch via
 * `core.taskExchange.handleTaskRequest`.
 *
 * Wire convention: each skill takes a single `DataPart` whose `data`
 * field carries the JSON args, and returns a JSON object that
 * SkillRegistry auto-wraps into a single `DataPart` on the way out.
 *
 * `from` carries the caller's identifier:
 *   - In production over A2A this is `claims.sub` (a WebID URL).
 *   - In direct-handler tests it's whatever the test passes (typically
 *     a WebID for parity).
 *
 * `resolveMember` lives in `@canopy/identity-resolver`'s
 * `buildIdentitySkills` and is registered alongside these by Agent.js.
 *
 * Stoop V1 Phase 3 (2026-05-06) additions:
 *   - `postRequest` accepts `kind: 'ask'|'offer'|'lend'|'report'|string`
 *     (slots into `Item.type`) and `dueAt` (ms epoch, used by lend).
 *   - When `kind === 'lend'` AND `dueAt` is set AND a notifier is
 *     wired into the bundle, a return-reminder is scheduled via
 *     `notifier.scheduleBefore({ cancelKey: 'due:<itemId>' })`.
 *   - `markReturned({requestId})` cancels that reminder + completes
 *     the item.
 *   - `mutePeer({peerWebid})` / `unmutePeer({peerWebid})` /
 *     `listMutedPeers()` — local-only mute set; pure UI filter.
 *   - `reportPost({itemId, reason})` — appends a `kind: 'report'`
 *     item referencing the original.
 *   - `listOpen` / `listMyRequests` outputs hydrate each item's
 *     author into a `display: {handle, displayName?, isRevealed, render}`
 *     block when a `Reveals` store is wired.  Legacy callers without
 *     a reveals store get the raw item shape unchanged.
 */

import { defineSkill, validateMnemonic, mnemonicToSeed, AgentIdentity } from '@canopy/core';
import nacl from 'tweetnacl';
import { resolve as resolveMember } from '@canopy/identity-resolver';
import { validateCanonical } from '@canopy/item-types';
import { treeOf, createCrossPodRefResolver } from '@canopy/item-store';
import { validateStoopItem, intentToCanonicalDraft } from '../lib/canonicalAdapter.js';

import { validateHandle } from '../lib/handle.js';
import { getPrivacyNotice } from '../lib/privacyNotice.js';
import { categoryFor, TAXONOMY } from '../lib/skillsMatch.js';
import { findNearDuplicate } from '../lib/dupCheck.js';
import { encryptBackup, decryptBackup } from '../lib/encryptedBackup.js';
import { startPodSignIn, completePodSignIn, signOutOfPod, podSignInStatus } from '../lib/podSignIn.js';
import { loadSettings, updateSettings as updateSettingsLib } from '../lib/Settings.js';
import { geocode } from '../lib/geocode.js';
import { cellFor, distanceKm, snapToGrid, DISTANCE_PRESETS } from '../lib/geo.js';
import { resolve as resolveTargets, validateTarget, filterByDistance, filterMuted } from '../lib/targetResolver.js';
import {
  validateInboundAttachment,
  persistInboundAttachment,
  readAttachmentBytesB64,
  attachmentPath,
  toBroadcastShape,
  MAX_ATTACHMENTS_PER_POST,
  MAX_PRIKBORD_BYTES_PER_ATT,
  MAX_CHAT_BYTES_PER_ATT,
} from '../lib/Attachments.js';
import { update as updateInterest, score as scoreInterest, combinedRelevance } from '../lib/InterestProfile.js';
import { matchesProfile } from '../lib/skillsMatch.js';

/**
 * Cross-pod ref soft cap on `postRequest({embeds: [...]})`. Eight
 * keeps the prikbord card from overflowing while still allowing
 * "this offer touches several other items" use cases. A4 / V2
 * functional design §4b.
 */
const MAX_EMBEDS_PER_POST = 8;

function validateEmbed(e) {
  if (!e || typeof e !== 'object') return 'embed-not-object';
  if (typeof e.type !== 'string' || e.type.length === 0) return 'embed-type-missing';
  if (typeof e.ref  !== 'string' || e.ref.length  === 0) return 'embed-ref-missing';
  return null;
}

/**
 * A3 (2026-05-14) — storage policies (§II.2 of the standardisation plan).
 * The four canonical choices. `no-pod` is the V1-parity default.
 */
const STORAGE_POLICIES = ['no-pod', 'centralised', 'decentralised', 'hybrid'];

function _validateStoragePolicy(storagePolicy, groupPodUri) {
  if (typeof storagePolicy === 'undefined' || storagePolicy === null) return null;
  if (typeof storagePolicy !== 'string') return 'storage-policy-not-string';
  if (!STORAGE_POLICIES.includes(storagePolicy)) return `storage-policy-unknown:${storagePolicy}`;
  if (storagePolicy === 'centralised' || storagePolicy === 'hybrid') {
    if (typeof groupPodUri !== 'string' || groupPodUri.length === 0) {
      return `storage-policy-needs-groupPodUri:${storagePolicy}`;
    }
  }
  return null;
}

function _buildStoragePolicy(storagePolicy, groupPodUri) {
  const policy = (typeof storagePolicy === 'string' && STORAGE_POLICIES.includes(storagePolicy))
    ? storagePolicy
    : 'no-pod';
  if (policy === 'centralised' || policy === 'hybrid') {
    return { policy, groupPodUri };
  }
  return { policy };
}

const DEFAULT_TIMEOUT_MS = 30_000;
/** Default lead time for lend return reminders: 24 hours before dueAt. */
const DEFAULT_LEND_LEAD_MS = 24 * 60 * 60 * 1000;
/** Default channel id used to schedule lend reminders. Apps wire the channel into the notifier. */
const DEFAULT_LEND_CHANNEL = 'push';

/** Read the first DataPart's `data` from a Parts[] input. Defaults to `{}`. */
function dataArgs(parts) {
  if (!Array.isArray(parts)) return {};
  const dp = parts.find((p) => p?.type === 'DataPart');
  return dp?.data ?? {};
}

/**
 * Encode an object as a base64url-encoded compact JSON string —
 * the canonical body of `stoop-invite://` and `stoop-contact://`
 * QR/URL payloads.
 */
function _encodeQrPayload(obj) {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  const std = (typeof btoa === 'function')
    ? btoa(bin)
    : Buffer.from(bytes).toString('base64');
  return std.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** Inverse of `_encodeQrPayload`.  Returns null on parse failure. */
function _decodeQrPayload(b64url) {
  if (typeof b64url !== 'string' || !b64url) return null;
  const std = b64url.replaceAll('-', '+').replaceAll('_', '/');
  const pad = std + '='.repeat((4 - std.length % 4) % 4);
  try {
    const bin = (typeof atob === 'function') ? atob(pad) : Buffer.from(pad, 'base64').toString('binary');
    return JSON.parse(bin);
  } catch {
    return null;
  }
}

/**
 * Generate a fresh membership code — short, human-shareable string
 * (12 base64url chars ≈ 72 bits of entropy).  Used out-of-band as a
 * shared secret a new joiner presents to redeem their group proof.
 */
function _freshMembershipCode() {
  const bytes = new Uint8Array(9);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const std = (typeof btoa === 'function') ? btoa(bin) : Buffer.from(bytes).toString('base64');
  return std.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * Sync-envelope stub consumed by the chat-shell renderer (mirrors
 * folio's `simulateSync` so the `_sync` reply-envelope convention
 * works without a real pod-write round-trip).  Pure JS; no deps —
 * keeps `skills/index.js` portable per the node-portability
 * convention.
 */
function simulateSync() {
  return {
    plannedPaths:  [],
    durationMs:    0,
    bytesPushed:   0,
    bytesPulled:   0,
    conflictCount: 0,
    queueDepth:    0,
  };
}

/**
 * Decorate list items with `_lastSync` (epoch ms) so the chat-shell
 * renderer's per-row staleness badge has something to render.  Uses
 * the item's own `addedAt` as the most reasonable "freshness" stamp
 * we can produce without a real sync layer.  Items without an
 * `addedAt` get `Date.now()`.  Non-object entries are returned
 * unchanged.
 */
function decorateWithLastSync(items) {
  if (!Array.isArray(items)) return items;
  const now = Date.now();
  return items.map((it) => {
    if (!it || typeof it !== 'object') return it;
    return { ...it, _lastSync: it.addedAt ?? it.lastSentAt ?? now };
  });
}

/** Latest `kind: 'group-rules'` item for the given group. */
async function _findLatestGroupRules(store, groupId) {
  const all = await store.listOpen({ type: 'group-rules' });
  let latest = null;
  for (const it of all) {
    if (it.source?.groupId !== groupId) continue;
    if (!latest) { latest = it; continue; }
    const tsA = latest.addedAt ?? 0;
    const tsB = it.addedAt     ?? 0;
    if (tsB > tsA || (tsB === tsA && it.id > latest.id)) latest = it;
  }
  return latest;
}

/**
 * Latest `kind: 'membership-code'` item for the group whose
 * `expiresAt` is still in the future.  Returns null when no active
 * code exists (e.g. all expired).  Does NOT apply the 24h grace
 * window — callers that accept stale codes (redemption) check
 * `expiresAt + GRACE_MS` themselves.
 */
async function _findLatestActiveCode(store, groupId) {
  const all = await store.listOpen({ type: 'membership-code' });
  const now = Date.now();
  const forGroup = all
    .filter(i => i?.source?.groupId === groupId)
    .filter(i => (i.source.expiresAt ?? 0) > now);
  if (forGroup.length === 0) return null;
  // Latest issuedAt wins; tie-break on the item's ulid (monotonic
  // within the same ms) so back-to-back rotations resolve correctly.
  forGroup.sort((a, b) => {
    const tsDiff = (b.source.issuedAt ?? 0) - (a.source.issuedAt ?? 0);
    if (tsDiff !== 0) return tsDiff;
    return (b.id ?? '').localeCompare(a.id ?? '');
  });
  return forGroup[0];
}

/**
 * Resolve a mute / reveal target reference to the canonical key.
 * Phase 11 (2026-05-06): stableId wins; webid is back-compat.
 *
 * @param {{peerStableId?: string, peerWebid?: string}} args
 * @param {import('@canopy/identity-resolver').MemberMap} [members]
 * @returns {Promise<string | null>}
 */
async function _resolveMuteKey(args, members) {
  if (typeof args?.peerStableId === 'string' && args.peerStableId) {
    return args.peerStableId;
  }
  if (typeof args?.peerWebid === 'string' && args.peerWebid) {
    // Prefer the stableId when MemberMap knows the peer; otherwise
    // fall back to the webid as-is (a URL, which can't collide with
    // a base64url stableId — disambiguation by shape).
    if (members) {
      const m = await members.resolveByWebid(args.peerWebid);
      if (m?.stableId) return m.stableId;
    }
    return args.peerWebid;
  }
  return null;
}

/**
 * Hydrate a single item's `addedBy` (and any present `completedBy`,
 * `assignee`) into a `display` block via `identity-resolver.resolve()`.
 * No-op if `members` or `reveals` is missing — returns the raw item.
 *
 * **Substrate candidate (rule of two — first consumer):** when a
 * second app renders item-store items with handle/displayName-on-reveal
 * UX, promote `hydrateItem` / `hydrateItems` into
 * `@canopy/identity-resolver` itself (additive — likely a new
 * `hydrate(items, { memberMap, reveals, groupId })` helper).
 * Tracked in `Project Files/Substrates/substrate-candidates.md`.
 */
async function hydrateItem(item, { members, reveals, viewerWebid, groupId }) {
  if (!members || !reveals) return item;
  const out = { ...item };
  if (item.addedBy) {
    const d = await resolveMember({
      memberMap:   members,
      reveals,
      targetWebid: item.addedBy,
      groupId,
    });
    if (d) out.addedByDisplay = d;
  }
  if (item.completedBy) {
    const d = await resolveMember({
      memberMap:   members,
      reveals,
      targetWebid: item.completedBy,
      groupId,
    });
    if (d) out.completedByDisplay = d;
  }
  if (item.assignee) {
    const d = await resolveMember({
      memberMap:   members,
      reveals,
      targetWebid: item.assignee,
      groupId,
    });
    if (d) out.assigneeDisplay = d;
  }
  return out;
}

async function hydrateItems(items, ctx) {
  if (!ctx.members || !ctx.reveals) return items;
  return Promise.all(items.map((it) => hydrateItem(it, ctx)));
}

/**
 * @param {object} args
 * @param {import('@canopy/item-store').ItemStore} args.store
 * @param {import('@canopy/skill-match').SkillMatch} args.skillMatch
 * @param {object} [args.notifier]                            optional Notifier (lend reminders)
 * @param {object} [args.reveals]                             optional Reveals (author hydration)
 * @param {object} [args.members]                             optional MemberMap (author hydration)
 * @param {Set<string>} [args.muted]                          per-viewer mute set (local only)
 * @param {string} [args.localActor]                          this member's webid (used as recipient for lend reminders)
 * @returns {Array<object>} array of `defineSkill` definitions
 */
// Household sealed-pod membership hooks. Best-effort + gated: no-op without a control-agent (instances
// that don't run a sealed pod) or without the joiner's sealing public key. A failure here never breaks
// the membership audit — key management is recoverable, the redemption record is the source of truth.
async function grantPodAccess(controlAgent, { webId, sealingPublicKey, role = 'member', metrics }) {
  if (!controlAgent || !sealingPublicKey || !webId) return;
  try { await controlAgent.addMember({ webId, publicKey: sealingPublicKey, role }); }
  catch { metrics?.record?.('control-agent-grant-failed'); }
}
async function revokePodAccess(controlAgent, { webId, force = false, metrics }) {
  if (!controlAgent || !webId) return;
  try { await controlAgent.removeMember({ webId, force }); }
  catch { metrics?.record?.('control-agent-revoke-failed'); }
}

export function buildSkills({
  store,
  skillMatch,
  notifier,
  reveals,
  members,
  // Household sealed-pod control-agent (optional). When present, membership events drive pod
  // ACL + group-key grant/revoke: redeem → addMember (seal the group key to the joiner's sealing
  // public key, carried in the redemption item); leaveGroup → removeMember (revoke + rotate). Absent
  // on instances that don't run a sealed household pod — the calls are simply skipped (non-breaking).
  // The sealing key is a SEPARATE family from the member's transport identity (NKN/p2p/relay).
  controlAgent,
  muted,
  localActor,
  groupId: explicitGroupId,
  dataLocationConfig,
  chat,           // Phase 14: wireChat controller (chat.send / chat.detach)
  metrics,        // Phase 18: UsageMetrics; record() called from key handlers
  bundle,         // Phase 20: factory hands itself in for sign-in skills
  // ── Group-aware dispatch (single-agent refactor 2026-05-08) ────────────
  // When `getBundle` is supplied, every skill is wrapped: at dispatch
  // time the wrapper resolves the right per-group bundle from
  // `args.groupId` (or the envelope's pubsub topic) via getBundle, then
  // delegates to a per-group cached skill array built with that bundle's
  // store/members/skillMatch/etc.  Apps with multiple groups (Stoop
  // mobile, future Tasks-mobile) pass `getBundle`; single-bundle callers
  // (testbed, web Stoop) keep using the bundle args above.
  //
  // See `Project Files/Stoop/single-agent-refactor-2026-05-08.md`.
  getBundle,
}) {
  if (typeof getBundle === 'function') {
    return _buildScopedSkills({ getBundle, dataLocationConfig });
  }

  // SkillMatch's #group is private; Agent.js passes the configured
  // groupId through here so list-shaped skills can scope reveal lookups.
  const groupId = explicitGroupId ?? skillMatch?.group ?? null;

  return [
    /**
     * postRequest({text, intent?, kind?, requiredSkills?, dueAt?, timeoutMs?, expectClaims?})
     *
     * Records the post as an item, then broadcasts via L1e and waits for
     * claims.
     *
     * Phase 52.7.2 cut-over (2026-05-14): API input `intent` carries
     * the Stoop UI vocab ('ask' | 'offer' | 'lend' | 'request' |
     * 'report' | ...). Items are stored with the canonical
     * `@canopy/item-types` shape — `type` + `kind` — via the
     * translator in `lib/canonicalAdapter.js`. The optional `kind`
     * arg lets a future UI sub-choice ("Lenen / Iets klein om te
     * delen / Iets gratis krijgen") pin the canonical kind directly.
     *
     * For lend-shaped writes (`intent: 'lend'` / canonical
     * `item.kind === 'lend'`) with `dueAt` set + a notifier wired
     * into the bundle, schedules a return reminder via
     * `notifier.scheduleBefore({ cancelKey: 'due:<itemId>' })`.
     */
    defineSkill('postRequest', async ({ parts, from }) => {
      const a = dataArgs(parts);

      // Phase 27.1 — back-compat: legacy callers without `targets`
      // get the active group injected.
      const rawTargets = Array.isArray(a.targets) && a.targets.length > 0
        ? a.targets
        : (groupId ? [{ kind: 'group', groupId }] : []);
      const targets = rawTargets.filter(t => !validateTarget(t));

      const maxDistanceKm = (typeof a.maxDistanceKm === 'number' && a.maxDistanceKm > 0)
        ? a.maxDistanceKm : null;

      // Phase 52.7.2 cut-over — translate UI-vocab `intent` to
      // canonical {type, kind}. Bespoke intents (`report`, etc.)
      // pass through as `{type}` only.
      const canonicalDraft = intentToCanonicalDraft(a.intent, a.kind);

      // A4 (cross-pod refs, 2026-05-14) — `embeds: [{type, ref}, ...]`.
      // Each entry references another item (a Tasks task, a Folio note,
      // another Stoop post) — see V2 web functional design §4b.
      // Validated minimally here; the receiving substrate carries the
      // shape through. Max 8 entries to keep the UI sane.
      const inboundEmbeds = Array.isArray(a.embeds) ? a.embeds : [];
      if (inboundEmbeds.length > MAX_EMBEDS_PER_POST) {
        return { error: `embeds-too-many:${inboundEmbeds.length}` };
      }
      const embeds = [];
      for (const e of inboundEmbeds) {
        const err = validateEmbed(e);
        if (err) return { error: err };
        embeds.push({ type: e.type, ref: e.ref });
      }

      const itemDraft = {
        ...canonicalDraft,
        text:           a.text,
        requiredSkills: a.requiredSkills ?? [],
        visibility:     'household',
        // Phase 27 — store targets + maxDistanceKm on the item so
        // local UI can render them and receivers can re-check.
        source: {
          targets,
          maxDistanceKm,
          ...(embeds.length > 0 ? { embeds } : {}),
        },
      };
      if (typeof a.dueAt === 'number') itemDraft.dueAt = a.dueAt;

      const [item] = await store.addItems([itemDraft], { actor: from });

      // Phase 52.7.2 — warn-only canonical-shape validation. Stoop's
      // legacy `type` values ('ask'/'offer'/'lend'/'request') route
      // through a translator to the canonical taxonomy + kind enum;
      // bespoke types ('report' / 'membership-code' / etc.) skip.
      // Adoption is observational — never blocks a write.
      try {
        const v = validateStoopItem(item);
        if (v && v.ok === false) {
          console.warn(`item-types[${item.type}]:`, JSON.stringify(v.errors));
        }
      } catch { /* validator outage must not break writes */ }

      // Phase 39 — attachments.  When the client supplies one or
      // more inline-base64 image attachments, validate + persist
      // the bytes at `mem://stoop/items/<itemId>/attachments/...`,
      // and embed metadata (without the bytes) in the item's
      // `source.attachments` for both local rendering and the
      // broadcast payload.  Bytes never travel in the broadcast —
      // recipients see the thumbnail and click-to-fetch.
      const inboundAttachments = Array.isArray(a.attachments) ? a.attachments : [];
      const persistedAttachments = [];
      if (inboundAttachments.length > 0) {
        if (inboundAttachments.length > MAX_ATTACHMENTS_PER_POST) {
          return { error: `attachments-too-many:${inboundAttachments.length}` };
        }
        if (!bundle?.cache) {
          return { error: 'attachments-need-cache' };
        }
        for (const inbound of inboundAttachments) {
          const err = validateInboundAttachment(inbound, { maxBytes: MAX_PRIKBORD_BYTES_PER_ATT });
          if (err) return { error: err };
          const persisted = await persistInboundAttachment({
            dataSource: bundle.cache,
            itemId:     item.id,
            att:        inbound,
          });
          persistedAttachments.push(persisted);
        }
        // Patch the just-stored item record with the attachment
        // metadata.  ItemStore writes via `bundle.cache` under the
        // `mem://neighborhood/items/<id>.json` path; rewrite the
        // same key with the augmented source.
        item.source = { ...(item.source ?? {}), attachments: persistedAttachments };
        await bundle.cache.write(`mem://neighborhood/items/${item.id}.json`, JSON.stringify(item));
      }

      // Lend lifecycle: schedule a return reminder when applicable.
      // Phase 52.7.2 cut-over — canonical lends are
      // `{type: 'offer', kind: 'lend'}`; legacy `item.type === 'lend'`
      // disappears with the cut-over.
      if (notifier
          && item.kind === 'lend'
          && typeof item.dueAt === 'number') {
        const leadMs = typeof a.leadMs === 'number' ? a.leadMs : DEFAULT_LEND_LEAD_MS;
        const recipient = a.reminderRecipient ?? localActor ?? from;
        try {
          await notifier.scheduleBefore({
            dueAt:      item.dueAt,
            leadMs,
            recipient,
            channel:    a.reminderChannel ?? DEFAULT_LEND_CHANNEL,
            builder:    async () => ({
              text: `Reminder: '${item.text}' is due back ${new Date(item.dueAt).toISOString()}`,
            }),
            cancelKey:  `due:${item.id}`,
          });
        } catch {
          // Non-fatal — apps that haven't wired the requested channel
          // shouldn't see lend posts fail because of it.
        }
      }

      // ── Phase 27.3 sender-side filter ─────────────────────
      // Resolve targets → recipient set. Drop muted. Drop out-of-
      // range when maxDistanceKm + own location are set.  The
      // result drives both the group broadcast (when targets
      // include a 'group') AND the per-recipient direct fan-out
      // for non-group targets (Phase 27.4 wireup happens via chat
      // for now — direct fan-out is a future contactFanout module).
      const hasGroupTarget    = targets.some(t => t.kind === 'group');
      const hasNonGroupTarget = targets.some(t => t.kind !== 'group');

      let recipients = new Set();
      if (hasNonGroupTarget) {
        const r = await resolveTargets(targets.filter(t => t.kind !== 'group'),
          { members, contacts: bundle?.contacts, selfWebid: from });
        recipients = r.recipients;
        if (maxDistanceKm) {
          recipients = await filterByDistance(recipients, { members, selfWebid: from, maxDistanceKm });
        }
        if (muted) recipients = await filterMuted(recipients, muted, members);
      }

      // The broadcast target (group pubsub) carries the targets +
      // maxDistanceKm so receivers can re-validate. By default we
      // DON'T await broadcast results — posts go up immediately
      // and claims (if any) flow back via the substrate mirror +
      // the chat-based reply path (Phase 14).
      // Phase 40.20 (2026-05-08): caller can request a wider
      // broadcast audience via `scope: 'group+contacts' |
      // 'group+contacts+hops'`.  When the scope is wider than
      // 'group', the SkillMatch substrate also subscribes to the
      // user's `extraAudience` peers (resolved from ContactBook
      // entries / MemberMap hop-flags by the bundle bring-up).  The
      // `scope` field is published in the request payload so
      // receivers can apply a different sensitivity.
      const broadcastScope = (typeof a.scope === 'string'
        && ['group', 'group+contacts', 'group+contacts+hops'].includes(a.scope))
        ? a.scope
        : 'group';

      // The broadcast payload — shared between the legacy skill-match
      // pubsub fan-out (claim-flow) and the new substrate-mirror path
      // (Phase 52.9.2 / Q-B 2026-05-14).
      const broadcastPayload = {
        requestId: item.id,
        text:      item.text,
        from,
        // Phase 52.7.2 cut-over — send canonical `type` + `kind`
        // (was `kind: item.type` in legacy shape; receivers
        // reconstructed items with `type: kind`).
        type:      item.type,
        kind:      item.kind ?? null,
        dueAt:     item.dueAt,
        categoryId:  a.categoryId  ?? null,
        skillTags:   Array.isArray(a.skillTags) ? a.skillTags : [],
        // Phase 27 — pass targets + distance through so
        // receivers can re-check (functional design § 4f).
        targets,
        maxDistanceKm,
        // Phase 39 — attachment metadata + thumbnails (no
        // full bytes).  Recipients render the thumbnails and
        // request the full bytes on demand via `requestAttachment`.
        attachments: toBroadcastShape(persistedAttachments),
        // A4 (2026-05-14) — cross-pod refs travel with the broadcast.
        ...(embeds.length > 0 ? { embeds } : {}),
        requiredSkills: a.requiredSkills ?? [],
      };

      // Phase 52.9.2 / Q-B (2026-05-14) — substrate-mirror fan-out.
      // The legacy `groupMirror` pubsub-tap retired in favour of
      // `notify-envelope` + `pseudo-pod` (kind=`request` envelopes).
      // We dual-publish: `skillMatch.broadcast` still runs the
      // claim-flow on the pubsub topic; the substrate path replicates
      // the post into every group member's local pseudo-pod with the
      // Q-D Lamport version compare on receive.
      const substrateMirror   = bundle?.mirror;
      const substratePseudo   = bundle?.pseudoPod;
      const substrateEnvelope = bundle?.notifyEnvelope;
      const substrateDeviceId = bundle?.substrateDeviceId;
      if (hasGroupTarget && substratePseudo && substrateEnvelope && substrateDeviceId && groupId) {
        const substrateRecipients = substrateMirror?.getPeers?.() ?? [];
        if (substrateRecipients.length > 0) {
          // `fromActor` carries the publisher's pubKey (agent address),
          // not the webid. substrateMirror copies it into the mirrored
          // item's `source.fromPubKey` — same shape legacy groupMirror
          // produced (where pubKey came from the pubsub topic owner).
          const publisherPubKey = bundle?.agent?.address ?? null;
          (async () => {
            try {
              const uri = `pseudo-pod://${substrateDeviceId}/stoop/${groupId}/requests/${item.id}`;
              const { etag, _v } = await substratePseudo.write(uri, broadcastPayload);
              await substrateEnvelope.publish({
                type:       'request',
                ref:        uri,
                payload:    broadcastPayload,
                etag,
                _v,
                recipients: substrateRecipients,
                ...(publisherPubKey ? { fromActor: publisherPubKey } : {}),
                crewId:     groupId,
              });
            } catch (_err) {
              // best-effort fan-out (parity with skillMatch.broadcast)
            }
          })();
        }
      }

      const broadcastP = hasGroupTarget
        ? skillMatch.broadcast({
            requiredSkills: a.requiredSkills ?? [],
            payload:        broadcastPayload,
            timeoutMs:      a.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            expectClaims:   a.expectClaims ?? 0,
            scope:          broadcastScope,
          }).catch(() => ({ claims: [] }))
        : Promise.resolve({ claims: [] });

      // Direct fan-out to non-group recipients via chat envelopes
      // — receiver-side wireChat in contactFanout (Phase 27.4) will
      // store + filter.  Subtype 'broadcast-post' carries the post
      // metadata; receivers reconstruct the item locally.
      if (recipients.size > 0 && chat?.send) {
        for (const w of recipients) {
          chat.send({
            toWebid:  w,
            subtype:  'broadcast-post',
            extras: {
              postId:        item.id,
              attachments:   toBroadcastShape(persistedAttachments),
              text:          item.text,
              // Phase 52.7.2 cut-over — canonical type + kind.
              type:          item.type,
              kind:          item.kind ?? null,
              dueAt:         item.dueAt ?? null,
              targets,
              maxDistanceKm,
              categoryId:    a.categoryId   ?? null,
              skillTags:     Array.isArray(a.skillTags) ? a.skillTags : [],
              requiredSkills: a.requiredSkills ?? [],
            },
          }).catch(() => { /* fire-and-forget */ });
        }
      }

      // Phase 52.7.2 cut-over (2026-05-14): tag by canonical `kind`
      // when present (more informative than `type` alone — both
      // 'offer'+'lend' intents collapse to type:'offer' after the
      // cut-over). Bespoke types (report, etc.) carry no kind, so
      // fall back to `type` for them.
      metrics?.record?.(`post-${item.kind ?? item.type}`);
      if (recipients.size > 0) metrics?.record?.('post-fanned-out');

      if (typeof a.expectClaims === 'number' && a.expectClaims > 0) {
        const result = await broadcastP;
        return { requestId: item.id, claims: result.claims, _sync: simulateSync() };
      }
      // Don't leave an unhandled rejection sitting around.
      void broadcastP;
      return { requestId: item.id, claims: [], _sync: simulateSync() };
    }, {
      description: 'Post an item (ask/offer/lend) and broadcast it; returns immediately. Pass `expectClaims > 0` to wait for claims.',
      visibility:  'authenticated',
    }),

    /**
     * acceptResponder({requestId, responderWebid})
     * Requester picks a claim's responder; CAS to set assignee, then complete.
     */
    defineSkill('acceptResponder', async ({ parts, from }) => {
      const a = dataArgs(parts);
      const current = await store.getById(a.requestId);
      if (!current) return { error: 'not-found' };
      if (current.completedAt) return { error: 'already-fulfilled', current };

      const claimResult = await store.claim(a.requestId, { actor: a.responderWebid });
      if (claimResult.error) {
        return { error: 'already-fulfilled', current: claimResult.current };
      }
      const [completed] = await store.markComplete(
        [{ id: a.requestId }],
        { actor: from },
      );
      metrics?.record?.('accept-responder');
      return { request: completed, _sync: simulateSync() };
    }, {
      description: 'Mark a request as fulfilled by a chosen responder.',
      visibility:  'authenticated',
    }),

    /**
     * cancelRequest({requestId})
     */
    defineSkill('cancelRequest', async ({ parts, from }) => {
      const a = dataArgs(parts);
      const [id] = await store.removeItems(
        [{ id: a.requestId }],
        { actor: from },
      );
      // Also cancel any lend reminder if one was scheduled.
      if (notifier) {
        try { await notifier.cancel(`due:${a.requestId}`); } catch {}
      }
      metrics?.record?.('cancel-request');
      return { id, _sync: simulateSync() };
    }, {
      description: 'Cancel an open request.',
      visibility:  'authenticated',
    }),

    /**
     * listMyRequests({})  — open requests posted by `from`.
     */
    defineSkill('listMyRequests', async ({ from }) => {
      const open = await store.listOpen();
      const mine = open.filter((i) => i.addedBy === from);
      const items = await hydrateItems(mine, { members, reveals, viewerWebid: from, groupId });
      return { items: decorateWithLastSync(items), _sync: simulateSync() };
    }, {
      description: 'List open requests posted by the calling actor.',
      visibility:  'authenticated',
    }),

    /**
     * listOpen({skill?, intent?})  — open requests, optionally filtered.
     *
     * Phase 52.7.2 cut-over (2026-05-14): `intent` filter accepts the
     * Stoop UI vocab ('ask' | 'offer' | 'lend' | 'request' | 'report'
     * | …) and is mapped to a canonical `{type, kind?}` filter under
     * the hood:
     *
     *   - 'ask'     → type=request (any kind)
     *   - 'offer'   → type=offer, kind=give     (excludes lends)
     *   - 'lend'    → type=offer, kind=lend
     *   - 'request' → type=request (legacy fallback)
     *   - 'report'  → type=report (bespoke; pass-through)
     *   - other     → type=<intent>             (bespoke pass-through)
     *
     * Item-store's `listOpen` only filters by `type`; the `kind`
     * post-filter happens in JS.
     */
    defineSkill('listOpen', async ({ parts, from }) => {
      const a = dataArgs(parts);
      const filter = {};
      if (a.skill) filter.requiredSkill = a.skill;
      let kindPostFilter = null;
      if (a.intent) {
        const canon = intentToCanonicalDraft(a.intent);
        filter.type = canon.type;
        // For 'offer' intent we narrow to kind:give (the "Aanbod"
        // tab); for 'lend' we narrow to kind:lend. Other intents
        // ('ask', 'request', 'report', bespoke) match by `type`
        // alone — no kind narrowing.
        if (a.intent === 'offer' || a.intent === 'lend') {
          kindPostFilter = canon.kind;
        }
      }
      const open = await store.listOpen(filter);
      const matched = kindPostFilter
        ? open.filter((it) => it.kind === kindPostFilter)
        : open;
      const items = await hydrateItems(matched, { members, reveals, viewerWebid: from, groupId });
      return { items: decorateWithLastSync(items), _sync: simulateSync() };
    }, {
      description: 'List open requests; optional `skill` + `intent` filters.',
      visibility:  'authenticated',
    }),

    /**
     * stoop_briefSummary()  — Q30 contributor for canopy-chat's /brief
     * aggregator.  Declared by `listOpen.surfaces.chat.brief` in the
     * stoop manifest.  Mirrors folio's `folio_briefSummary` shape:
     * returns `{ok: true}` when no open posts exist (brief.js skips
     * that section) or `{items, message}` listing the topmost rows +
     * a count.  Takes no args.
     */
    defineSkill('stoop_briefSummary', async () => {
      const open = await store.listOpen();
      if (!open || open.length === 0) {
        return { ok: true };          // brief.js's isEmpty skips this section
      }
      return {
        items:   open.slice(0, 3).map((it) => ({
          id:    it.id,
          label: it.text ?? it.id,
        })),
        message: `${open.length} buurt request${open.length === 1 ? '' : 's'}`,
      };
    }, {
      description: 'Q30 brief-summary contributor: open-posts count + topmost rows.',
      visibility:  'authenticated',
    }),

    /**
     * getItemTree({itemId})  — Phase 3.3c decentralised cross-pod read.
     *
     * Walks the item's `embeds`/`dependencies` graph via item-store's
     * `treeOf`, resolving the 3 canonical cross-pod ref shapes
     * (`urn:dec:item:` → local, `pseudo-pod://` → pseudo-pod ring,
     * `http(s)://` → another member's pod) through
     * `createCrossPodRefResolver`. Permission failures surface as
     * `{source:'placeholder', reason:'PERMISSION_DENIED'}` nodes (the
     * cross-pod-refs.md three-tier render fallback), never throwing.
     *
     * Agent-side by design: Stoop web + mobile are both thin A2A
     * clients, so the walk lives here and serves BOTH equally — one
     * device-independent path (the platform-parity principle). Stoop
     * *emits* embeds (`postRequest`) but did not *walk* them until now.
     */
    defineSkill('getItemTree', async ({ parts }) => {
      const a = dataArgs(parts);
      if (typeof a.itemId !== 'string' || !a.itemId) return { error: 'itemId required' };

      // `treeOf` reads top-level `embeds`/`dependencies`; Stoop
      // persists them under `source.*`. Bridge both shapes.
      const getItem = async (id) => {
        const it = await store.getById(id);
        if (!it) return null;
        return {
          ...it,
          embeds:       it.embeds       ?? it.source?.embeds       ?? [],
          dependencies: it.dependencies ?? it.source?.dependencies ?? [],
        };
      };

      const pseudoPodRead = typeof bundle?.pseudoPod?.read === 'function'
        ? (ref) => bundle.pseudoPod.read(ref)
        : undefined;

      const resolveExternalRef = createCrossPodRefResolver({
        getItem,
        pseudoPodRead,
        // V1 public fetch — ACP-protected refs return 401/403 →
        // PERMISSION_DENIED placeholder (the designed 3-tier render).
        podFetch: (url) => fetch(url, {
          headers: { Accept: 'application/json, text/turtle;q=0.5' },
        }),
      });

      try {
        const tree = await treeOf({ rootId: a.itemId, getItem, resolveExternalRef });
        return { tree };
      } catch (err) {
        return { error: err?.message ?? String(err) };
      }
    }, {
      description: 'Walk an item\'s embeds/deps tree, materialising cross-pod refs (Phase 3.3c decentralised read path).',
      visibility:  'authenticated',
    }),

    // ── Stoop V1 Phase 3 (2026-05-06) additions ────────────────────────────
    //
    // **Substrate candidate (rule of two — first consumer):** the
    // moderation skill set below (`mutePeer`/`unmutePeer`/`listMutedPeers`,
    // `reportPost`, plus the deferred `removeMember`, `leaveGroup`,
    // `setMemberRole`, `requestProofRefresh`) is generic to any
    // closed-group SDK app.  When the second app (likely `apps/household`,
    // `apps/archive`, or `apps/tasks-v0`) needs these, extract into
    // `@canopy/group-mod`.  Tracked in
    // `Project Files/Substrates/substrate-candidates.md`.

    /**
     * assignLend({itemId, borrowerWebid})  — record who currently has the lent item.
     *
     * Different shape from `acceptResponder` (which marks the item
     * complete — appropriate for a one-shot ask/offer).  A lend
     * stays *open* until `markReturned`; assignLend just stamps the
     * `assignee` + `claimedAt` so the board can show "uitgeleend
     * aan Bob" without closing the listing.
     *
     * Composes `item-store.claim`'s CAS — race-safe between two
     * borrowers grabbing the same item.
     */
    defineSkill('assignLend', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.itemId        !== 'string' || !a.itemId)        return { error: 'itemId required' };
      if (typeof a.borrowerWebid !== 'string' || !a.borrowerWebid) return { error: 'borrowerWebid required' };

      const current = await store.getById(a.itemId);
      if (!current)              return { error: 'not-found' };
      if (current.type !== 'lend') return { error: 'not-a-lend' };
      if (current.completedAt)   return { error: 'already-returned', current };

      const claimResult = await store.claim(a.itemId, { actor: a.borrowerWebid });
      if (claimResult.error) {
        return { error: 'already-assigned', current: claimResult.current };
      }
      return { item: claimResult, by: from, _sync: simulateSync() };
    }, {
      description: 'Assign a lent item to a borrower without closing it.',
      visibility:  'authenticated',
    }),

    /**
     * markReturned({requestId})  — close out a lend.
     * Cancels the scheduled return reminder + marks the item complete.
     */
    defineSkill('markReturned', async ({ parts, from }) => {
      const a = dataArgs(parts);
      // 2026-05-27 slash audit close-out — accept the user-facing slash
      // arg name `itemId` as an alias for `requestId`.  Real stoop
      // manifest declares the slash shape `/lend-return <itemId>`, so
      // typing `/lend-return abc` historically failed with "requestId
      // required" (surprising — the slash help says `<itemId>`).  Now
      // either arg name reaches this skill cleanly.
      const id = a.requestId ?? a.itemId;
      if (typeof id !== 'string' || !id) return { error: 'requestId required' };
      const current = await store.getById(id);
      if (!current) return { error: 'not-found' };
      if (current.completedAt) return { error: 'already-returned', current };

      if (notifier) {
        try { await notifier.cancel(`due:${id}`); } catch {}
      }
      const [completed] = await store.markComplete(
        [{ id }],
        { actor: from },
      );
      metrics?.record?.('mark-returned');
      return { item: completed, _sync: simulateSync() };
    }, {
      description: 'Mark a lend item as returned; cancels its return reminder.',
      visibility:  'authenticated',
    }),

    /**
     * reportPost({itemId, reason?})  — append a `kind: 'report'` item.
     */
    defineSkill('reportPost', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.itemId !== 'string' || !a.itemId) {
        return { error: 'itemId required' };
      }
      const [report] = await store.addItems(
        [{
          type:        'report',
          text:        a.reason ? `Report on ${a.itemId}: ${a.reason}` : `Report on ${a.itemId}`,
          source:      { reportTarget: a.itemId, reason: a.reason ?? null },
          visibility:  'household',
        }],
        { actor: from },
      );
      metrics?.record?.('report-post');
      return { reportId: report.id, _sync: simulateSync() };
    }, {
      description: 'File a report on another item; visible to admins of the group.',
      visibility:  'authenticated',
    }),

    /**
     * mutePeer({peerStableId | peerWebid})  — local-only filter; never broadcast.
     *
     * Stoop V1 Phase 11 migration: prefer `peerStableId` (survives
     * the peer's handle changes + network-pubkey rotation + pod
     * absence).  `peerWebid` still accepted for back-compat — looked
     * up in MemberMap and stored as the corresponding stableId when
     * one is known; otherwise stored as `webid:<webid>` so old
     * callers' state survives without losing entries.
     */
    defineSkill('mutePeer', async ({ parts }) => {
      const a = dataArgs(parts);
      const key = await _resolveMuteKey(a, members);
      if (!key) return { error: 'peerStableId or peerWebid required' };
      muted?.add(key);
      metrics?.record?.('mute-peer');
      return { muted: key, _sync: simulateSync() };
    }, {
      description: 'Locally mute a peer (does not affect anyone else). Prefer peerStableId; peerWebid back-compat.',
      visibility:  'authenticated',
    }),

    /**
     * unmutePeer({peerStableId | peerWebid})
     */
    defineSkill('unmutePeer', async ({ parts }) => {
      const a = dataArgs(parts);
      const key = await _resolveMuteKey(a, members);
      if (!key) return { error: 'peerStableId or peerWebid required' };
      const had = muted?.delete(key) ?? false;
      return { unmuted: key, had, _sync: simulateSync() };
    }, {
      description: 'Reverse a local mute.',
      visibility:  'authenticated',
    }),

    /**
     * listMutedPeers() — returns the raw mute keys (mostly stableIds;
     * legacy entries may be `webid:<webid>` for callers that pre-date
     * the Phase 11 migration).
     */
    defineSkill('listMutedPeers', async () => {
      return { peers: muted ? [...muted] : [], _sync: simulateSync() };
    }, {
      description: 'List locally muted peer keys (stableId, or "webid:<webid>" for legacy entries).',
      visibility:  'authenticated',
    }),

    // ── Stoop V1 Phase 6 (2026-05-06) — handle / displayName / reveal ─────

    /**
     * setMyHandle({handle})  — validate + upsert into MemberMap.
     *
     * Normalises (lowercases, strips leading `@`).  Does NOT broadcast
     * to other group members; pod-side propagation is the app's
     * concern (Phase 4 cache writes the MemberMap snapshot, the pod's
     * group-config blob is rebuilt on admin's next save).
     */
    defineSkill('setMyHandle', async ({ parts, from }) => {
      const a = dataArgs(parts);
      const v = validateHandle(a.handle ?? '');
      if (!v.ok) return { error: 'invalid-handle', reason: v.reason };
      if (!members) return { error: 'no-member-map' };
      const updated = await members.addMember({ webid: from, handle: v.handle });
      return { handle: v.handle, member: updated, _sync: simulateSync() };
    }, {
      description: 'Set the calling actor\'s handle (lowercase, 3–32 chars).',
      visibility:  'authenticated',
    }),

    /**
     * setMySkills({skills: [{categoryId, freeTags?, availability?, radius?, status?}, ...]})
     *   — replace the calling actor's full skills array.  Each item
     *   picks a `categoryId` from the fixed taxonomy (Phase 12).
     *   `status` defaults to `'active'`.
     */
    defineSkill('setMySkills', async ({ parts, from }) => {
      const a = dataArgs(parts);
      // 2026-05-27 slash audit close-out — the chat-shell's slash
      // surface declares `skills` as `kind: 'string'` (consumer
      // JSON-encodes the array).  Accept the JSON-string handoff:
      // parse-then-validate so `/skills [{...}]` reaches the skill
      // without the LLM-tool-call (`kind: 'json'` grammar extension is
      // tracked as a separate follow-up — see slash-audit doc).
      let skillsArr = a.skills;
      if (typeof skillsArr === 'string') {
        try { skillsArr = JSON.parse(skillsArr); }
        catch { return { error: 'skills array required' }; }
      }
      if (!Array.isArray(skillsArr)) return { error: 'skills array required' };
      if (!members) return { error: 'no-member-map' };
      const me = (await members.resolveByWebid(from)) ?? { webid: from };
      const updated = await members.addMember({ ...me, skills: skillsArr });
      return { skills: updated.skills, _sync: simulateSync() };
    }, {
      description: 'Replace the calling actor\'s skills array.',
      visibility:  'authenticated',
    }),

    /**
     * addMySkill({categoryId, freeTags?, availability?, radius?, status?})
     *   — append (or update if same categoryId) one skill to the
     *   calling actor's profile.
     */
    defineSkill('addMySkill', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.categoryId !== 'string' || !a.categoryId) {
        return { error: 'categoryId required' };
      }
      if (!members) return { error: 'no-member-map' };
      const me = (await members.resolveByWebid(from)) ?? { webid: from };
      const existing = Array.isArray(me.skills) ? me.skills : [];
      const filtered = existing.filter(s => s.categoryId !== a.categoryId);
      filtered.push({
        categoryId:   a.categoryId,
        freeTags:     Array.isArray(a.freeTags) ? a.freeTags : [],
        availability: a.availability ?? null,
        radius:       a.radius ?? null,
        status:       a.status ?? 'active',
      });
      const updated = await members.addMember({ ...me, skills: filtered });
      return { skills: updated.skills, _sync: simulateSync() };
    }, {
      description: 'Add or update one skill on the calling actor\'s profile.',
      visibility:  'authenticated',
    }),

    /**
     * removeMySkill({categoryId})
     *   — drop a skill from the calling actor's profile.
     */
    defineSkill('removeMySkill', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.categoryId !== 'string' || !a.categoryId) {
        return { error: 'categoryId required' };
      }
      if (!members) return { error: 'no-member-map' };
      const me = (await members.resolveByWebid(from)) ?? { webid: from };
      const existing = Array.isArray(me.skills) ? me.skills : [];
      const next = existing.filter(s => s.categoryId !== a.categoryId);
      const updated = await members.addMember({ ...me, skills: next });
      return { skills: updated.skills, _sync: simulateSync() };
    }, {
      description: 'Remove a skill from the calling actor\'s profile.',
      visibility:  'authenticated',
    }),

    /**
     * listMySkills() — diagnostic / settings UI.
     */
    defineSkill('listMySkills', async ({ from }) => {
      if (!members) return { skills: [], _sync: simulateSync() };
      const me = await members.resolveByWebid(from);
      return { skills: me?.skills ?? [], _sync: simulateSync() };
    }, {
      description: 'List the calling actor\'s skills.',
      visibility:  'authenticated',
    }),

    /**
     * setHolidayMode({on})  — Phase 23.4.
     *   Cross-device holiday-mode flag.  When `on: true`, skill-match
     *   routes around me + the board shows a top banner.  Persists
     *   via MemberMapCache (so it sticks across restart and syncs to
     *   a connected pod).  Doesn't touch per-skill `status` — those
     *   stay where the user left them.
     */
    defineSkill('setHolidayMode', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.on !== 'boolean') return { error: 'on (bool) required' };
      if (!members) return { error: 'no-member-map' };
      const me = (await members.resolveByWebid(from)) ?? { webid: from };
      const updated = await members.addMember({ ...me, holidayMode: a.on });
      return { holidayMode: updated.holidayMode, _sync: simulateSync() };
    }, {
      description: 'Toggle the calling actor\'s holiday-mode flag (cross-device).',
      visibility:  'authenticated',
    }),

    /**
     * getHolidayMode()  — Phase 23.4.  Read the calling actor's flag.
     */
    defineSkill('getHolidayMode', async ({ from }) => {
      if (!members) return { holidayMode: false };
      const me = await members.resolveByWebid(from);
      return { holidayMode: me?.holidayMode === true };
    }, {
      description: 'Read the calling actor\'s holiday-mode flag.',
      visibility:  'authenticated',
    }),

    /**
     * listSkillCategories({lang?})
     *   — return the taxonomy categories for UI dropdowns.  Lang
     *   defaults to NL.  Lib: `apps/stoop/src/lib/skillsTaxonomy.json`.
     */
    defineSkill('listSkillCategories', async ({ parts }) => {
      const a = dataArgs(parts);
      const lang = a.lang === 'en' ? 'en' : 'nl';
      return {
        categories: TAXONOMY.categories.map(c => ({
          id:    c.id,
          label: c.label[lang] ?? c.label.nl,
          hint:  c.hint?.[lang] ?? c.hint?.nl ?? '',
        })),
      };
    }, {
      description: 'Return the Stoop V1 skill-category taxonomy with localised labels.',
      visibility:  'authenticated',
    }),

    /**
     * suggestCategory({text})
     *   — Layer-1 matcher: extract a category + canonical tags from
     *   free-text post body.  Pure dictionary lookup; <1ms.
     */
    defineSkill('suggestCategory', async ({ parts }) => {
      const a = dataArgs(parts);
      if (typeof a.text !== 'string') return { categoryId: null, tags: [] };
      return categoryFor(a.text);
    }, {
      description: 'Suggest a skill category + canonical tags for a post body.',
      visibility:  'authenticated',
    }),

    /**
     * setMyDisplayName({displayName})  — opt-in real / chosen name.
     *
     * Visible only to peers / groups where the viewer has flipped a
     * Reveals flag; defaults to invisible.
     */
    defineSkill('setMyDisplayName', async ({ parts, from }) => {
      const a = dataArgs(parts);
      const name = typeof a.displayName === 'string' ? a.displayName.trim() : '';
      if (!name) return { error: 'displayName required' };
      if (!members) return { error: 'no-member-map' };
      const updated = await members.addMember({ webid: from, displayName: name });
      return { displayName: name, member: updated, _sync: simulateSync() };
    }, {
      description: 'Set the calling actor\'s display name (revealed to peers who opted in).',
      visibility:  'authenticated',
    }),

    /**
     * setMyAvatarUrl({url})  — Phase 23.1.
     *   Wire the calling actor's `avatarUrl` field on MemberMap. URL
     *   convention is `mem://stoop/avatars/<webid>.<ext>` for content
     *   stored in the local cache; once a pod is attached, the cache
     *   write-through stages the same path under
     *   `<pod>/stoop/avatars/...`.  Apps that don't follow the
     *   `mem://stoop/avatars/` convention can pass any URI — Stoop
     *   doesn't fetch or validate the content here, only stores the
     *   reference.
     */
    defineSkill('setMyAvatarUrl', async ({ parts, from }) => {
      const a = dataArgs(parts);
      const url = typeof a.url === 'string' ? a.url.trim() : '';
      if (!url) return { error: 'url required' };
      if (!members) return { error: 'no-member-map' };
      const updated = await members.addMember({ webid: from, avatarUrl: url });
      return { avatarUrl: url, member: updated, _sync: simulateSync() };
    }, {
      description: 'Set the calling actor\'s avatar URL (mem://stoop/avatars/<webid>.<ext> by convention).',
      visibility:  'authenticated',
    }),

    /**
     * clearMyAvatar()  — Phase 23.1.  Reset the calling actor's
     * `avatarUrl` to null on MemberMap.  No content delete here —
     * leave the bytes in the cache; a future "compactor" can sweep
     * orphaned avatars.
     */
    defineSkill('clearMyAvatar', async ({ from }) => {
      if (!members) return { error: 'no-member-map' };
      const me = (await members.resolveByWebid(from)) ?? { webid: from };
      const updated = await members.addMember({ ...me, avatarUrl: null });
      return { cleared: true, member: updated, _sync: simulateSync() };
    }, {
      description: 'Clear the calling actor\'s avatar URL (does not delete cached bytes).',
      visibility:  'authenticated',
    }),

    /**
     * setPeerReveal({peerWebid, showDisplayName?: bool=true})
     *   — local-only viewer choice; flips Reveals so this viewer
     *   sees `displayName` for the named peer.
     *
     * No mutual-consent enforcement: each side controls its own view
     * (per the Phase 6 design — symmetric, no auto-reveal).  Apps
     * that want a "shall we both reveal?" handshake compose this
     * skill on top of `chat-agent`'s MessagingBridge.
     */
    defineSkill('setPeerReveal', async ({ parts }) => {
      const a = dataArgs(parts);
      if (typeof a.peerWebid !== 'string' || !a.peerWebid) {
        return { error: 'peerWebid required' };
      }
      if (!reveals) return { error: 'no-reveals' };
      const show = a.showDisplayName ?? true;
      reveals.setPeerReveal(a.peerWebid, !!show);
      return { peerWebid: a.peerWebid, showDisplayName: !!show, _sync: simulateSync() };
    }, {
      description: 'Locally flip "show real name" for a single peer.',
      visibility:  'authenticated',
    }),

    /**
     * getMyReveals()  — enumerate "what have I revealed so far?"
     *   Pairs with `setPeerReveal` / `setGroupReveal` for management UI.
     */
    defineSkill('getMyReveals', async () => {
      if (!reveals) return { error: 'no-reveals' };
      return reveals.list();
    }, {
      description: 'List the calling viewer\'s current per-group + per-peer reveal flags.',
      visibility:  'authenticated',
    }),

    /**
     * setGroupReveal({groupId, showDisplayName?: bool=true})
     *   — local-only viewer choice; flips Reveals so this viewer
     *   sees `displayName` for every member of the group (peer-level
     *   overrides still win when set).
     */
    defineSkill('setGroupReveal', async ({ parts }) => {
      const a = dataArgs(parts);
      if (typeof a.groupId !== 'string' || !a.groupId) {
        return { error: 'groupId required' };
      }
      if (!reveals) return { error: 'no-reveals' };
      const show = a.showDisplayName ?? true;
      reveals.setGroupReveal(a.groupId, !!show);
      return { groupId: a.groupId, showDisplayName: !!show, _sync: simulateSync() };
    }, {
      description: 'Locally flip "show real name" for an entire group.',
      visibility:  'authenticated',
    }),

    // ── Stoop V1 Phase 7 (2026-05-06) — onboarding ───────────────────────

    /**
     * createGroupWithRules({groupId, name, rules})
     *   — admin skill (V1).  Persists the 6-question governance
     *   answers as a `kind: 'group-rules'` item.  Kept for back-compat;
     *   V2 callers use `createGroupV2` which adds rotating-code config.
     */
    defineSkill('createGroupWithRules', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.groupId !== 'string' || !a.groupId) return { error: 'groupId required' };
      if (typeof a.name    !== 'string' || !a.name)    return { error: 'name required' };
      if (typeof a.rules   !== 'object' || a.rules === null) return { error: 'rules object required' };
      const [item] = await store.addItems(
        [{
          type:       'group-rules',
          text:       a.name,
          source:     { groupId: a.groupId, rules: a.rules, version: 1 },
          visibility: 'household',
        }],
        { actor: from },
      );
      return { rulesId: item.id, groupId: a.groupId, _sync: simulateSync() };
    }, {
      description: 'Persist a group\'s governance rules (V1 admin wizard output).',
      visibility:  'authenticated',
    }),

    /**
     * createGroupV2({groupId, name, rules, keyRotationMode?, rotationDays?})
     *   — Phase 25.3.  V2 self-create flow.  Caller becomes admin
     *   automatically.  Persists the rules **with rotation config
     *   embedded** + mints an initial random membership code (Phase
     *   25.4 lets admins / members rotate it later).
     *
     *   The membership code is a string used out-of-band (WhatsApp,
     *   paper, in person) to certify a new joiner got the code from
     *   a trusted source — see functional design § B7-B9.  It is NOT
     *   a cryptographic primitive; the actual access control is the
     *   per-member proof that `redeemMembershipCode` mints.
     */
    defineSkill('createGroupV2', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.groupId !== 'string' || !a.groupId) return { error: 'groupId required' };
      if (typeof a.name    !== 'string' || !a.name)    return { error: 'name required' };
      if (typeof a.rules   !== 'object' || a.rules === null) return { error: 'rules object required' };
      const keyRotationMode = (a.keyRotationMode === 'peer-distributable')
        ? 'peer-distributable' : 'admin-only';
      const rotationDays = (typeof a.rotationDays === 'number' && a.rotationDays >= 1 && a.rotationDays <= 365)
        ? a.rotationDays : 30;
      // Admin-controlled membership-code lifetime (hours). Decoupled
      // from key rotation since 2026-05-24 — short codes default to
      // 1 h so ad-hoc WhatsApp/SMS shares don't leak a live join
      // secret for weeks. Range 1-8760 (1h-1y).
      const inviteExpiresInHours = (typeof a.inviteExpiresInHours === 'number'
          && a.inviteExpiresInHours >= 1 && a.inviteExpiresInHours <= 8760)
        ? a.inviteExpiresInHours : 1;

      // A3 (2026-05-14) — storage policy (§II.2 of the standardisation
      // plan). Default `'no-pod'` keeps V1 UX parity. Centralised /
      // hybrid require a `groupPodUri` (otherwise the crew has nowhere
      // to land its canonical state). Decentralised + no-pod ignore it.
      const storageErr = _validateStoragePolicy(a.storagePolicy, a.groupPodUri);
      if (storageErr) return { error: storageErr };
      const storage = _buildStoragePolicy(a.storagePolicy, a.groupPodUri);

      const rulesWithRotation = {
        ...a.rules, keyRotationMode, rotationDays, inviteExpiresInHours,
        storage, version: 1,
      };

      // Persist the group rules.
      const [rulesItem] = await store.addItems(
        [{
          type:       'group-rules',
          text:       a.name,
          source:     { groupId: a.groupId, rules: rulesWithRotation, version: 1 },
          visibility: 'household',
        }],
        { actor: from },
      );

      // Mint the initial membership code.
      const code      = _freshMembershipCode();
      const issuedAt  = Date.now();
      const expiresAt = issuedAt + inviteExpiresInHours * 60 * 60 * 1000;
      const [codeItem] = await store.addItems(
        [{
          type:       'membership-code',
          text:       `Membership code for ${a.groupId}`,
          source:     {
            groupId: a.groupId, code, issuedAt, expiresAt,
            issuedBy: from, rotationDays, keyRotationMode, inviteExpiresInHours,
          },
          visibility: 'household',
        }],
        { actor: from },
      );

      // Promote caller to admin in MemberMap (idempotent).
      if (members) {
        const me = (await members.resolveByWebid(from)) ?? { webid: from };
        await members.addMember({ ...me, role: 'admin' });
      }

      // A3 — push the storage policy into pod-routing so substrate-mirror
      // and notify-envelope honour it on subsequent writes. Best-effort:
      // when the bundle has no podRouting (legacy / test setups), the
      // rules item carries the policy + a future bundle bring-up can
      // hydrate from there.
      try {
        await bundle?.podRouting?.setCrewPolicy?.(a.groupId, storage);
      } catch { /* best-effort; rules-item is the source of truth */ }

      metrics?.record?.('group-create-v2');
      return {
        groupId: a.groupId,
        rulesId: rulesItem.id,
        codeId:  codeItem.id,
        code,                      // returned ONCE so the caller can hand it out
        expiresAt,
        keyRotationMode,
        rotationDays,
        storage,
        _sync:   simulateSync(),
      };
    }, {
      description: 'V2: create a group + initial membership code; caller becomes admin.',
      visibility:  'authenticated',
    }),

    /**
     * getCrewStoragePolicy({groupId})
     *   — A3 (2026-05-14). Returns the crew's storage policy
     *   `{policy, groupPodUri?}`. Pulls from `bundle.podRouting`
     *   first (live config), falls back to the latest group-rules
     *   item, then to the default `'no-pod'`. Used by /group.html
     *   + /create-group.html UI.
     */
    defineSkill('getCrewStoragePolicy', async ({ parts }) => {
      const a = dataArgs(parts);
      if (typeof a.groupId !== 'string' || !a.groupId) return { error: 'groupId required' };
      const live = bundle?.podRouting?.crewPolicy?.(a.groupId);
      if (live && typeof live === 'object' && typeof live.policy === 'string') {
        return { policy: live.policy, groupPodUri: live.groupPodUri ?? null };
      }
      const rulesItem = await _findLatestGroupRules(store, a.groupId);
      const stored    = rulesItem?.source?.rules?.storage;
      if (stored && typeof stored === 'object') {
        return { policy: stored.policy ?? 'no-pod', groupPodUri: stored.groupPodUri ?? null };
      }
      return { policy: 'no-pod', groupPodUri: null };
    }, {
      description: "A3: read the crew's storage policy (§II.2: no-pod / centralised / decentralised / hybrid).",
      visibility:  'authenticated',
    }),

    /**
     * setCrewStoragePolicy({groupId, storagePolicy, groupPodUri?})
     *   — A3 / A5 (2026-05-14). Admin-only. Updates the crew's
     *   storage policy. **One-way** by design (§4c of the V2 web
     *   functional design): downgrade to `'no-pod'` is rejected
     *   once a pod-having policy is active. Substrate data
     *   migration is the user's concern (per the
     *   `storage-migration-design-2026-05-14.md` decision).
     */
    defineSkill('setCrewStoragePolicy', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.groupId !== 'string' || !a.groupId) return { error: 'groupId required' };
      if (members) {
        const me = await members.resolveByWebid(from);
        const isAdmin = me?.role === 'admin' || me?.role === 'coordinator';
        if (!isAdmin) return { error: 'admin-only' };
      }
      const err = _validateStoragePolicy(a.storagePolicy, a.groupPodUri);
      if (err) return { error: err };
      const next = _buildStoragePolicy(a.storagePolicy, a.groupPodUri);
      const currentLive = bundle?.podRouting?.crewPolicy?.(a.groupId);
      const currentRules = (await _findLatestGroupRules(store, a.groupId))?.source?.rules?.storage;
      const current = (currentLive && currentLive.policy) ? currentLive : currentRules;
      if (current && current.policy && current.policy !== 'no-pod' && next.policy === 'no-pod') {
        return { error: 'storage-policy-downgrade-not-supported' };
      }
      try {
        await bundle?.podRouting?.setCrewPolicy?.(a.groupId, next);
      } catch (e) {
        return { error: `storage-policy-write-failed:${e?.message ?? 'unknown'}` };
      }
      metrics?.record?.('group-storage-policy-update');
      return { groupId: a.groupId, storage: next, _sync: simulateSync() };
    }, {
      description: 'A3/A5: admin-only upgrade of the crew storage policy. One-way.',
      visibility:  'authenticated',
    }),

    /**
     * rotateMyGroupCode({groupId})
     *   — Phase 25.4.  Admin-only.  Mints a fresh membership code,
     *   marking the previous one stale.  Old codes remain redeemable
     *   for 24h (grace window) so members mid-handoff don't get
     *   evicted by a clock-skew.
     */
    defineSkill('rotateMyGroupCode', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.groupId !== 'string' || !a.groupId) return { error: 'groupId required' };
      if (members) {
        const me = await members.resolveByWebid(from);
        const isAdmin = me?.role === 'admin' || me?.role === 'coordinator';
        if (!isAdmin) return { error: 'admin-only' };
      }

      // Look up rotation config from the latest group-rules item.
      const rulesItem = await _findLatestGroupRules(store, a.groupId);
      const rules = rulesItem?.source?.rules ?? {};
      const keyRotationMode = rules.keyRotationMode ?? 'admin-only';
      const rotationDays    = rules.rotationDays    ?? 30;
      // Per-call override > rules-stored admin pref > 1 h default.
      // Pre-2026-05-24 groups have no inviteExpiresInHours in rules —
      // they used to inherit rotationDays * 24, so honour that as the
      // legacy fallback before clamping to the 1 h default.
      const legacyHours = rotationDays * 24;
      const inviteExpiresInHours = (typeof a.inviteExpiresInHours === 'number'
          && a.inviteExpiresInHours >= 1 && a.inviteExpiresInHours <= 8760)
        ? a.inviteExpiresInHours
        : (typeof rules.inviteExpiresInHours === 'number'
            ? rules.inviteExpiresInHours
            : legacyHours);

      const code = _freshMembershipCode();
      // Guarantee the rotated code has a strictly later issuedAt than
      // every existing code for this group (defends `_findLatestActiveCode`
      // ordering when calls land in the same ms).
      const allCodes = await store.listOpen({ type: 'membership-code' });
      const maxPrev = allCodes
        .filter(i => i?.source?.groupId === a.groupId)
        .reduce((m, i) => Math.max(m, i.source?.issuedAt ?? 0), 0);
      const issuedAt  = Math.max(Date.now(), maxPrev + 1);
      const expiresAt = issuedAt + inviteExpiresInHours * 60 * 60 * 1000;
      const [codeItem] = await store.addItems(
        [{
          type:       'membership-code',
          text:       `Membership code for ${a.groupId}`,
          source:     {
            groupId: a.groupId, code, issuedAt, expiresAt,
            issuedBy: from, rotationDays, keyRotationMode, inviteExpiresInHours,
          },
          visibility: 'household',
        }],
        { actor: from },
      );
      metrics?.record?.('group-code-rotated');
      return { codeId: codeItem.id, code, expiresAt, _sync: simulateSync() };
    }, {
      description: 'Admin-only: mint a fresh membership code (rotates the group secret).',
      visibility:  'authenticated',
    }),

    /**
     * getCurrentMembershipCode({groupId})
     *   — Phase 25.4.  Admins always.  Members only when the group's
     *   keyRotationMode is 'peer-distributable'.  Returns the latest
     *   non-expired code so the caller can pass it OOB to a newcomer.
     */
    defineSkill('getCurrentMembershipCode', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.groupId !== 'string' || !a.groupId) return { error: 'groupId required' };
      const rulesItem = await _findLatestGroupRules(store, a.groupId);
      const mode = rulesItem?.source?.rules?.keyRotationMode ?? 'admin-only';

      let isAdmin = false;
      if (members) {
        const me = await members.resolveByWebid(from);
        isAdmin = me?.role === 'admin' || me?.role === 'coordinator';
      }
      if (mode === 'admin-only' && !isAdmin) return { error: 'admin-only' };

      const latest = await _findLatestActiveCode(store, a.groupId);
      if (!latest) return { error: 'no-code' };
      return {
        code:       latest.source.code,
        issuedAt:   latest.source.issuedAt,
        expiresAt:  latest.source.expiresAt,
        keyRotationMode: mode,
      };
    }, {
      description: 'Read the current membership code (admin always; member if mode=peer-distributable).',
      visibility:  'authenticated',
    }),

    /**
     * redeemMembershipCode({groupId, code})
     *   — Phase 25.4.  Caller presents a code obtained out-of-band.
     *   If it matches the current code (or is within the 24h grace
     *   window of a previous one), the bundle records a
     *   `kind: 'membership-redemption'` audit item.  The actual
     *   GroupProof minting happens in `core.GroupManager.issueProof`
     *   — admins call that out-of-band after seeing the redemption.
     *   In V2 we keep the proof flow untouched; this skill is the
     *   "I have the code, please add me" half.
     */
    defineSkill('redeemMembershipCode', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.groupId !== 'string' || !a.groupId) return { error: 'groupId required' };
      if (typeof a.code    !== 'string' || !a.code)    return { error: 'code required' };

      const all = await store.listOpen({ type: 'membership-code' });
      const forGroup = all.filter(i => i?.source?.groupId === a.groupId);
      const now = Date.now();
      const GRACE_MS = 24 * 60 * 60 * 1000;
      const valid = forGroup.find(i =>
        i.source.code === a.code &&
        // Active OR within grace window past expiry.
        (now <= (i.source.expiresAt ?? 0) + GRACE_MS),
      );
      if (!valid) return { error: 'invalid-or-expired-code' };

      const [item] = await store.addItems([{
        type:       'membership-redemption',
        text:       `${from} redeemed membership code for ${a.groupId}`,
        source:     {
          groupId:   a.groupId,
          code:      a.code,
          codeId:    valid.id,
          redeemedBy: from,
          redeemedAt: now,
          expiresAt:  valid.source.expiresAt,
          // Sealing public key the joiner publishes so the household control-agent can wrap the
          // group key to them (distinct from their transport identity).
          ...(a.sealingPublicKey ? { sealingPublicKey: a.sealingPublicKey } : {}),
        },
        visibility: 'household',
      }], { actor: from });
      metrics?.record?.('group-code-redeemed');
      await grantPodAccess(controlAgent, { webId: from, sealingPublicKey: a.sealingPublicKey, metrics });
      return {
        redemptionId: item.id,
        groupId:      a.groupId,
        validUntil:   valid.source.expiresAt,
        _sync:        simulateSync(),
      };
    }, {
      description: 'Present a membership code obtained out-of-band; records redemption.',
      visibility:  'authenticated',
    }),

    /**
     * verifyMembershipCodeForPeer({groupId, code, requesterWebid})
     *   — 2026-05-24 cross-instance redeem.
     *
     *   Called by the ADMIN's substrate after receiving a peer-redeem
     *   request over NKN.  Validates the code in the admin's local
     *   store + records a `membership-redemption` for the requester.
     *   The peer-bridge layer reads this skill's reply and forwards
     *   to the joiner so they can write their own audit record.
     *
     *   Differs from redeemMembershipCode only in that the `from`
     *   actor is the admin (the substrate runner) but the recorded
     *   redemption tracks `requesterWebid` (the joiner) so the
     *   admin's roster sees the new member.
     *
     *   The reply intentionally includes the code's `codeId` so the
     *   joiner can mirror a local redemption that references it.
     */
    defineSkill('verifyMembershipCodeForPeer', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.groupId !== 'string' || !a.groupId)
        return { error: 'groupId required' };
      if (typeof a.code !== 'string' || !a.code)
        return { error: 'code required' };
      if (typeof a.requesterWebid !== 'string' || !a.requesterWebid)
        return { error: 'requesterWebid required' };

      const all = await store.listOpen({ type: 'membership-code' });
      const forGroup = all.filter(i => i?.source?.groupId === a.groupId);
      const now = Date.now();
      const GRACE_MS = 24 * 60 * 60 * 1000;
      const valid = forGroup.find(i =>
        i.source.code === a.code &&
        (now <= (i.source.expiresAt ?? 0) + GRACE_MS),
      );
      if (!valid) return { error: 'invalid-or-expired-code' };

      const [item] = await store.addItems([{
        type:       'membership-redemption',
        text:       `${a.requesterWebid} redeemed (via peer) membership code for ${a.groupId}`,
        source:     {
          groupId:        a.groupId,
          code:           a.code,
          codeId:         valid.id,
          redeemedBy:     a.requesterWebid,
          redeemedAt:     now,
          expiresAt:      valid.source.expiresAt,
          confirmedBy:    from,
          channel:        'peer',
          // Slice 4 (2026-05-24) — joiner's mesh-consent token.
          // When true, admin propagates this peer's address to
          // other members (+ propagates other consenting members'
          // addresses to this joiner).  When false, the joiner
          // stays star-routed via admin.
          ...(a.shareCard ? { shareCard: true } : {}),
          ...(typeof a.peerDisplay === 'string' && a.peerDisplay ? { peerDisplay: a.peerDisplay } : {}),
          // The joiner's sealing public key (forwarded by the peer bridge) → the control-agent wraps
          // the group key to them. Admin-side: this is where the sealed household pod grants access.
          ...(a.sealingPublicKey ? { sealingPublicKey: a.sealingPublicKey } : {}),
        },
        visibility: 'household',
      }], { actor: from });
      metrics?.record?.('group-code-redeemed-peer');
      await grantPodAccess(controlAgent, { webId: a.requesterWebid, sealingPublicKey: a.sealingPublicKey, metrics });
      return {
        redemptionId: item.id,
        codeId:       valid.id,
        groupId:      a.groupId,
        validUntil:   valid.source.expiresAt,
        _sync:        simulateSync(),
      };
    }, {
      description: 'Admin-side peer validator: confirms a joiner-presented code + records redemption.',
      visibility:  'authenticated',
    }),

    /**
     * recordRemoteRedemption({groupId, code, codeId, expiresAt, confirmedBy})
     *   — 2026-05-24 cross-instance redeem (joiner-side mirror).
     *
     *   After the peer-bridge receives a successful
     *   verifyMembershipCodeForPeer reply from the admin, the joiner
     *   calls this skill locally to write its OWN
     *   `membership-redemption` audit record.  Without this mirror,
     *   `getMyMembershipStatus()` on the joiner side would return
     *   `redeemed: false` since it reads local items.
     *
     *   `codeId` is the admin-side item-id (the joiner has no matching
     *   `membership-code` item locally — that's the whole point of
     *   the peer-bridge — so the codeId here is a foreign reference,
     *   useful only as an audit pointer back to the admin's substrate).
     */
    defineSkill('recordRemoteRedemption', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.groupId !== 'string' || !a.groupId)
        return { error: 'groupId required' };
      if (typeof a.code !== 'string' || !a.code)
        return { error: 'code required' };
      const [item] = await store.addItems([{
        type:       'membership-redemption',
        text:       `${from} (peer-confirmed) for ${a.groupId}`,
        source:     {
          groupId:     a.groupId,
          code:        a.code,
          codeId:      a.codeId ?? null,
          redeemedBy:  from,
          redeemedAt:  Date.now(),
          expiresAt:   a.expiresAt ?? null,
          confirmedBy: a.confirmedBy ?? null,
          channel:     'peer',
        },
        visibility: 'household',
      }], { actor: from });
      // 2026-05-24 — also persist the rules locally so /group-rules
      // works on the joiner side after join.  Caller (canopy-chat's
      // join-group wizard) reads `rules` from the invite URL payload
      // and forwards it here.  Idempotent: skip if a group-rules
      // item for this groupId already exists.
      if (a.rules && typeof a.rules === 'object') {
        const existing = await store.listOpen({ type: 'group-rules' });
        const already = existing.find(i => i?.source?.groupId === a.groupId);
        if (!already) {
          await store.addItems([{
            type:       'group-rules',
            text:       `Rules for ${a.groupId} (mirrored from invite)`,
            source:     { groupId: a.groupId, rules: a.rules, version: 1, mirrored: true },
            visibility: 'household',
          }], { actor: from });
        }
      }
      return {
        redemptionId: item.id,
        groupId:      a.groupId,
        validUntil:   a.expiresAt ?? null,
        _sync:        simulateSync(),
      };
    }, {
      description: 'Joiner-side mirror: records a peer-confirmed redemption + rules locally.',
      visibility:  'authenticated',
    }),

    /**
     * listBuurtPostsSince({groupId, sinceMs})
     *   — Slice 5 (2026-05-24).  Returns broadcast posts in groupId
     *   added after `sinceMs`.  Used by the catch-up flow:
     *
     *     - Joiner comes online → asks each peer "anything new in
     *       buurt X since timestamp T?"
     *     - Peer (admin or member) calls this skill → packages each
     *       result as a buurt-post envelope back to the joiner
     *
     *   Output items match what fan-out's payload-builder needs:
     *   {requestId, text, type, kind, from, targets, ...} so the
     *   caller can re-package without extra lookups.
     */
    defineSkill('listBuurtPostsSince', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.groupId !== 'string' || !a.groupId)
        return { error: 'groupId required' };
      const sinceMs = (typeof a.sinceMs === 'number' && Number.isFinite(a.sinceMs))
        ? a.sinceMs : 0;
      const all = await store.listOpen();
      const posts = [];
      for (const it of all) {
        // Only broadcast-shaped (mirrored OR locally-posted-to-group) items.
        const targets = it?.source?.targets ?? [];
        const inGroup = Array.isArray(targets)
          && targets.some(t => t?.kind === 'group' && t?.groupId === a.groupId);
        if (!inGroup) continue;
        const ts = it.addedAt ?? 0;
        if (ts <= sinceMs) continue;
        // Reuse the broadcast payload shape (Phase 52.7.2) so the
        // caller can dispatch via the existing buurt-post envelope.
        posts.push({
          requestId:      it.source?.requestId ?? it.id,
          text:           it.text ?? '',
          from:           it.source?.from ?? it.addedBy ?? null,
          fromPubKey:     it.source?.fromPubKey ?? null,
          fromNknAddr:    it.source?.fromNknAddr ?? null,
          type:           it.type ?? 'request',
          kind:           it.kind ?? null,
          dueAt:          it.dueAt ?? null,
          categoryId:     it.source?.categoryId ?? null,
          skillTags:      Array.isArray(it.source?.skillTags) ? it.source.skillTags : [],
          requiredSkills: it.requiredSkills ?? [],
          targets,
          attachments:    Array.isArray(it.source?.attachments) ? it.source.attachments : [],
          ...(Array.isArray(it.source?.embeds) && it.source.embeds.length > 0
            ? { embeds: it.source.embeds } : {}),
          _addedAt:       ts,
        });
      }
      posts.sort((a, b) => (a._addedAt ?? 0) - (b._addedAt ?? 0));
      const decorated = posts.map((p) => ({ ...p, _lastSync: p._addedAt ?? Date.now() }));
      return { groupId: a.groupId, sinceMs, posts: decorated, _sync: simulateSync() };
    }, {
      description: 'List broadcast posts in groupId added after sinceMs (catch-up).',
      visibility:  'authenticated',
    }),

    /**
     * getLatestPostAddedAt({groupId})
     *   — Slice 5 (2026-05-24).  Returns the max `addedAt` we have
     *   for broadcast posts in groupId — joiner's catch-up
     *   high-water mark.  0 when never received anything.
     */
    defineSkill('getLatestPostAddedAt', async ({ parts }) => {
      const a = dataArgs(parts);
      if (typeof a.groupId !== 'string' || !a.groupId)
        return { error: 'groupId required' };
      const all = await store.listOpen();
      let max = 0;
      for (const it of all) {
        const targets = it?.source?.targets ?? [];
        const inGroup = Array.isArray(targets)
          && targets.some(t => t?.kind === 'group' && t?.groupId === a.groupId);
        if (!inGroup) continue;
        const ts = it.addedAt ?? 0;
        if (ts > max) max = ts;
      }
      return { groupId: a.groupId, latestAt: max };
    }, {
      description: 'High-water mark: latest addedAt for broadcast posts in groupId.',
      visibility:  'authenticated',
    }),

    /**
     * recordPeerIntro({groupId, peerAddr, peerDisplay?})
     *   — Slice 4 (2026-05-24).  Joiner-side mirror for a mesh
     *   introduction.  Admin propagates each consenting member's
     *   address; the receiver calls this skill to write a local
     *   `membership-redemption` item with `channel: 'intro'`.
     *   listGroupRoster's existing filter picks it up so the
     *   recipient can fan-out posts directly to the introduced
     *   peer (mesh topology) instead of relaying via admin.
     *
     *   Idempotent — skips when an intro for the same peer
     *   already exists for the group.
     */
    defineSkill('recordPeerIntro', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.groupId !== 'string' || !a.groupId)
        return { error: 'groupId required' };
      if (typeof a.peerAddr !== 'string' || !a.peerAddr)
        return { error: 'peerAddr required' };
      if (a.peerAddr === from) return { ok: true, skipped: 'self' };
      const all = await store.listOpen({ type: 'membership-redemption' });
      const dup = all.find(i =>
        i?.source?.groupId === a.groupId
          && i?.source?.redeemedBy === a.peerAddr
          && i?.source?.channel === 'intro',
      );
      if (dup) return { ok: true, skipped: 'duplicate' };
      const [item] = await store.addItems([{
        type:       'membership-redemption',
        text:       `${a.peerAddr} introduced for ${a.groupId}`,
        source:     {
          groupId:     a.groupId,
          redeemedBy:  a.peerAddr,
          peerDisplay: typeof a.peerDisplay === 'string' ? a.peerDisplay : null,
          channel:     'intro',
          introducedAt: Date.now(),
        },
        visibility: 'household',
      }], { actor: from });
      return { ok: true, introId: item.id, _sync: simulateSync() };
    }, {
      description: 'Joiner-side mirror: record a mesh introduction for another buurt member.',
      visibility:  'authenticated',
    }),

    /**
     * listConsentingPeers({groupId})
     *   — Slice 4 (2026-05-24).  Returns members of groupId who
     *   gave a `shareCard` (consented to mesh address-sharing).
     *   Used by admin to decide who to propagate when a new
     *   joiner arrives.  Skips self.
     */
    defineSkill('listConsentingPeers', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.groupId !== 'string' || !a.groupId)
        return { error: 'groupId required' };
      const all = await store.listOpen({ type: 'membership-redemption' });
      const peers = [];
      const seen = new Set();
      for (const it of all) {
        const src = it.source ?? {};
        if (src.groupId !== a.groupId) continue;
        if (!src.shareCard) continue;
        const addr = src.redeemedBy;
        if (typeof addr !== 'string' || !addr) continue;
        if (addr === from) continue;
        if (seen.has(addr)) continue;
        seen.add(addr);
        peers.push({ addr, display: src.peerDisplay ?? null });
      }
      return { peers, _sync: simulateSync() };
    }, {
      description: 'List buurt members who consented to mesh address-sharing.',
      visibility:  'authenticated',
    }),

    /**
     * getMyMembershipStatus({groupId})
     *   — Phase 25.7.  Reports the calling actor's most recent
     *   `membership-redemption` for the group, plus whether it's
     *   still valid.  Members who never redeemed return
     *   `{redeemed: false}`.  Members whose latest redemption has
     *   expired (past the rotation window + 24h grace) return
     *   `{redeemed: true, validUntil, isActive: false}` — the
     *   "auto-evicted" state.  Active members return `isActive: true`.
     *
     *   Eviction is enforced where it actually matters:
     *   `redeemMembershipCode` rejects expired codes; the relay-side
     *   proof check (V1 Phase 2) rejects messages signed by stale
     *   proofs.  This skill is purely informational so the UI can
     *   surface "Je code is verlopen — vraag de admin / leden om
     *   de nieuwe."
     */
    defineSkill('getMyMembershipStatus', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.groupId !== 'string' || !a.groupId) return { error: 'groupId required' };
      const all = await store.listOpen({ type: 'membership-redemption' });
      const mine = all.filter(i =>
        i.source?.groupId === a.groupId && i.source?.redeemedBy === from,
      );
      if (mine.length === 0) return { redeemed: false };
      mine.sort((p, q) => (q.source.redeemedAt ?? 0) - (p.source.redeemedAt ?? 0));
      const latest = mine[0];
      const GRACE_MS = 24 * 60 * 60 * 1000;
      const now = Date.now();
      const validUntil = latest.source.expiresAt ?? 0;
      const isActive = now <= validUntil + GRACE_MS;
      return {
        redeemed:  true,
        isActive,
        validUntil,
        redemptionId: latest.id,
      };
    }, {
      description: 'Report whether the calling actor\'s membership-code redemption is still valid.',
      visibility:  'authenticated',
    }),

    /**
     * listMyBuurts()
     *   — 2026-05-24 cross-instance fan-out support.
     *
     *   Returns the set of buurt groupIds the calling actor is in,
     *   from TWO sources combined:
     *
     *   1. `membership-redemption` items where redeemedBy === from
     *      (joiner side — the actor redeemed someone else's code).
     *   2. `group-rules` items where addedBy === from (creator/admin
     *      side — admins don't have a redemption for buurts they
     *      created themselves; they ARE the implicit owner).
     *
     *   Used by the canopy-chat fan-out layer to address every
     *   relevant buurt when /post doesn't pin one explicitly.
     */
    defineSkill('listMyBuurts', async ({ from }) => {
      const ids = new Set();
      const redemptions = await store.listOpen({ type: 'membership-redemption' });
      for (const it of redemptions) {
        if (it?.source?.redeemedBy !== from) continue;
        const gid = it?.source?.groupId;
        if (typeof gid === 'string' && gid) ids.add(gid);
      }
      const rules = await store.listOpen({ type: 'group-rules' });
      for (const it of rules) {
        if (it?.addedBy !== from) continue;
        const gid = it?.source?.groupId;
        if (typeof gid === 'string' && gid) ids.add(gid);
      }
      return { buurts: [...ids], _sync: simulateSync() };
    }, {
      description: 'List the buurt groupIds the calling actor is a member or admin of.',
      visibility:  'authenticated',
    }),

    /**
     * listGroupRoster({groupId})
     *   — 2026-05-24 cross-instance fan-out support.
     *
     *   Returns the addresses we know for the calling actor's buurt
     *   peers, drawn from `membership-redemption` items.  The chat
     *   layer uses this to fan out /post envelopes over NKN.
     *
     *   Two sources collapse into the same list:
     *     - On the ADMIN side: rows we wrote via
     *       `verifyMembershipCodeForPeer` carry `redeemedBy = joinerNkn`.
     *     - On the JOINER side: rows we wrote via
     *       `recordRemoteRedemption` carry `confirmedBy = adminNkn`.
     *
     *   We collect every non-self, non-empty `redeemedBy` + `confirmedBy`
     *   for the group, dedupe, and return as a flat list.  Caller can
     *   pass any of them to its transport layer for fan-out.
     *
     *   Returns: { members: [{addr, role: 'admin'|'member'}, ...] }
     */
    defineSkill('listGroupRoster', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.groupId !== 'string' || !a.groupId) return { error: 'groupId required' };
      const all = await store.listOpen({ type: 'membership-redemption' });
      const forGroup = all.filter(i => i?.source?.groupId === a.groupId);
      const seen = new Map();   // addr → role
      for (const it of forGroup) {
        const src = it.source ?? {};
        // `redeemedBy` is a joiner (the actor who presented the code).
        if (src.redeemedBy && src.redeemedBy !== from) {
          if (!seen.has(src.redeemedBy)) seen.set(src.redeemedBy, 'member');
        }
        // `confirmedBy` is the admin's address as recorded on the
        // joiner side (peer-bridge channel only).
        if (src.confirmedBy && src.confirmedBy !== from && src.channel === 'peer') {
          seen.set(src.confirmedBy, 'admin');
        }
      }
      return {
        groupId: a.groupId,
        members: [...seen.entries()].map(([addr, role]) => ({ addr, role })),
        _sync:   simulateSync(),
      };
    }, {
      description: 'List addresses for the calling actor\'s buurt peers (fan-out roster).',
      visibility:  'authenticated',
    }),

    /**
     * ingestRemotePost({payload, fromPubKey})
     *   — 2026-05-24 cross-instance fan-out (chat-layer bridge).
     *
     *   Called by canopy-chat when an NKN envelope of `subtype:
     *   'buurt-post'` arrives.  Mirrors substrateMirror.mirror()'s
     *   logic — dedupe by `payload.requestId`, eviction-filter by
     *   `payload.from`, draft + addItems with the same shape stoop's
     *   substrate-mirror produces.  This way local UI surfaces the
     *   remote post identically to a substrate-mirror-delivered post.
     *
     *   Reuses the existing broadcast payload shape (Phase 52.7.2 —
     *   `{requestId, text, from, type, kind, ...}`) so a future
     *   substrate-multi-transport slice can drop this bridge without
     *   schema changes.
     *
     *   Returns: { ok: true, itemId } or { deduped: true } or { error }.
     */
    defineSkill('ingestRemotePost', async ({ parts }) => {
      const a = dataArgs(parts);
      const payload = a.payload;
      const fromPubKey = typeof a.fromPubKey === 'string' ? a.fromPubKey : null;
      // 2026-05-24 — separate NKN address tracking.  fromPubKey is
      // the sender's substrate chat-agent identity (not NKN-routable
      // in the browser bundle); fromNknAddr is the actual transport
      // address [Help with] uses to send DMs back to the post author.
      const fromNknAddr = typeof a.fromNknAddr === 'string' ? a.fromNknAddr : null;
      if (!payload || typeof payload !== 'object') return { error: 'payload required' };
      const requestId = payload.requestId;
      if (typeof requestId !== 'string' || !requestId) return { error: 'payload.requestId required' };
      // Eviction filter — drop posts from members who left/were evicted.
      const evictionRoster = bundle?.evictionRoster ?? null;
      if (evictionRoster) {
        const fromWebid = payload.from ?? null;
        if (fromWebid && evictionRoster.isEvicted(fromWebid)) return { evicted: true };
      }
      // Dedupe — same O(N) check as substrate-mirror.
      const open = await store.listOpen();
      if (open.some(i => i?.source?.requestId === requestId)) return { deduped: true };

      const type = typeof payload.type === 'string' && payload.type
        ? payload.type
        : 'request';
      const draft = {
        type,
        ...(typeof payload.kind === 'string' && payload.kind ? { kind: payload.kind } : {}),
        text:           payload.text ?? '(broadcast)',
        requiredSkills: payload.requiredSkills ?? [],
        visibility:     'household',
        source: {
          requestId,
          broadcast:    true,
          from:         payload.from ?? null,
          fromPubKey,
          // 2026-05-24 — wire-level NKN address for back-channel DM
          // delivery (Slice 6b's [Help with] routes via this).
          ...(fromNknAddr ? { fromNknAddr } : {}),
          claimsTopic:  payload.claimsTopic ?? null,
          categoryId:   payload.categoryId ?? null,
          skillTags:    Array.isArray(payload.skillTags) ? payload.skillTags : [],
          attachments:  Array.isArray(payload.attachments) ? payload.attachments : [],
          ...(Array.isArray(payload.embeds) && payload.embeds.length > 0
            ? { embeds: payload.embeds }
            : {}),
          ...(Array.isArray(payload.targets) && payload.targets.length > 0
            ? { targets: payload.targets }
            : {}),
        },
      };
      if (typeof payload.dueAt === 'number') draft.dueAt = payload.dueAt;
      const [item] = await store.addItems([draft], {
        actor: payload.from ?? (fromPubKey ? `pubkey:${fromPubKey.slice(0, 12)}` : 'broadcast'),
      });
      return { ok: true, itemId: item.id, _sync: simulateSync() };
    }, {
      description: 'Ingest a remote post envelope into the local feed (mirrors substrate-mirror logic).',
      visibility:  'authenticated',
    }),

    /**
     * getGroupRules({groupId})
     *   — return the latest `group-rules` item for `groupId` (or null).
     */
    defineSkill('getGroupRules', async ({ parts }) => {
      const a = dataArgs(parts);
      if (typeof a.groupId !== 'string' || !a.groupId) return { error: 'groupId required' };
      const all = await store.listOpen({ type: 'group-rules' });
      // Latest-wins: prefer addedAt (ms epoch), fall back to ULID
      // tiebreak.  Robust against sub-millisecond ULID collisions.
      let latest = null;
      for (const it of all) {
        if (it.source?.groupId !== a.groupId) continue;
        if (!latest) { latest = it; continue; }
        const tsA = latest.addedAt ?? 0;
        const tsB = it.addedAt     ?? 0;
        if (tsB > tsA || (tsB === tsA && it.id > latest.id)) latest = it;
      }
      return { rules: latest };
    }, {
      description: 'Return the latest group-rules item for a group.',
      visibility:  'authenticated',
    }),

    /**
     * acceptGroupRules({groupId})
     *   — record that the calling actor read + accepted the rules
     *   (audit trail item, kind: 'rules-accept').
     */
    defineSkill('acceptGroupRules', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.groupId !== 'string' || !a.groupId) return { error: 'groupId required' };
      const [item] = await store.addItems(
        [{
          type:       'rules-accept',
          text:       `Accepted rules of ${a.groupId}`,
          source:     { groupId: a.groupId, acceptedBy: from, acceptedAt: Date.now() },
          visibility: 'household',
        }],
        { actor: from },
      );
      return { acceptanceId: item.id, _sync: simulateSync() };
    }, {
      description: 'Record acceptance of a group\'s rules (audit).',
      visibility:  'authenticated',
    }),

    /**
     * getOnboardingState()
     *   — light status report the first-run UI uses to decide which
     *   step to show next.
     */
    defineSkill('getOnboardingState', async ({ from }) => {
      const me = members ? await members.resolveByWebid(from) : null;
      const acceptances = await store.listOpen({ type: 'rules-accept' });
      const accepted = acceptances
        .filter(i => i.source?.acceptedBy === from)
        .map(i => i.source?.groupId);
      return {
        handleSet:        !!me?.handle,
        displayNameSet:   !!me?.displayName,
        groupsAccepted:   accepted,
        currentGroupId:   groupId,
      };
    }, {
      description: 'Light status report driving the first-run wizard.',
      visibility:  'authenticated',
    }),

    /**
     * getDataLocation()
     *   — names the operator + pod / data location so the "Where is
     *   my data?" screen has something to render.  Values come from
     *   `dataLocationConfig` injected at factory time; defaults are
     *   placeholders.
     */
    defineSkill('getDataLocation', async () => ({
      relayOperator: dataLocationConfig?.relayOperator ?? null,
      relayUrl:      dataLocationConfig?.relayUrl      ?? null,
      podIssuer:     dataLocationConfig?.podIssuer     ?? null,
      podRoot:       dataLocationConfig?.podRoot       ?? null,
    }), {
      description: 'Return where the user\'s data + traffic live (relay operator + pod).',
      visibility:  'authenticated',
    }),

    /**
     * getPrivacyNotice({lang?})
     *   — Stoop's closed-beta privacy notice.  Defaults to NL.
     */
    defineSkill('getPrivacyNotice', async ({ parts }) => {
      const a = dataArgs(parts);
      const lang = a.lang ?? 'nl';
      return { lang, sections: getPrivacyNotice(lang) };
    }, {
      description: 'Return the closed-beta privacy notice in the requested language.',
      visibility:  'authenticated',
    }),

    // ── Stoop V1 Phase 10 (2026-05-06) — closed-beta hardening ────────────

    // ── Stoop V1 Phase 13 (2026-05-06) — UX completeness ─────────────────

    /**
     * setSkillsHolidayMode({on: bool})
     *   — bulk-flip every active skill to `'paused'`; flipping
     *   back restores them to `'active'`.  Net effect: SkillMatch
     *   and Layer-1 matching ignore my profile while paused.
     *   Note: distinct from `setHolidayMode` (which sets a single
     *   cross-device flag without touching per-skill status).  Apps
     *   typically wire both: the flag for the UI banner + the bulk
     *   flip for actual matching behaviour.
     *
     *   Status enum values (`actief` / `gepauzeerd` / `gearchiveerd`)
     *   are intentional Dutch domain vocabulary — locked-in by V1.
     */
    defineSkill('setSkillsHolidayMode', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.on !== 'boolean') return { error: 'on (bool) required' };
      if (!members) return { error: 'no-member-map' };
      const me = (await members.resolveByWebid(from)) ?? { webid: from };
      const skills = Array.isArray(me.skills) ? me.skills : [];
      const targetStatus = a.on ? 'paused' : 'active';
      const updated = skills.map(s => ({
        ...s,
        // Only flip skills that are not 'archived' — leaving
        // archived ones alone so holiday-mode isn't a re-archive event.
        status: s.status === 'archived' ? 'archived' : targetStatus,
      }));
      await members.addMember({ ...me, skills: updated });
      return { holidayMode: a.on, skillCount: updated.length, _sync: simulateSync() };
    }, {
      description: 'Bulk-flip every active skill between paused (gepauzeerd) and active (actief); does not touch archived skills.',
      visibility:  'authenticated',
    }),

    /**
     * checkDuplicate({text})
     *   — pre-submit check: would this near-duplicate one of my
     *   last 5 posts in the current group?  Pure read; doesn't
     *   write or claim.
     */
    defineSkill('checkDuplicate', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.text !== 'string' || !a.text) return { duplicate: null };
      const open = await store.listOpen({});
      const mine = open.filter(i => i.addedBy === from)
        .sort((p, q) => (q.addedAt ?? 0) - (p.addedAt ?? 0))
        .slice(0, 5);
      const hit = findNearDuplicate(a.text, mine);
      if (!hit) return { duplicate: null };
      return {
        duplicate: { id: hit.duplicate.id, text: hit.duplicate.text },
        ratio:     hit.ratio,
      };
    }, {
      description: 'Soft-warn if a candidate post body is a near-duplicate of one of my recent posts.',
      visibility:  'authenticated',
    }),

    /**
     * listMyStalePosts({thresholdDays?: number=30})
     *   — return the calling actor\'s open posts older than
     *   `thresholdDays`.  Powers the stale-post nudge UI.
     */
    defineSkill('listMyStalePosts', async ({ parts, from }) => {
      const a = dataArgs(parts);
      const days = typeof a.thresholdDays === 'number' ? a.thresholdDays : 30;
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const open = await store.listOpen({});
      const mine = open.filter(i =>
        i.addedBy === from
        && (i.type === 'ask' || i.type === 'offer' || i.type === 'lend' || i.type === 'request')
        && (i.addedAt ?? 0) < cutoff,
      );
      return { stale: decorateWithLastSync(mine), _sync: simulateSync() };
    }, {
      description: 'Return my open posts older than thresholdDays (default 30).',
      visibility:  'authenticated',
    }),

    /**
     * encryptedBackup({passphrase})
     *   — produces a passphrase-protected snapshot.  Replaces the
     *   plaintext `exportMyData` for testers / public users.
     */
    defineSkill('encryptedBackup', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.passphrase !== 'string' || a.passphrase.length === 0) {
        return { error: 'passphrase required' };
      }
      const member  = members ? await members.resolveByWebid(from) : null;
      const all     = await store.listOpen({});
      const myItems = all.filter(i => i.addedBy === from);
      const data    = { webid: from, member, items: myItems, exportedAt: Date.now() };
      const blob    = await encryptBackup({ data, passphrase: a.passphrase });
      metrics?.record?.('backup-created');
      return { blob, _sync: simulateSync() };
    }, {
      description: 'Passphrase-encrypted snapshot of my data; the passphrase never leaves the device.',
      visibility:  'authenticated',
    }),

    /**
     * exportMyData()
     *   — POJO snapshot of everything the agent knows about the
     *   calling actor: MemberMap entry, items they authored, and
     *   the audit trail.  Apps offer this as a "Take my data"
     *   download (frontend serialises to .json or .zip).
     */
    defineSkill('exportMyData', async ({ from }) => {
      const member = members ? await members.resolveByWebid(from) : null;
      const allOpen   = await store.listOpen({});
      const allAudit  = await store.auditLog?.({ actor: from }).catch(() => []) ?? [];
      const myItems   = allOpen.filter(i => i.addedBy === from);
      // Closed-completed items: listOpen excludes them; ItemStore exposes
      // listOpen + listAll(?)  Use listOpen now — closed items don't
      // belong in an "active state" export.  V1.5 adds listAll if the
      // export needs it.
      return {
        webid:          from,
        member,
        items:          myItems,
        audit:          Array.isArray(allAudit) ? allAudit : [],
        exportedAt:     Date.now(),
      };
    }, {
      description: 'Snapshot the calling actor\'s data (member entry + own items + audit).',
      visibility:  'authenticated',
    }),

    /**
     * leaveGroup({groupId, deletePosts?: bool=false})
     *   — record an audit-trail "I left this group" item; optionally
     *   delete the calling actor's own items.  Pod-side notification
     *   to admin / other members is V2 (needs chat-agent integration);
     *   V1 leaves a footprint in item-store the admin can spot.
     */
    defineSkill('leaveGroup', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.groupId !== 'string' || !a.groupId) return { error: 'groupId required' };

      const [marker] = await store.addItems(
        [{
          type:       'group-leave',
          text:       `${from} left ${a.groupId}`,
          source:     { groupId: a.groupId, leftBy: from, leftAt: Date.now() },
          visibility: 'household',
        }],
        { actor: from },
      );

      // Sealed household pod: revoke the leaver's ACL + rotate the group key (forward secrecy). Gated.
      await revokePodAccess(controlAgent, { webId: from, metrics });

      let deleted = 0;
      if (a.deletePosts) {
        const myItems = (await store.listOpen({})).filter(i => i.addedBy === from && i.id !== marker.id);
        for (const it of myItems) {
          await store.removeItems([{ id: it.id }], { actor: from });
          // Also cancel any lend reminders the user had pending.
          if (notifier) {
            try { await notifier.cancel(`due:${it.id}`); } catch {}
          }
          deleted += 1;
        }
      }
      return { leaveMarkerId: marker.id, deletedItems: deleted, _sync: simulateSync() };
    }, {
      description: 'Record group-leave audit + optionally delete the actor\'s own items.',
      visibility:  'authenticated',
    }),

    /**
     * markMnemonicShown()
     *   — record that the user has been shown their recovery phrase
     *   at least once.  The next time onboarding resumes, this flag
     *   prevents nagging.
     */
    defineSkill('markMnemonicShown', async ({ from }) => {
      if (!members) return { error: 'no-member-map' };
      const me = (await members.resolveByWebid(from)) ?? { webid: from };
      const externalIds = { ...(me.externalIds ?? {}), mnemonicShown: 'true' };
      await members.addMember({ ...me, externalIds });
      return { ok: true, _sync: simulateSync() };
    }, {
      description: 'Mark that the user\'s recovery phrase has been shown.',
      visibility:  'authenticated',
    }),

    // ── Stoop V1 Phase 6 (2026-05-06) — handle / displayName / reveal ─────
    // (skill block below — kept in original location for git friendliness)

    /**
     * getMyProfile()
     *   — returns the calling actor's MemberMap entry + a
     *   `renderForCurrentGroup` block showing how viewers in this
     *   group will see them by default (handle vs displayName).
     */
    defineSkill('getMyProfile', async ({ from }) => {
      if (!members) return { error: 'no-member-map' };
      const entry = await members.resolveByWebid(from);
      if (!entry) return { entry: null };
      // Project how *I* would appear to a viewer-in-this-group who has
      // not flipped any reveal flag.  This composes resolve() with a
      // synthesised viewer = anyone-but-me.  (resolve() is viewer-
      // agnostic for the default case, so this works without a real
      // separate Reveals.)
      let renderForCurrentGroup = null;
      if (groupId) {
        renderForCurrentGroup = await resolveMember({
          memberMap:   members,
          targetWebid: from,
          groupId,
        });
      }
      return { entry, renderForCurrentGroup };
    }, {
      description: 'Return the calling actor\'s profile + how peers see them by default.',
      visibility:  'authenticated',
    }),

    // ── Stoop V1 Phase 14 (2026-05-06) — peer chat + reply + reveal ──────

    /**
     * sendChatMessage({toStableId? | toWebid? | toPubKey?, threadId, body})
     *   — peer-to-peer chat over `agent.transport.sendOneWay`.  At
     *   least one recipient identifier is required; stableId
     *   preferred, webid back-compat, pubKey for test fixtures.
     */
    defineSkill('sendChatMessage', async ({ parts }) => {
      if (!chat) return { error: 'chat-not-wired' };
      const a = dataArgs(parts);
      if (typeof a.threadId !== 'string' || !a.threadId) return { error: 'threadId required' };
      // Phase 39 — body OR attachment is required (or both).
      const hasBody       = typeof a.body === 'string' && a.body.length > 0;
      const hasAttachment = a.attachment && typeof a.attachment === 'object';
      if (!hasBody && !hasAttachment) return { error: 'body-or-attachment-required' };

      // Validate attachment shape + size cap if provided.
      if (hasAttachment) {
        const err = validateInboundAttachment(a.attachment, { maxBytes: MAX_CHAT_BYTES_PER_ATT });
        if (err) return { error: err };
      }

      const r = await chat.send({
        toStableId: a.toStableId,
        toWebid:    a.toWebid,
        toPubKey:   a.toPubKey,
        threadId:   a.threadId,
        body:       a.body ?? '',
        subtype:    'chat-message',
        extras:     hasAttachment ? { attachment: a.attachment } : undefined,
      });
      return r.ok ? { ok: true, itemId: r.itemId, _sync: simulateSync() } : { error: r.reason };
    }, {
      description: 'Send a 1-on-1 chat message (with optional inline image attachment) to a peer.',
      visibility:  'authenticated',
    }),

    /**
     * getChatThread({threadId})
     *   — return all chat-message items for `threadId`, oldest-first.
     */
    defineSkill('getChatThread', async ({ parts }) => {
      const a = dataArgs(parts);
      if (typeof a.threadId !== 'string' || !a.threadId) return { error: 'threadId required' };
      const all = await store.listOpen({ type: 'chat-message' });
      const messages = all
        .filter(i => i.source?.threadId === a.threadId)
        .sort((p, q) => (p.source?.sentAt ?? p.addedAt ?? 0) - (q.source?.sentAt ?? q.addedAt ?? 0));
      const decorated = messages.map((m) => ({
        ...m,
        _lastSync: m.source?.sentAt ?? m.addedAt ?? Date.now(),
      }));
      return { messages: decorated, _sync: simulateSync() };
    }, {
      description: 'Return all chat-messages for a thread, oldest-first.',
      visibility:  'authenticated',
    }),

    /**
     * listChatThreads()
     *   — distinct threadIds I'm a participant in, with the most
     *   recent message + the counterparty's stableId / webid.
     */
    defineSkill('listChatThreads', async ({ from }) => {
      const all = await store.listOpen({ type: 'chat-message' });
      /** @type {Map<string, object>} */
      const byThread = new Map();
      for (const m of all) {
        const t = m.source?.threadId;
        if (!t) continue;
        const cur = byThread.get(t);
        const ts  = m.source?.sentAt ?? m.addedAt ?? 0;
        if (!cur || ts > cur.lastSentAt) {
          byThread.set(t, {
            threadId:    t,
            lastBody:    m.text,
            lastSentAt:  ts,
            lastFrom:    m.source?.fromWebid ?? m.addedBy,
            counterparty: m.source?.fromWebid === from
              ? (m.source?.toWebid ?? null)
              : (m.source?.fromWebid ?? null),
          });
        }
      }
      const threads = [...byThread.values()]
        .sort((a, b) => b.lastSentAt - a.lastSentAt)
        .map((t) => ({ ...t, _lastSync: t.lastSentAt ?? Date.now() }));
      return { threads, _sync: simulateSync() };
    }, {
      description: 'List my chat threads, most-recently-active first.',
      visibility:  'authenticated',
    }),

    /**
     * respondToItem({itemId, body})
     *   — open a chat thread with the post author.  threadId =
     *   originating post's id; first message body becomes the
     *   thread's first chat-message; the post's claim is recorded
     *   (via item-store.claim) so the requester sees a claim too.
     */
    defineSkill('respondToItem', async ({ parts, from }) => {
      if (!chat) return { error: 'chat-not-wired' };
      const a = dataArgs(parts);
      if (typeof a.itemId !== 'string' || !a.itemId) return { error: 'itemId required' };
      if (typeof a.body !== 'string' || !a.body) return { error: 'body required' };

      // Look up by direct id first (single-agent path), then fall
      // back to the cross-agent path: the substrate mirror writes
      // incoming broadcasts with a fresh ULID +
      // `source.requestId === <broadcast-id>`.
      let post = await store.getById(a.itemId);
      if (!post) {
        const open = await store.listOpen({});
        post = open.find(i => i?.source?.requestId === a.itemId) ?? null;
      }
      if (!post) return { error: 'not-found' };

      // Resolve the post-author's pubKey from the broadcast metadata
      // (substrate mirror writes `source.fromPubKey`) or from MemberMap.
      let toPubKey = post.source?.fromPubKey ?? null;
      let toWebid  = post.source?.from ?? post.addedBy ?? null;
      let toStableId = null;
      if (members && toWebid) {
        const peer = await members.resolveByWebid(toWebid);
        toStableId = peer?.stableId ?? null;
        if (!toPubKey) toPubKey = peer?.pubKey ?? null;
      }

      // Soft-claim locally so it shows in the requester's listMyRequests
      // when the broadcast loops back (substrate mirror writes their copy).
      try { await store.claim(a.itemId, { actor: from }); } catch { /* race-OK */ }

      // Send the chat message.
      const r = await chat.send({
        toStableId,
        toWebid,
        toPubKey,
        threadId: a.itemId,
        body:     a.body,
        subtype:  'chat-message',
      });
      if (!r.ok) return { error: r.reason };

      // Phase 22: feed the post body into my Layer-2 interest profile —
      // responding is the canonical "I care about this" signal.
      if (bundle?.interestProfile && typeof post.text === 'string') {
        try { updateInterest(bundle.interestProfile, post.text); } catch {}
      }

      return { ok: true, threadId: a.itemId, itemId: r.itemId };
    }, {
      description: 'Open a chat thread on a post + send the first message; soft-claims the post.',
      visibility:  'authenticated',
    }),

    /**
     * requestReveal({peerStableId? | peerWebid?, threadId})
     *   — bilateral reveal handshake.  Flips the local Reveals
     *   record for the peer + sends a `reveal-request` chat envelope
     *   to the peer so their UI can offer to reciprocate.
     */
    defineSkill('requestReveal', async ({ parts, from }) => {
      if (!chat || !reveals) return { error: 'chat-or-reveals-not-wired' };
      const a = dataArgs(parts);
      if (typeof a.threadId !== 'string' || !a.threadId) return { error: 'threadId required' };

      const peerStableId = a.peerStableId ?? null;
      const peerWebid    = a.peerWebid    ?? null;

      // Flip locally.
      if (peerStableId) reveals.setPeerReveal(peerStableId, true);
      else if (peerWebid) reveals.setPeerReveal(peerWebid, true);
      else return { error: 'peerStableId or peerWebid required' };

      // Send hint to the peer.
      const r = await chat.send({
        toStableId: peerStableId,
        toWebid:    peerWebid,
        threadId:   a.threadId,
        body:       null,
        subtype:    'reveal-request',
      });
      return r.ok ? { ok: true } : { error: r.reason };
    }, {
      description: 'Bilateral reveal: flip local Reveals + send a hint to the peer to reciprocate.',
      visibility:  'authenticated',
    }),

    // ── Stoop V1 Phase 16 (2026-05-06) — group ops admin polish ──────────

    /**
     * listGroupMembers({groupId})
     *   — return the members of a group as MemberMap entries.
     *   `groupId` defaults to the bundle's current group.
     */
    defineSkill('listGroupMembers', async ({ parts }) => {
      const a = dataArgs(parts);
      const _groupId = a.groupId ?? groupId;
      if (!members) return { members: [] };
      const list = await members.list();
      return { groupId: _groupId, members: list };
    }, {
      description: 'List the members of a group (handles, displayName per Reveals, role).',
      visibility:  'authenticated',
    }),

    /**
     * broadcastKringMessage({groupId, text, msgId, ts?, fromActor?})
     *   — SP-13.2.1 — plain-text chat fan-out to every member of a
     *   kring.  Reuses the existing `chat.send` substrate (WebID→pubKey
     *   resolution, signing, transport routing) with subtype
     *   `'kring-chat-message'` so receivers can wire a dedicated
     *   peer-router handler that appends to the canopy-chat EventLog
     *   (NOT to itemStore — kring chats aren't stoop posts).
     *
     *   Best-effort + fire-and-forget: per-peer failures land in the
     *   returned `errors[]` array but never throw; the UI's local
     *   append already gave the user the optimistic bubble.
     */
    defineSkill('broadcastKringMessage', async ({ parts, from }) => {
      const a = dataArgs(parts);
      const _groupId = a.groupId ?? groupId;
      if (!_groupId)             return { error: 'groupId-required' };
      if (typeof a.text !== 'string' || !a.text.trim()) return { error: 'text-required' };
      if (typeof a.msgId !== 'string' || !a.msgId)      return { error: 'msgId-required' };

      const text = a.text.trim();
      const ts   = typeof a.ts === 'number' && Number.isFinite(a.ts) ? a.ts : Date.now();

      // Local mirror — store the outgoing chat as an item so it
      // survives reloads AND the kring view can read its full history
      // from the same itemStore the receiver writes to.  The dedup-by-
      // msgId in ingestKringMessage means a peer's echo (if any) is
      // suppressed locally.
      let localItemId = null;
      try {
        const open = await store.listOpen({ type: 'kring-chat-message' });
        const dup  = open.find((i) => i?.source?.msgId === a.msgId);
        if (dup) {
          localItemId = dup.id;
        } else {
          const [item] = await store.addItems([{
            type:       'kring-chat-message',
            text,
            visibility: 'household',
            source: {
              circleId:  _groupId,
              msgId:     a.msgId,
              ts,
              from,
              fromActor: a.fromActor ?? from ?? null,
            },
          }], { actor: from });
          localItemId = item?.id ?? null;
        }
      } catch (err) {
        // Storage failure shouldn't block fan-out — receivers still get the
        // chat over NKN.  Log + continue.
        console.warn('[broadcastKringMessage] local mirror failed:', err?.message ?? err);
      }

      if (!chat?.send)           return { error: 'chat-unavailable', sent: 0, errors: [], itemId: localItemId };
      if (!members)              return { error: 'members-unavailable', sent: 0, errors: [], itemId: localItemId };

      const list = await members.list();
      const webids = new Set();
      for (const m of list ?? []) {
        const w = typeof m === 'string' ? m : (m?.webid ?? m?.webId ?? null);
        if (!w || w === from) continue;
        webids.add(w);
      }

      let sent = 0;
      const errors = [];
      await Promise.all([...webids].map(async (webid) => {
        try {
          const r = await chat.send({
            toWebid:  webid,
            subtype:  'kring-chat-message',
            threadId: _groupId,
            body:     text,
            extras: {
              circleId:  _groupId,
              msgId:     a.msgId,
              ts,
              fromActor: a.fromActor ?? from ?? null,
            },
          });
          if (r?.ok) sent += 1;
          else errors.push({ webid, reason: r?.reason ?? 'unknown' });
        } catch (err) {
          errors.push({ webid, reason: String(err?.message ?? err) });
        }
      }));
      metrics?.record?.('kring-chat-fanout');
      return { sent, attempted: webids.size, errors, itemId: localItemId };
    }, {
      description: 'Fan a plain-text kring chat message out to every other member via chat.send subtype:kring-chat-message; also mirrors locally to itemStore for durable history.',
      visibility:  'authenticated',
    }),

    /**
     * broadcastKringRecipe({groupId, recipe, msgId, ts?})
     *   — γ-next.recipe — kring scherm recipe fan-out to every member
     *   of a kring.  Sibling of `broadcastKringMessage`: same fan-out
     *   plumbing (chat.send, WebID→pubKey resolution, signing,
     *   transport routing), different subtype + payload.
     *
     *   Receivers route the envelope to canopy-chat's
     *   `makeKringRecipePeerHandler`, which stashes the recipe in a
     *   per-kring "pending" cache.  The recipe editor reads the cache
     *   on next open and passes it via γ.3's `incomingRecipe` opt; the
     *   resolver pops if the incoming diverges from local.
     *
     *   Best-effort + fire-and-forget: per-peer failures land in the
     *   returned `errors[]` array but never throw.
     */
    defineSkill('broadcastKringRecipe', async ({ parts, from }) => {
      const a = dataArgs(parts);
      const _groupId = a.groupId ?? groupId;
      if (!_groupId)                                              return { error: 'groupId-required' };
      if (!a.recipe || typeof a.recipe !== 'object')              return { error: 'recipe-required' };
      if (typeof a.msgId !== 'string' || !a.msgId)                return { error: 'msgId-required' };

      const ts = typeof a.ts === 'number' && Number.isFinite(a.ts) ? a.ts : Date.now();

      if (!chat?.send) return { error: 'chat-unavailable', sent: 0, attempted: 0, errors: [] };
      if (!members)    return { error: 'members-unavailable', sent: 0, attempted: 0, errors: [] };

      const list = await members.list();
      const webids = new Set();
      for (const m of list ?? []) {
        const w = typeof m === 'string' ? m : (m?.webid ?? m?.webId ?? null);
        if (!w || w === from) continue;
        webids.add(w);
      }

      let sent = 0;
      const errors = [];
      await Promise.all([...webids].map(async (webid) => {
        try {
          const r = await chat.send({
            toWebid:  webid,
            subtype:  'kring-recipe-broadcast',
            threadId: _groupId,
            body:     '',
            extras: {
              circleId:  _groupId,
              msgId:     a.msgId,
              ts,
              recipe:    a.recipe,
              fromActor: a.fromActor ?? from ?? null,
            },
          });
          if (r?.ok) sent += 1;
          else errors.push({ webid, reason: r?.reason ?? 'unknown' });
        } catch (err) {
          errors.push({ webid, reason: String(err?.message ?? err) });
        }
      }));
      metrics?.record?.('kring-recipe-fanout');
      return { sent, attempted: webids.size, errors };
    }, {
      description: 'Fan a kring scherm recipe out to every other member via chat.send subtype:kring-recipe-broadcast; receivers cache as pending incomingRecipe for the γ.3 conflict resolver.',
      visibility:  'authenticated',
    }),

    /**
     * broadcastKringRules({groupId, rulesDoc, msgId, ts?})
     *   — γ-next.rules — kring rules document fan-out to every member
     *   of a kring.  Sibling of `broadcastKringRecipe`: same fan-out
     *   plumbing (chat.send, WebID→pubKey resolution, signing,
     *   transport routing), different subtype + payload.
     *
     *   Receivers route the envelope to canopy-chat's
     *   `makeKringRulesPeerHandler`, which stashes the rules doc in a
     *   per-kring "pending" cache.  The rules editor reads the cache
     *   on next open and passes it via γ.4's `incomingRules` opt; the
     *   resolver pops if the incoming diverges from local.
     *
     *   Best-effort + fire-and-forget: per-peer failures land in the
     *   returned `errors[]` array but never throw.
     */
    defineSkill('broadcastKringRules', async ({ parts, from }) => {
      const a = dataArgs(parts);
      const _groupId = a.groupId ?? groupId;
      if (!_groupId)                                                  return { error: 'groupId-required' };
      if (!a.rulesDoc || typeof a.rulesDoc !== 'object')              return { error: 'rulesDoc-required' };
      if (typeof a.msgId !== 'string' || !a.msgId)                    return { error: 'msgId-required' };

      const ts = typeof a.ts === 'number' && Number.isFinite(a.ts) ? a.ts : Date.now();

      if (!chat?.send) return { error: 'chat-unavailable', sent: 0, attempted: 0, errors: [] };
      if (!members)    return { error: 'members-unavailable', sent: 0, attempted: 0, errors: [] };

      const list = await members.list();
      const webids = new Set();
      for (const m of list ?? []) {
        const w = typeof m === 'string' ? m : (m?.webid ?? m?.webId ?? null);
        if (!w || w === from) continue;
        webids.add(w);
      }

      let sent = 0;
      const errors = [];
      await Promise.all([...webids].map(async (webid) => {
        try {
          const r = await chat.send({
            toWebid:  webid,
            subtype:  'kring-rules-broadcast',
            threadId: _groupId,
            body:     '',
            extras: {
              circleId:  _groupId,
              msgId:     a.msgId,
              ts,
              rulesDoc:  a.rulesDoc,
              fromActor: a.fromActor ?? from ?? null,
            },
          });
          if (r?.ok) sent += 1;
          else errors.push({ webid, reason: r?.reason ?? 'unknown' });
        } catch (err) {
          errors.push({ webid, reason: String(err?.message ?? err) });
        }
      }));
      metrics?.record?.('kring-rules-fanout');
      return { sent, attempted: webids.size, errors };
    }, {
      description: 'Fan a kring rules document out to every other member via chat.send subtype:kring-rules-broadcast; receivers cache as pending incomingRules for the γ.4 conflict resolver.',
      visibility:  'authenticated',
    }),

    /**
     * broadcastKringPolicy({groupId, policy, msgId, ts?})
     *   — γ-next.policy — kring circlePolicy document fan-out to every
     *   member of a kring.  Sibling of `broadcastKringRules`: same fan-out
     *   plumbing (chat.send, WebID→pubKey resolution, signing,
     *   transport routing), different subtype + payload.
     *
     *   Receivers route the envelope to canopy-chat's
     *   `makeKringPolicyPeerHandler`, which stashes the policy doc in a
     *   per-kring "pending" cache.  The settings editor reads the cache
     *   on next open and passes it via γ.4's `incomingPolicy` opt; the
     *   resolver pops if the incoming diverges from local.
     *
     *   Best-effort + fire-and-forget: per-peer failures land in the
     *   returned `errors[]` array but never throw.
     */
    defineSkill('broadcastKringPolicy', async ({ parts, from }) => {
      const a = dataArgs(parts);
      const _groupId = a.groupId ?? groupId;
      if (!_groupId)                                                  return { error: 'groupId-required' };
      if (!a.policy || typeof a.policy !== 'object')                  return { error: 'policy-required' };
      if (typeof a.msgId !== 'string' || !a.msgId)                    return { error: 'msgId-required' };

      const ts = typeof a.ts === 'number' && Number.isFinite(a.ts) ? a.ts : Date.now();

      if (!chat?.send) return { error: 'chat-unavailable', sent: 0, attempted: 0, errors: [] };
      if (!members)    return { error: 'members-unavailable', sent: 0, attempted: 0, errors: [] };

      const list = await members.list();
      const webids = new Set();
      for (const m of list ?? []) {
        const w = typeof m === 'string' ? m : (m?.webid ?? m?.webId ?? null);
        if (!w || w === from) continue;
        webids.add(w);
      }

      let sent = 0;
      const errors = [];
      await Promise.all([...webids].map(async (webid) => {
        try {
          const r = await chat.send({
            toWebid:  webid,
            subtype:  'kring-policy-broadcast',
            threadId: _groupId,
            body:     '',
            extras: {
              circleId:  _groupId,
              msgId:     a.msgId,
              ts,
              policy:    a.policy,
              fromActor: a.fromActor ?? from ?? null,
            },
          });
          if (r?.ok) sent += 1;
          else errors.push({ webid, reason: r?.reason ?? 'unknown' });
        } catch (err) {
          errors.push({ webid, reason: String(err?.message ?? err) });
        }
      }));
      metrics?.record?.('kring-policy-fanout');
      return { sent, attempted: webids.size, errors };
    }, {
      description: 'Fan a kring circlePolicy document out to every other member via chat.send subtype:kring-policy-broadcast; receivers cache as pending incomingPolicy for the γ.4 conflict resolver.',
      visibility:  'authenticated',
    }),

    /**
     * listKringChats({groupId?, sinceTs?, limit?})
     *   — SP-13.2.2 — list stored kring chat-message items, ordered
     *   oldest → newest (chat reading order).  Defaults: all circles,
     *   no time bound, capped at 200 most recent.  Hosts (canopy-chat
     *   web + mobile) call this at boot to rehydrate eventLog so the
     *   GESPREK tab shows historical chats after a reload.
     */
    defineSkill('listKringChats', async ({ parts }) => {
      const a = dataArgs(parts);
      const limit = Math.max(1, Math.min(1000,
        typeof a.limit === 'number' && Number.isFinite(a.limit) ? a.limit : 200,
      ));
      const open = await store.listOpen({ type: 'kring-chat-message' });
      let filtered = open;
      if (typeof a.groupId === 'string' && a.groupId) {
        filtered = filtered.filter((i) => i?.source?.circleId === a.groupId);
      }
      if (typeof a.sinceTs === 'number' && Number.isFinite(a.sinceTs)) {
        const cutoff = a.sinceTs;
        filtered = filtered.filter((i) => (i?.source?.ts ?? 0) > cutoff);
      }
      // Chat order: oldest at top, newest at bottom.  Slice tail when
      // over the limit so callers always get the freshest N entries.
      const sorted = filtered.slice().sort(
        (a, b) => (a?.source?.ts ?? 0) - (b?.source?.ts ?? 0),
      );
      const trimmed = sorted.length > limit ? sorted.slice(sorted.length - limit) : sorted;
      return { items: trimmed };
    }, {
      description: 'List stored kring chat-message items for boot-time eventLog rehydration.  Filters: groupId, sinceTs (exclusive), limit (default 200, max 1000).',
      visibility:  'authenticated',
    }),

    /**
     * getMessagesSince({groupId, sinceTs?, max?})
     *   — ε.3 (Phase 9 ε wave) — pod range-query catch-up entry point.
     *
     *   Reads chat-message envelopes from the local itemStore for a
     *   kring, filtered by `ts >= sinceTs`, optionally capped to `max`.
     *   Sibling of `listKringChats` (the boot rehydrator's read path),
     *   but reshaped to return the broadcast envelope shape so callers
     *   can feed results straight through the ε.1 chatMessageInbox:
     *
     *     { subtype: 'kring-chat-message', circleId, msgId, ts, text, fromActor }
     *
     *   Used by ε.3 catch-up's `podRangeQuery` handler for `pod: 'shared'`
     *   kringen — the receiver IS the pod that holds authoritative
     *   history, so no peer consent is needed for a member's own read.
     *   When shared-pod actually means cross-device pod sync, this skill
     *   is the stable interface that fronts that.
     *
     *   sinceTs is INCLUSIVE here (`ts >= sinceTs`) because catch-up's
     *   sinceTs typically comes from the inbox's last-seen LRU and we
     *   want to refetch the boundary message in case it was dropped
     *   (the inbox dedupes by msgId anyway, so an extra one is free).
     *   `listKringChats`'s exclusive cutoff serves a different caller
     *   (the rehydrator, which always reads everything fresh) — left
     *   unchanged.
     *
     *   Defaults: sinceTs=0 (full history), max=200, hard cap 1000.
     */
    defineSkill('getMessagesSince', async ({ parts }) => {
      const a = dataArgs(parts);
      const groupId = typeof a.groupId === 'string' ? a.groupId : '';
      const sinceTs = Number.isFinite(a.sinceTs) ? a.sinceTs : 0;
      const rawMax  = Number.isFinite(a.max)     ? a.max     : 200;
      const max     = Math.max(1, Math.min(rawMax, 1000));
      if (!groupId) return { items: [], truncated: false };

      // Mirror listKringChats's read pattern (same itemStore / same
      // shape) so any future change to the kring-chat item layout
      // only needs to be reflected here too.
      const all = await store.listOpen({ type: 'kring-chat-message' });
      const filtered = all
        .filter((it) => it?.source?.circleId === groupId)
        .filter((it) => {
          const ts = it?.source?.ts;
          return Number.isFinite(ts) && ts >= sinceTs;
        })
        .sort((x, y) => (x?.source?.ts ?? 0) - (y?.source?.ts ?? 0));

      const truncated = filtered.length > max;
      // When over cap, keep the freshest N — same policy as
      // listKringChats, since the receiver's caught-up state is what
      // matters; older messages get backfilled by a follow-up call
      // with an earlier sinceTs if needed.
      const trimmedItems = filtered.length > max
        ? filtered.slice(filtered.length - max)
        : filtered;
      const items = trimmedItems.map((it) => ({
        subtype:   'kring-chat-message',
        circleId:  it?.source?.circleId ?? groupId,
        msgId:     it?.source?.msgId ?? it.id,
        ts:        it?.source?.ts,
        text:      it.text ?? '',
        fromActor: it?.source?.fromActor ?? it?.source?.fromWebid ?? null,
      }));
      return { items, truncated };
    }, {
      description: 'Read kring chat-message envelopes from itemStore filtered by ts >= sinceTs; returns broadcast envelope shape for ε.3 pod-range-query catch-up.  Args: groupId (required), sinceTs (default 0), max (default 200, cap 1000).',
      visibility:  'authenticated',
    }),

    /**
     * ingestKringMessage({payload, fromPubKey, fromNknAddr})
     *   — SP-13.2.1 — receive-side mirror for an inbound kring chat
     *   envelope.  Sibling of `ingestRemotePost` for the buurt-post
     *   path: dedupe + eviction + mute filtering + addItems.  Hosts
     *   (canopy-chat web + mobile) call this from their kring-chat
     *   peer-router handler instead of writing to eventLog directly.
     *
     *   Returns: { ok: true, itemId } | { deduped: true } |
     *            { evicted: true } | { muted: true } | { error }.
     */
    defineSkill('ingestKringMessage', async ({ parts }) => {
      const a = dataArgs(parts);
      const payload = a.payload;
      const fromPubKey = typeof a.fromPubKey === 'string' ? a.fromPubKey : null;
      const fromNknAddr = typeof a.fromNknAddr === 'string' ? a.fromNknAddr : null;
      if (!payload || typeof payload !== 'object') return { error: 'payload required' };

      const circleId = payload.circleId;
      const msgId    = payload.msgId;
      const text     = payload.text;
      const ts       = typeof payload.ts === 'number' && Number.isFinite(payload.ts) ? payload.ts : Date.now();
      if (typeof circleId !== 'string' || !circleId) return { error: 'circleId required' };
      if (typeof msgId    !== 'string' || !msgId)    return { error: 'msgId required' };
      if (typeof text     !== 'string' || !text)     return { error: 'text required' };

      // Eviction filter — drop chats from members who left/were evicted.
      const evictionRoster = bundle?.evictionRoster ?? null;
      if (evictionRoster) {
        const fromWebid = payload.fromActor ?? payload.fromWebid ?? null;
        if (fromWebid && evictionRoster.isEvicted(fromWebid)) return { evicted: true };
      }

      // Mute filter — drop chats from peers I've muted locally
      // (same shape as wireChat's broadcast-post branch).
      if (muted && (
        (payload.fromStableId && muted.has(payload.fromStableId)) ||
        (payload.fromActor    && muted.has(payload.fromActor)) ||
        (payload.fromWebid    && muted.has(payload.fromWebid))
      )) return { muted: true };

      // Dedupe by msgId — O(N) over open kring-chat items.
      const open = await store.listOpen({ type: 'kring-chat-message' });
      if (open.some((i) => i?.source?.msgId === msgId)) return { deduped: true };

      const [item] = await store.addItems([{
        type:       'kring-chat-message',
        text,
        visibility: 'household',
        source: {
          circleId,
          msgId,
          ts,
          fromActor: payload.fromActor ?? null,
          fromWebid: payload.fromWebid ?? null,
          fromPubKey,
          ...(fromNknAddr ? { fromNknAddr } : {}),
        },
      }], {
        actor: payload.fromActor ?? payload.fromWebid ?? (fromPubKey ? `pubkey:${fromPubKey.slice(0, 12)}` : 'remote'),
      });
      metrics?.record?.('kring-chat-ingest');
      return { ok: true, itemId: item.id };
    }, {
      description: 'Ingest an inbound kring chat-message envelope into the local itemStore (mute + eviction filtered, dedupes on msgId).',
      visibility:  'authenticated',
    }),

    /**
     * postAnnouncement({text, groupId?})
     *   — admin-only.  Persists a `kind: 'announcement'` item that
     *   the board pins at the top.  Visibility / pinning is a
     *   client-side rendering choice; the storage shape is what
     *   makes it discoverable.
     */
    defineSkill('postAnnouncement', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.text !== 'string' || !a.text) return { error: 'text required' };
      const _groupId = a.groupId ?? groupId;
      // Lightweight admin gate: caller must be in the configured
      // admin list for the group.  V1 reads from `members`'s `role`
      // field; pre-Phase-11 entries default to non-admin.
      if (members) {
        const me = await members.resolveByWebid(from);
        const isAdmin = me?.role === 'admin' || me?.role === 'coordinator';
        if (!isAdmin) return { error: 'admin-only' };
      }
      const [item] = await store.addItems([{
        type:       'announcement',
        text:       a.text,
        visibility: 'household',
        source:     { groupId: _groupId, postedBy: from, postedAt: Date.now() },
      }], { actor: from });

      // Phase 52.7 — warn-only canonical-shape validation. Adoption is
      // observational: log drift but never block a write.
      try {
        const v = validateCanonical(item);
        if (!v.ok) console.warn('item-types[announcement]:', JSON.stringify(v.errors));
      } catch { /* validator outage must not break writes */ }

      return { announcementId: item.id };
    }, {
      description: 'Admin-only: post a group-wide announcement pinned to the board.',
      visibility:  'authenticated',
    }),

    /**
     * editGroupRules({groupId, rules})
     *   — admin-only.  Re-runs the create-group wizard's persistence
     *   step with new rules.  Latest-wins per `getGroupRules`.
     */
    defineSkill('editGroupRules', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.groupId !== 'string' || !a.groupId) return { error: 'groupId required' };
      if (typeof a.rules !== 'object' || a.rules === null) return { error: 'rules object required' };
      if (members) {
        const me = await members.resolveByWebid(from);
        const isAdmin = me?.role === 'admin' || me?.role === 'coordinator';
        if (!isAdmin) return { error: 'admin-only' };
      }
      const [item] = await store.addItems([{
        type:       'group-rules',
        text:       a.rules.name ?? a.groupId,
        source:     { groupId: a.groupId, rules: a.rules, version: (a.rules.version ?? 0) + 1 },
        visibility: 'household',
      }], { actor: from });
      return { rulesId: item.id, version: a.rules.version ?? 0 + 1 };
    }, {
      description: 'Admin-only: replace the group\'s rules with a new version.',
      visibility:  'authenticated',
    }),

    /**
     * removeMember({memberStableId? | memberWebid?, groupId?, reason?})
     *   — admin-only.  Records a `kind: 'group-removal'` audit item
     *   carrying the target member's identity + the reason.  This is
     *   the *intent record*; the relay-side revocation list (Phase 2)
     *   is updated by an external operator step (the Stoop Relay
     *   Kit, V2).  In V1 the admin's local state notes the removal
     *   so the next group-rules push can include it.
     */
    defineSkill('removeMember', async ({ parts, from }) => {
      const a = dataArgs(parts);
      const _groupId = a.groupId ?? groupId;
      if (!_groupId) return { error: 'groupId required' };
      if (!a.memberStableId && !a.memberWebid) {
        return { error: 'memberStableId or memberWebid required' };
      }
      if (members) {
        const me = await members.resolveByWebid(from);
        const isAdmin = me?.role === 'admin' || me?.role === 'coordinator';
        if (!isAdmin) return { error: 'admin-only' };
      }
      const [item] = await store.addItems([{
        type:       'group-removal',
        text:       `${a.memberWebid ?? a.memberStableId} removed from ${_groupId}`,
        visibility: 'household',
        source: {
          groupId:        _groupId,
          memberStableId: a.memberStableId ?? null,
          memberWebid:    a.memberWebid    ?? null,
          removedBy:      from,
          removedAt:      Date.now(),
          reason:         a.reason ?? null,
        },
      }], { actor: from });
      return { removalId: item.id };
    }, {
      description: 'Admin-only: record a member removal (intent; relay-side revocation is operator-driven).',
      visibility:  'authenticated',
    }),

    // ── Stoop V1 Phase 17 (2026-05-06) — onboarding polish ───────────────

    /**
     * getMnemonicOnce()
     *   — returns the agent's BIP39 mnemonic ONCE per onboarding flow.
     *   If `markMnemonicShown` already flipped, returns
     *   `{shown: true, mnemonic: null}`; otherwise returns the
     *   mnemonic and atomically marks-shown so a refresh in the
     *   modal doesn't leak the phrase a second time.
     */
    defineSkill('getMnemonicOnce', async ({ from, agent }) => {
      if (!members) return { error: 'no-member-map' };
      const me = await members.resolveByWebid(from);
      const alreadyShown = me?.externalIds?.mnemonicShown === 'true';
      if (alreadyShown) return { shown: true, mnemonic: null };
      const mnemonic = await agent.identity?.getMnemonic?.() ?? null;
      const meRow = me ?? { webid: from };
      const externalIds = { ...(meRow.externalIds ?? {}), mnemonicShown: 'true' };
      await members.addMember({ ...meRow, externalIds });
      return { shown: false, mnemonic };
    }, {
      description: 'One-time recovery-phrase reveal during first-run; subsequent calls return {shown: true, mnemonic: null}.',
      visibility:  'authenticated',
    }),

    /**
     * getInviteQrPayload({invite})
     *   — produce the canonical string an invite QR encodes.  Apps
     *   pass this to any QR-rendering library; Stoop ships no
     *   renderer.  Wire shape: a `stoop-invite://` URL whose path
     *   is a compact-JSON base64url-encoded invite token.
     */
    defineSkill('getInviteQrPayload', async ({ parts }) => {
      const a = dataArgs(parts);
      if (!a.invite || typeof a.invite !== 'object') return { error: 'invite required' };
      return { payload: `stoop-invite://${_encodeQrPayload(a.invite)}` };
    }, {
      description: 'Canonical encoding of an invite for QR/URL display.',
      visibility:  'authenticated',
    }),

    /**
     * getContactShareQr({trustOffer? = 'bekend'})  — Phase 24.5.
     *   Produce a `stoop-contact://` payload containing the calling
     *   actor's webid + pubKey + handle + optional avatar/displayName
     *   + the offered trust level.  Recipient scans and decides
     *   themselves whether to accept; trustOffer is a *suggestion*,
     *   not coerced.
     */
    defineSkill('getContactShareQr', async ({ parts, from, agent }) => {
      const a = dataArgs(parts);
      const trustOffer = (a.trustOffer === 'vertrouwd' || a.trustOffer === 'bekend')
        ? a.trustOffer : 'bekend';
      const me = members ? await members.resolveByWebid(from) : null;
      const card = {
        webid:        from,
        pubKey:       me?.pubKey       ?? agent?.identity?.pubKey ?? null,
        stableId:     me?.stableId     ?? agent?.identity?.stableId ?? null,
        handle:       me?.handle       ?? null,
        displayName:  me?.displayName  ?? null,
        avatarUrl:    me?.avatarUrl    ?? null,
        trustOffer,
        // 2026-05-27 — embed the caller's NKN peer address so the
        // scanner can DM the contact straight after add, without
        // needing a Solid pod lookup (lookupPeerNknByWebid).  Caller
        // (canopy-chat's realAgent) passes args.nknAddr; the stoop
        // substrate doesn't have its own NKN identity.
        ...(typeof a.nknAddr === 'string' && a.nknAddr ? { nknAddr: a.nknAddr } : {}),
      };
      return { payload: `stoop-contact://${_encodeQrPayload(card)}` };
    }, {
      description: 'Canonical QR/URL payload for sharing this actor as a contact.',
      visibility:  'authenticated',
    }),

    /**
     * addContactFromQr({payload})  — Phase 24.5.
     *   Parse a `stoop-contact://` payload and add the contact
     *   to the local ContactBook.  Honours the `trustOffer` from
     *   the QR (defaults to 'bekend' if missing).  Asymmetric —
     *   adding a contact here does *not* notify them; that's
     *   Phase 24.6's contact-add-request envelope.
     */
    defineSkill('addContactFromQr', async ({ parts }) => {
      const a = dataArgs(parts);
      if (typeof a.payload !== 'string' || !a.payload.startsWith('stoop-contact://')) {
        return { error: 'invalid-payload' };
      }
      if (!bundle?.contacts) return { error: 'no-contacts' };
      const card = _decodeQrPayload(a.payload.slice('stoop-contact://'.length));
      if (!card?.webid) return { error: 'malformed-card' };
      if (typeof console !== 'undefined') {
        console.log('[stoop/addContactFromQr] card.nknAddr=' + (card.nknAddr ? (card.nknAddr.slice(0,16)+'…') : 'NONE') + ' for webid=' + String(card.webid).slice(0, 32));
      }
      const trustLevel = card.trustOffer === 'vertrouwd' || card.trustOffer === 'bekend'
        ? card.trustOffer : 'bekend';
      const m = await bundle.contacts.addContact({
        webid:       card.webid,
        pubKey:      card.pubKey      ?? null,
        stableId:    card.stableId    ?? null,
        handle:      card.handle      ?? null,
        displayName: card.displayName ?? null,
        avatarUrl:   card.avatarUrl   ?? null,
        // 2026-05-27 — preserve the NKN peer address embedded in the
        // QR card so the chat-shell can DM straight after add.
        ...(typeof card.nknAddr === 'string' && card.nknAddr ? { nknAddr: card.nknAddr } : {}),
        trustLevel,
      });
      metrics?.record?.('contact-added-from-qr');
      return { contact: m };
    }, {
      description: 'Add a contact from a stoop-contact:// QR/URL payload.',
      visibility:  'authenticated',
    }),

    /**
     * requestContactAdd({toWebid | toStableId | toPubKey, trustOffer?})
     *   — Phase 24.6.  Send a `contact-add-request` envelope to the
     *   peer.  Payload includes the calling actor's WebID / pubKey /
     *   handle / avatar so the receiver's UI can render an
     *   "Anna wants to add you as a contact" prompt without a
     *   pre-existing MemberMap entry.  Asymmetric — adding the
     *   contact locally is the caller's separate decision.
     */
    defineSkill('requestContactAdd', async ({ parts, from, agent }) => {
      if (!chat) return { error: 'chat-not-wired' };
      const a = dataArgs(parts);
      const trustOffer = (a.trustOffer === 'vertrouwd' || a.trustOffer === 'bekend')
        ? a.trustOffer : 'bekend';
      const me = members ? await members.resolveByWebid(from) : null;
      const r = await chat.send({
        toWebid:    a.toWebid,
        toStableId: a.toStableId,
        toPubKey:   a.toPubKey,
        subtype:    'contact-add-request',
        extras: {
          handle:      me?.handle      ?? null,
          displayName: me?.displayName ?? null,
          avatarUrl:   me?.avatarUrl   ?? null,
          trustOffer,
        },
      });
      if (r.ok) metrics?.record?.('contact-request-sent');
      return r.ok ? { ok: true } : { error: r.reason };
    }, {
      description: 'Send a contact-add-request envelope; receiver decides asymmetrically.',
      visibility:  'authenticated',
    }),

    /**
     * acceptContactRequest({requestId})
     *   — Phase 24.6.  Mark the contact-request item complete and
     *   add the requester to the local ContactBook at the offered
     *   trust level.
     */
    defineSkill('acceptContactRequest', async ({ parts, from }) => {
      if (!bundle?.contacts) return { error: 'no-contacts' };
      const a = dataArgs(parts);
      if (typeof a.requestId !== 'string' || !a.requestId) return { error: 'requestId required' };
      const item = await store.getById(a.requestId);
      if (!item || item.type !== 'contact-request') return { error: 'not-found' };
      const card = item.source ?? {};
      const trustLevel = card.trustOffer === 'vertrouwd' || card.trustOffer === 'bekend'
        ? card.trustOffer : 'bekend';
      const m = await bundle.contacts.addContact({
        webid:       card.fromWebid,
        pubKey:      card.fromPubKey ?? null,
        stableId:    card.fromStableId ?? null,
        handle:      card.handle      ?? null,
        displayName: card.displayName ?? null,
        avatarUrl:   card.avatarUrl   ?? null,
        trustLevel,
      });
      // Close the request item so the UI prompt clears.
      try { await store.markComplete([{ id: a.requestId }], { actor: from }); } catch {}
      metrics?.record?.('contact-request-accepted');
      return { ok: true, contact: m };
    }, {
      description: 'Accept an incoming contact-add request; adds the requester at their offered trust level.',
      visibility:  'authenticated',
    }),

    /** declineContactRequest({requestId}) — closes the prompt; does NOT add. */
    defineSkill('declineContactRequest', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.requestId !== 'string' || !a.requestId) return { error: 'requestId required' };
      const item = await store.getById(a.requestId);
      if (!item || item.type !== 'contact-request') return { error: 'not-found' };
      try { await store.markComplete([{ id: a.requestId }], { actor: from }); } catch {}
      metrics?.record?.('contact-request-declined');
      return { ok: true };
    }, {
      description: 'Decline an incoming contact-add request (closes the prompt).',
      visibility:  'authenticated',
    }),

    /** listContactRequests() — open `kind: 'contact-request'` items. */
    defineSkill('listContactRequests', async () => {
      const open = await store.listOpen({ type: 'contact-request' });
      return { requests: open };
    }, {
      description: 'List open contact-add requests addressed to me.',
      visibility:  'authenticated',
    }),

    /**
     * redeemInviteWithGate({invite, privacyAccepted, rulesAccepted})
     *   — Phase-17 onboarding-gated invite redeem.  BOTH flags MUST
     *   be `true` (user explicitly tapped Akkoord on privacy notice +
     *   group rules); rejects otherwise.  Records the acceptance as
     *   a `kind: 'rules-accept'` audit item; the actual GroupManager
     *   redemption is `redeemInvite` (existing) called by the UI
     *   after this gate clears.
     */
    defineSkill('redeemInviteWithGate', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (!a.invite) return { error: 'invite required' };
      if (a.privacyAccepted !== true) return { error: 'privacy-not-accepted' };
      if (a.rulesAccepted   !== true) return { error: 'rules-not-accepted' };
      const _groupId = a.invite?.groupId;
      if (!_groupId) return { error: 'invite missing groupId' };
      const [item] = await store.addItems([{
        type:       'rules-accept',
        text:       `Accepted rules of ${_groupId}`,
        source:     { groupId: _groupId, acceptedBy: from, acceptedAt: Date.now(), gateVersion: 'phase-17' },
        visibility: 'household',
      }], { actor: from });
      return { ok: true, groupId: _groupId, acceptanceId: item.id };
    }, {
      description: 'Phase 17 gated redeem — verify privacy + rules acceptance before downstream redeem.',
      visibility:  'authenticated',
    }),

    /**
     * listReports({groupId?})
     *   — admin-only.  Returns all `kind: 'report'` items for the
     *   group, oldest first so admins see the queue in arrival order.
     */
    defineSkill('listReports', async ({ parts, from }) => {
      const a = dataArgs(parts);
      const _groupId = a.groupId ?? groupId;
      if (members) {
        const me = await members.resolveByWebid(from);
        const isAdmin = me?.role === 'admin' || me?.role === 'coordinator';
        if (!isAdmin) return { error: 'admin-only' };
      }
      const all = await store.listOpen({ type: 'report' });
      return { reports: all.sort((p, q) => (p.addedAt ?? 0) - (q.addedAt ?? 0)) };
    }, {
      description: 'Admin-only: list all open reports for a group.',
      visibility:  'authenticated',
    }),

    /**
     * startPodSignIn({ issuer, redirectUrl })
     *   — Phase 20.  Begin Solid OIDC sign-in.  Returns the IdP's
     *   authorize URL for the browser to navigate to.  After the
     *   IdP redirects back to `redirectUrl`, the page calls
     *   `completePodSignIn` with the full callback URL.
     */
    defineSkill('startPodSignIn', async ({ parts }) => {
      const a = dataArgs(parts);
      const r = await startPodSignIn({
        bundle, issuer: a.issuer, redirectUrl: a.redirectUrl,
      });
      if (r.ok) metrics?.record?.('pod-sign-in-start');
      return r;
    }, {
      description: 'Begin Solid OIDC sign-in; returns the authorize URL.',
      visibility:  'authenticated',
    }),

    /**
     * completePodSignIn({ callbackUrl })
     *   — Phase 20.  Complete the OIDC dance + attach a SolidPodSource.
     */
    defineSkill('completePodSignIn', async ({ parts }) => {
      const a = dataArgs(parts);
      const r = await completePodSignIn({
        bundle, callbackUrl: a.callbackUrl,
      });
      if (r.ok) metrics?.record?.('pod-sign-in-complete');
      return r;
    }, {
      description: 'Complete OIDC sign-in + attach SolidPodSource to the bundle cache.',
      visibility:  'authenticated',
    }),

    /**
     * signOutOfPod()
     *   — Phase 20.  Clears OIDC tokens + detaches the pod inner.
     *   Local cache state is preserved.
     */
    defineSkill('signOutOfPod', async () => {
      const r = await signOutOfPod({ bundle });
      metrics?.record?.('pod-sign-out');
      return r;
    }, {
      description: 'Sign out of the pod; local cache is preserved.',
      visibility:  'authenticated',
    }),

    /**
     * podSignInStatus()
     *   — Phase 20.  Returns `{ signedIn, webid?, podAttached }`.
     */
    defineSkill('podSignInStatus', async () => podSignInStatus({ bundle }), {
      description: 'Read-only Solid pod sign-in status.',
      visibility:  'authenticated',
    }),

    /**
     * listEvictedMembers()
     *   — Phase 35 (V2.5, 2026-05-06).  Returns the webids whose
     *   most-recent membership-redemption has expired (past
     *   `expiresAt + GRACE_MS`).  Posts from these members are
     *   silently dropped on the receive side; the UI uses this
     *   skill to render a banner on /group.html.
     */
    defineSkill('listEvictedMembers', async () => ({
      evicted: bundle?.evictionRoster?.listEvicted() ?? [],
    }), {
      description: 'List webids whose membership has expired past the grace window.',
      visibility:  'authenticated',
    }),

    /**
     * getAttachmentDataUrl({itemId, attId})  — Phase 39 (V2.5).
     *   Read the locally-cached bytes for an attachment and return
     *   a `data:<mime>;base64,...` URL the browser can drop straight
     *   into an <img> tag.  Returns `{error: 'no-bytes'}` when the
     *   bytes aren't on this machine yet (caller should call
     *   `requestAttachment` first and re-poll).
     */
    defineSkill('getAttachmentDataUrl', async ({ parts }) => {
      const a = dataArgs(parts);
      if (typeof a.itemId !== 'string' || !a.itemId) return { error: 'itemId required' };
      if (typeof a.attId  !== 'string' || !a.attId)  return { error: 'attId required' };
      if (!bundle?.cache) return { error: 'no-cache' };

      const item = await store.getById(a.itemId);
      if (!item) return { error: 'item-not-found' };
      const attachments = Array.isArray(item.source?.attachments) ? item.source.attachments : [];
      const att = attachments.find(x => x?.id === a.attId);
      if (!att) return { error: 'attachment-not-found' };
      if (!att.ref) return { error: 'no-bytes' };

      const dataB64 = await readAttachmentBytesB64({ dataSource: bundle.cache, ref: att.ref })
        .catch(() => null);
      if (!dataB64) return { error: 'no-bytes' };
      return { ok: true, dataUrl: `data:${att.mime};base64,${dataB64}` };
    }, {
      description: 'Return a data: URL for a locally-cached attachment.',
      visibility:  'authenticated',
    }),

    /**
     * requestAttachment({itemId, attId})  — Phase 39 (V2.5).
     *   Fetch the full bytes for an attachment that we currently
     *   only have a thumbnail for.  Looks up the item's
     *   `source.fromPubKey` (the original author), sends a
     *   `subtype: 'attachment-request'` chat envelope, and returns
     *   immediately.  When the response lands, `wireChat` writes
     *   the bytes locally + patches the item with the local `ref`
     *   AND emits `agent.on('stoop:attachment-fetched', ...)`.
     *   The UI listens for that event to refresh.
     *
     *   Returns `{ok: true}` when the request was dispatched; does
     *   NOT block on the response.  When the bytes are already
     *   local (we authored the post, or already fetched), returns
     *   `{ok: true, ref}` immediately.
     */
    defineSkill('requestAttachment', async ({ parts }) => {
      const a = dataArgs(parts);
      if (typeof a.itemId !== 'string' || !a.itemId) return { error: 'itemId required' };
      if (typeof a.attId  !== 'string' || !a.attId)  return { error: 'attId required' };

      const item = await store.getById(a.itemId);
      if (!item) return { error: 'item-not-found' };
      const attachments = Array.isArray(item.source?.attachments) ? item.source.attachments : [];
      const att = attachments.find(x => x?.id === a.attId);
      if (!att) return { error: 'attachment-not-found' };
      if (att.ref) return { ok: true, ref: att.ref };  // already local

      const fromPubKey = item.source?.fromPubKey;
      if (!fromPubKey) return { error: 'no-author-pubkey' };
      if (typeof agent?.transportFor !== 'function') return { error: 'no-transport' };

      try {
        // Per-peer routing — `agent.transport` is the primary slot
        // (InternalTransport on mobile, self-loop only).  Without
        // this, the attachment-request envelope never reaches the
        // remote post author.
        const t = await agent.transportFor(fromPubKey);
        await t.sendOneWay(fromPubKey, {
          type:  'message',
          parts: [{ type: 'DataPart', data: {
            type:         'stoop-chat',
            subtype:      'attachment-request',
            itemId:       a.itemId,
            attId:        a.attId,
            fromWebid:    bundle?.agent?.identity ? from : null,
            fromStableId: bundle?.agent?.identity?.stableId ?? null,
            sentAt:       Date.now(),
          }}],
        });
      } catch (err) {
        return { error: `transport: ${err?.message ?? err}` };
      }
      metrics?.record?.('attachment-requested');
      return { ok: true, pending: true };
    }, {
      description: 'Request the full bytes for an attachment from its original author.',
      visibility:  'authenticated',
    }),

    /**
     * getBulkSyncStatus()
     *   — Phase 34 (V2.5, 2026-05-06).  Reports the latest snapshot
     *   of the cache's bulk-sync state during attachInner.  Phases:
     *     - 'idle'     before any attach (or no cache).
     *     - 'running'  bulk-sync in flight; `done` and `total` move.
     *     - 'finished' last attach completed cleanly.
     *     - 'error'    last attach errored mid-flush.
     *   The UI on /auth-callback.html polls this while
     *   `completePodSignIn` is in flight to render a progress bar.
     */
    defineSkill('getBulkSyncStatus', async () => ({
      bulkSync: bundle?.bulkSyncState ?? {
        phase: 'idle', done: 0, total: 0, errored: false, updatedAt: null,
      },
    }), {
      description: 'Read-only snapshot of the CachingDataSource bulk-sync progress.',
      visibility:  'authenticated',
    }),

    /* ── Phase 26: Geo (location + geocoding + distance) ────── */

    /**
     * geocode({query, gridM?})
     *   — Phase 26.2.  Place-name → coarse cell + label via
     *   Nominatim.  Returns `{cell, label, source: 'geocode', raw}`
     *   or `{error}`.  Tests stub via `_setHttpFactory` in
     *   `lib/geocode.js`.
     */
    defineSkill('geocode', async ({ parts }) => {
      const a = dataArgs(parts);
      return geocode({ query: a.query, gridM: a.gridM });
    }, {
      description: 'Place-name → coarse-grain cell via OpenStreetMap Nominatim.',
      visibility:  'authenticated',
    }),

    /**
     * setMyLocation({cell, label?, source?})
     *   — Phase 26.3.  Persists `{cell, label, source}` on the local
     *   actor's MemberMap entry.  `source` is one of `'gps'`,
     *   `'geocode'`, or `null`.  No validation of the cell shape —
     *   the caller is trusted (`geo.js#cellFor` produces it).
     */
    defineSkill('setMyLocation', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.cell !== 'string' || !a.cell) return { error: 'cell required' };
      if (!members) return { error: 'no-member-map' };
      const me = (await members.resolveByWebid(from)) ?? { webid: from };
      const updated = await members.addMember({
        ...me,
        location: {
          cell:   a.cell,
          label:  typeof a.label  === 'string' ? a.label  : null,
          source: a.source === 'gps' || a.source === 'geocode' ? a.source : null,
        },
      });
      return { location: updated.location };
    }, {
      description: 'Set the calling actor\'s coarse location {cell, label, source}.',
      visibility:  'authenticated',
    }),

    /** clearMyLocation() — drop the location field. */
    defineSkill('clearMyLocation', async ({ from }) => {
      if (!members) return { error: 'no-member-map' };
      const me = (await members.resolveByWebid(from)) ?? { webid: from };
      const updated = await members.addMember({ ...me, location: null });
      return { location: updated.location };
    }, {
      description: 'Clear the calling actor\'s coarse location.',
      visibility:  'authenticated',
    }),

    /** getMyLocation() — read the calling actor's location. */
    defineSkill('getMyLocation', async ({ from }) => {
      if (!members) return { location: null };
      const me = await members.resolveByWebid(from);
      return { location: me?.location ?? null };
    }, {
      description: 'Read the calling actor\'s coarse location.',
      visibility:  'authenticated',
    }),

    /** distancePresets() — return the post-composer's distance presets (km). */
    defineSkill('distancePresets', async () => ({ presets: [...DISTANCE_PRESETS] }), {
      description: 'Return the distance presets used by the post composer.',
      visibility:  'authenticated',
    }),

    /* ── Phase 24: Contact graph + lists ────────────────────── */

    /**
     * addContact({webid, pubKey?, handle?, displayName?, trustLevel?, tags?, ...})
     *   — upsert a contact in the calling actor's ContactBook.
     *   Sets `relation: 'contact'` on the MemberMap entry.
     *   Asymmetric: doesn't notify the contact themselves
     *   (Phase 24.6 wires the contact-add-request envelope).
     */
    defineSkill('addContact', async ({ parts }) => {
      const a = dataArgs(parts);
      if (!bundle?.contacts) return { error: 'no-contacts' };
      if (typeof a.webid !== 'string' || !a.webid) return { error: 'webid required' };
      try {
        const m = await bundle.contacts.addContact(a);
        metrics?.record?.('contact-added');
        return { contact: m };
      } catch (err) {
        return { error: err?.message ?? String(err) };
      }
    }, {
      description: 'Add or update a 1:1 contact.',
      visibility:  'authenticated',
    }),

    /** removeContact({webid}) — drop a contact (and remove from any lists). */
    defineSkill('removeContact', async ({ parts }) => {
      const a = dataArgs(parts);
      if (!bundle?.contacts) return { error: 'no-contacts' };
      if (typeof a.webid !== 'string' || !a.webid) return { error: 'webid required' };
      await bundle.contacts.removeContact(a.webid);
      metrics?.record?.('contact-removed');
      return { ok: true };
    }, {
      description: 'Remove a 1:1 contact (drops MemberMap entry; removes from lists).',
      visibility:  'authenticated',
    }),

    /** setContactTrust({webid, level: 'bekend'|'vertrouwd'|null}) */
    defineSkill('setContactTrust', async ({ parts }) => {
      const a = dataArgs(parts);
      if (!bundle?.contacts) return { error: 'no-contacts' };
      try {
        const m = await bundle.contacts.setTrustLevel(a.webid, a.level ?? null);
        return { contact: m };
      } catch (err) {
        return { error: err?.message ?? String(err) };
      }
    }, {
      description: 'Set a contact\'s trust level (bekend / vertrouwd / null).',
      visibility:  'authenticated',
    }),

    /** setContactTags({webid, tags: string[]}) */
    defineSkill('setContactTags', async ({ parts }) => {
      const a = dataArgs(parts);
      if (!bundle?.contacts) return { error: 'no-contacts' };
      try {
        const m = await bundle.contacts.setTags(a.webid, a.tags ?? []);
        return { contact: m };
      } catch (err) {
        return { error: err?.message ?? String(err) };
      }
    }, {
      description: 'Replace the per-contact tag list.',
      visibility:  'authenticated',
    }),

    /** setContactFlag({webid, flag, value}) */
    defineSkill('setContactFlag', async ({ parts }) => {
      const a = dataArgs(parts);
      if (!bundle?.contacts) return { error: 'no-contacts' };
      try {
        const m = await bundle.contacts.setFlag(a.webid, a.flag, !!a.value);
        return { contact: m };
      } catch (err) {
        return { error: err?.message ?? String(err) };
      }
    }, {
      description: 'Toggle a per-contact flag (shareLocation / allowHopThrough / allowAutomatching).',
      visibility:  'authenticated',
    }),

    /** listContacts({minTrust?, tag?}) — filter by trust or tag. */
    defineSkill('listContacts', async ({ parts }) => {
      const a = dataArgs(parts);
      if (!bundle?.contacts) return { contacts: [] };
      let contacts;
      if (a.tag) contacts = await bundle.contacts.listContactsByTag(a.tag);
      else if (a.minTrust) contacts = await bundle.contacts.listContactsByMinTrust(a.minTrust);
      else contacts = await bundle.contacts.listContacts();
      return { contacts };
    }, {
      description: 'List contacts; optional minTrust ("bekend"|"vertrouwd") or tag filter.',
      visibility:  'authenticated',
    }),

    // ── Lists ──────────────────────────────────────────────────

    defineSkill('createContactList', async ({ parts }) => {
      const a = dataArgs(parts);
      if (!bundle?.contacts) return { error: 'no-contacts' };
      if (typeof a.name !== 'string' || !a.name.trim()) return { error: 'name required' };
      const list = await bundle.contacts.createList(a.name);
      return { list };
    }, {
      description: 'Create a new contact list.',
      visibility:  'authenticated',
    }),

    defineSkill('deleteContactList', async ({ parts }) => {
      const a = dataArgs(parts);
      if (!bundle?.contacts) return { error: 'no-contacts' };
      if (!a.listId) return { error: 'listId required' };
      await bundle.contacts.deleteList(a.listId);
      return { ok: true };
    }, {
      description: 'Delete a contact list.',
      visibility:  'authenticated',
    }),

    defineSkill('renameContactList', async ({ parts }) => {
      const a = dataArgs(parts);
      if (!bundle?.contacts) return { error: 'no-contacts' };
      try {
        const list = await bundle.contacts.renameList(a.listId, a.name);
        return { list };
      } catch (err) {
        return { error: err?.message ?? String(err) };
      }
    }, {
      description: 'Rename a contact list.',
      visibility:  'authenticated',
    }),

    defineSkill('addToContactList', async ({ parts }) => {
      const a = dataArgs(parts);
      if (!bundle?.contacts) return { error: 'no-contacts' };
      try {
        const list = await bundle.contacts.addToList(a.listId, a.webid);
        return { list };
      } catch (err) {
        return { error: err?.message ?? String(err) };
      }
    }, {
      description: 'Add a contact (by webid) to a list.',
      visibility:  'authenticated',
    }),

    defineSkill('removeFromContactList', async ({ parts }) => {
      const a = dataArgs(parts);
      if (!bundle?.contacts) return { error: 'no-contacts' };
      try {
        const list = await bundle.contacts.removeFromList(a.listId, a.webid);
        return { list };
      } catch (err) {
        return { error: err?.message ?? String(err) };
      }
    }, {
      description: 'Remove a contact from a list.',
      visibility:  'authenticated',
    }),

    defineSkill('listContactLists', async () => {
      if (!bundle?.contacts) return { lists: [] };
      const lists = await bundle.contacts.listLists();
      return { lists };
    }, {
      description: 'List all contact lists.',
      visibility:  'authenticated',
    }),

    defineSkill('getContactList', async ({ parts }) => {
      const a = dataArgs(parts);
      if (!bundle?.contacts) return { list: null };
      if (!a.listId) return { error: 'listId required' };
      const list = await bundle.contacts.getList(a.listId);
      return { list };
    }, {
      description: 'Read one contact list by listId.',
      visibility:  'authenticated',
    }),

    /**
     * validateMnemonicPhrase({mnemonic})
     *   — Phase 30.1.  Validate a BIP-39 phrase + derive the agent
     *   pubKey it would yield.  Pure validation — does NOT swap the
     *   running bundle's identity.  The UI uses this on /restore.html
     *   to show "this is what your account will be" before the user
     *   commits to the restore flow.
     *
     *   To actually adopt the mnemonic-derived identity on a new
     *   device, the user calls `restoreFromMnemonic` (which writes
     *   the seed into the vault) and then restarts the Stoop
     *   process.  Mid-flight identity swap is V2.5+ — too invasive
     *   for V2.
     */
    defineSkill('validateMnemonicPhrase', async ({ parts }) => {
      const a = dataArgs(parts);
      if (typeof a.mnemonic !== 'string' || !a.mnemonic.trim()) {
        return { error: 'mnemonic required' };
      }
      try {
        if (!validateMnemonic(a.mnemonic)) return { error: 'invalid-mnemonic' };
        const seed = mnemonicToSeed(a.mnemonic);
        const kp = nacl.sign.keyPair.fromSeed(seed);
        const pubKey = Buffer.from(kp.publicKey).toString('base64')
          .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
        return { ok: true, pubKey };
      } catch (err) {
        return { error: err?.message ?? String(err) };
      }
    }, {
      description: 'Validate a BIP-39 mnemonic + return the derived agent pubKey.',
      visibility:  'authenticated',
    }),

    /**
     * restoreFromMnemonic({mnemonic, confirm})
     *   — Phase 30 + V2.5 Phase 31 (mid-flight identity swap).
     *
     *   Validates the mnemonic, persists the derived seed into the
     *   bundle's vault under `agent-privkey`, then SWAPS the running
     *   agent's identity in-place via `agent.swapIdentity`.  No
     *   restart needed; subsequent skills run under the restored
     *   identity immediately.
     *
     *   Caller MUST pass `confirm: true` — this is destructive: the
     *   previously-running identity is replaced.
     *
     *   The Phase 32 deterministic-stableId derivation means the
     *   restored bundle produces the SAME stableId as the original
     *   device, so mute / report / contact-cache state survives the
     *   restore.
     */
    defineSkill('restoreFromMnemonic', async ({ parts, agent }) => {
      const a = dataArgs(parts);
      if (typeof a.mnemonic !== 'string' || !a.mnemonic.trim()) {
        return { error: 'mnemonic required' };
      }
      if (a.confirm !== true) return { error: 'confirm: true required (destructive op)' };
      if (!validateMnemonic(a.mnemonic)) return { error: 'invalid-mnemonic' };

      const seed = mnemonicToSeed(a.mnemonic);
      const kp = nacl.sign.keyPair.fromSeed(seed);
      const newPubKey = Buffer.from(kp.publicKey).toString('base64')
        .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

      const vault = agent?.identity?.vault ?? null;
      if (!vault) return { error: 'no-vault' };

      // Persist the new seed into the vault.
      const entry = JSON.stringify({
        current: Buffer.from(seed).toString('base64')
          .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''),
        previous: null,
      });
      try {
        await vault.set('agent-privkey', entry);
      } catch (err) {
        return { error: `vault-set: ${err?.message ?? err}` };
      }
      // Drop any prior stableId so the new identity re-derives via
      // Phase 32's HKDF path.  Result: same mnemonic → same stableId
      // across devices.
      try { await vault.delete?.('agent-stable-id'); } catch {}

      // V2.5 Phase 31 — mid-flight identity swap.  Build a fresh
      // AgentIdentity (which loads the new seed + new stableId from
      // the vault) and hand it to the running agent.
      let newIdentity;
      try {
        newIdentity = await AgentIdentity.restore(vault);
      } catch (err) {
        return { error: `restore-identity: ${err?.message ?? err}` };
      }
      try {
        agent.swapIdentity(newIdentity);
      } catch (err) {
        return { error: `swap-identity: ${err?.message ?? err}` };
      }

      // Update the local actor's MemberMap entry so `whoAmI` and any
      // resolveByWebid(localActor) callers report the new pubKey +
      // stableId immediately.  Skip silently if no map.
      if (members) {
        try {
          const me = (await members.resolveByWebid(localActor)) ?? { webid: localActor };
          await members.addMember({
            ...me,
            pubKey:   newIdentity.pubKey,
            stableId: newIdentity.stableId,
          });
        } catch { /* best-effort */ }
      }

      // V2.5 Phase 31 scope: a fresh device's bundle has no peers
      // yet (restore flow runs before any group-rejoin), so there's
      // no peer-rebind to do at this point.  The agent's outbound
      // envelopes are now signed by the new key (handled inside
      // swapIdentity → SecurityLayer.swapIdentity).
      //
      // V3 mobile note: when the restore flow lands on a device with
      // pre-existing peer subscriptions (rejoining a buurt), this is
      // where we'd `await skillMatch.stop(); await skillMatch.start()`
      // to re-bind topic listeners.  Today it's a no-op.

      metrics?.record?.('identity-restored');
      return {
        ok: true,
        newPubKey,
        newStableId: newIdentity.stableId,
        message: 'Restored. You\'re signed in under the recovered identity.',
      };
    }, {
      description: 'Restore the agent identity from a BIP-39 mnemonic; takes effect immediately (Phase 31 mid-flight swap).',
      visibility:  'authenticated',
    }),

    /**
     * getHopMode()  — Phase 28.1.  Returns `{global}` reflecting
     * whether hop-relay is enabled for any contact on this device.
     * Mirror of `bundle.settings.allowHopThrough`.
     */
    defineSkill('getHopMode', async () => ({
      global: bundle?.settings?.allowHopThrough === true,
    }), {
      description: 'Read whether global hop-relay is enabled.',
      visibility:  'authenticated',
    }),

    /**
     * setHopMode({global})  — Phase 28.1.  Toggles
     * `bundle.settings.allowHopThrough` AND wires
     * `agent.enableRelayForward({policy: 'authenticated'})` when
     * turning on (idempotent at the SDK level).  When turning off,
     * policy is downgraded to `'never'` so the registered skill
     * rejects any relay request.  Stays registered to avoid
     * needing a restart; the policy gate is the actual switch.
     */
    defineSkill('setHopMode', async ({ parts, agent }) => {
      const a = dataArgs(parts);
      if (typeof a.global !== 'boolean') return { error: 'global (bool) required' };
      if (!bundle?.cache) return { error: 'no-cache (was cache: false?)' };

      const next = await updateSettingsLib({
        dataSource: bundle.cache,
        deviceId:   bundle?.deviceId ?? null,
        patch:      { allowHopThrough: a.global },
      });
      bundle.settings = next;

      try {
        if (a.global) {
          agent.enableRelayForward({ policy: 'authenticated' });
        } else if (agent?.config?.set) {
          agent.config.set('policy.allowRelayFor', 'never');
        }
      } catch (err) {
        return { error: `enableRelayForward failed: ${err?.message ?? err}` };
      }
      metrics?.record?.(a.global ? 'hop-mode-on' : 'hop-mode-off');
      return { global: a.global };
    }, {
      description: 'Enable or disable global hop-relay; persists in settings + flips core policy.',
      visibility:  'authenticated',
    }),

    /**
     * getSettings()  — Phase 23.5.  Read-only snapshot of cadence /
     * hop / broadcastable / defaultShareLocation settings.  Cached
     * in `bundle.settings`; reload from cache via `_reload: true`.
     */
    defineSkill('getSettings', async ({ parts }) => {
      const a = dataArgs(parts);
      if (a._reload && bundle?.cache) {
        bundle.settings = await loadSettings({
          dataSource: bundle.cache,
          deviceId:   bundle?.deviceId ?? null,
        });
      }
      return { settings: bundle?.settings ?? null };
    }, {
      description: 'Read the bundle\'s user-tunable settings (cadence + hop + broadcastable).',
      visibility:  'authenticated',
    }),

    /**
     * updateSettings({patch})  — Phase 23.5.  Patch a subset of the
     * settings; persists via the same CachingDataSource path that
     * MemberMap uses, so a connected pod gets the update too.
     * Returns the merged + saved settings.
     */
    defineSkill('updateSettings', async ({ parts }) => {
      const a = dataArgs(parts);
      if (!a.patch || typeof a.patch !== 'object') return { error: 'patch (object) required' };
      if (!bundle?.cache) return { error: 'no-cache (was cache: false?)' };
      const next = await updateSettingsLib({
        dataSource: bundle.cache,
        deviceId:   bundle?.deviceId ?? null,
        patch:      a.patch,
        scope:      a.scope === 'device' || a.scope === 'shared' ? a.scope : null,
      });
      bundle.settings = next;
      metrics?.record?.('settings-updated');
      return { settings: next };
    }, {
      description: 'Patch a subset of the bundle\'s settings; persists immediately.',
      visibility:  'authenticated',
    }),

    /**
     * rotateMyAddress({ gracePeriodSeconds? })  — Stoop V3 mobile
     * Phase 40.22 (2026-05-08).
     *
     * Wraps `core.Agent.rotateIdentity()`.  Generates a fresh
     * Ed25519 keypair, broadcasts the rotation proof to current
     * peers, swaps SecurityLayer to the new key + retains the old
     * one for the grace period (default 7 days) so in-flight
     * envelopes from peers that haven't heard yet still decrypt.
     *
     * The user-facing `stableId` is unchanged — contacts / mute
     * lists keep tracking the same person.
     *
     * Returns `{ oldPubKey, newPubKey, graceUntil }`.
     */
    defineSkill('rotateMyAddress', async ({ parts, agent }) => {
      const a = dataArgs(parts);
      if (typeof agent?.rotateIdentity !== 'function') {
        return { error: 'rotation-not-supported' };
      }
      try {
        const r = await agent.rotateIdentity({
          gracePeriodSeconds: typeof a.gracePeriodSeconds === 'number'
            ? a.gracePeriodSeconds : 7 * 24 * 60 * 60,
          broadcast: a.broadcast !== false,
        });
        metrics?.record?.('identity-rotated');
        return {
          oldPubKey:  r.oldPubKey,
          newPubKey:  r.newPubKey,
          graceUntil: r.graceUntil,
        };
      } catch (err) {
        return { error: err?.message ?? String(err) };
      }
    }, {
      description: 'Rotate the agent\'s Ed25519 keypair (network address). stableId is preserved.',
      visibility:  'authenticated',
    }),

    /**
     * whoAmI()
     *   — Returns `{ webid, stableId, pubKey, handle, displayName }`
     *   for the calling actor.  The web UI uses this instead of
     *   parsing /.well-known/agent.json so the "other party" detection
     *   in chat threads compares apples to apples (WebID vs WebID,
     *   not WebID vs URL).
     */
    defineSkill('whoAmI', async ({ from, agent }) => {
      const me = members ? await members.resolveByWebid(from) : null;
      return {
        webid:       from,
        stableId:    me?.stableId ?? agent?.identity?.stableId ?? null,
        pubKey:      me?.pubKey   ?? agent?.identity?.pubKey   ?? null,
        handle:      me?.handle      ?? null,
        displayName: me?.displayName ?? null,
      };
    }, {
      description: 'Return the calling actor\'s identity tuple {webid, stableId, pubKey, handle, displayName}.',
      visibility:  'authenticated',
    }),

    /* ── Phase 21: Web Push subscription management ─────────────── */

    /**
     * getVapidPublicKey()
     *   — Returns the VAPID public key the SW needs for
     *   `pushManager.subscribe({applicationServerKey: ...})`.
     *   `null` when push is disabled on this bundle.
     */
    defineSkill('getVapidPublicKey', async () => ({
      publicKey: bundle?.webPushPublicKey ?? null,
    }), {
      description: 'Return the VAPID public key for Web Push subscription.',
      visibility:  'authenticated',
    }),

    /**
     * subscribeWebPush({ subscription })
     *   — Register a browser PushSubscription against the calling
     *   actor's WebID.  The bundle's PushRegistry holds these in
     *   process; durability is V2.
     */
    defineSkill('subscribeWebPush', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (!a.subscription?.endpoint) return { error: 'subscription with endpoint required' };
      const r = bundle.pushRegistry.add(from, a.subscription);
      metrics?.record?.('push-subscribed');
      return { ok: true, ...r };
    }, {
      description: 'Register a Web Push subscription for the calling actor.',
      visibility:  'authenticated',
    }),

    /**
     * unsubscribeWebPush({ endpoint? })
     *   — Drop one subscription by endpoint, or all subscriptions
     *   for the calling actor when `endpoint` is omitted.
     */
    defineSkill('unsubscribeWebPush', async ({ parts, from }) => {
      const a = dataArgs(parts);
      const r = bundle.pushRegistry.remove(from, a.endpoint);
      metrics?.record?.('push-unsubscribed');
      return { ok: true, ...r };
    }, {
      description: 'Drop one Web Push subscription (by endpoint) or all of mine.',
      visibility:  'authenticated',
    }),

    /**
     * triggerSelfPush({ title?, body })
     *   — Demo / smoke skill: deliver a push notification to ALL of
     *   the caller's own subscriptions.  Useful for verifying that
     *   the SW + VAPID setup is wired end-to-end before hooking the
     *   real notifier-driven delivery.
     */
    defineSkill('triggerSelfPush', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (!bundle.pushSender) return { error: 'push-disabled (no VAPID keys / sender)' };
      const subs = bundle.pushRegistry.list(from);
      if (subs.length === 0) return { error: 'no-subscriptions' };
      const payload = {
        title: a.title ?? 'Stoop',
        body:  a.body  ?? 'Test push',
      };
      const results = await Promise.all(subs.map(s => bundle.pushSender.send(s, payload)));
      const ok    = results.filter(r => r?.ok).length;
      const fail  = results.length - ok;
      metrics?.record?.('push-self-triggered');
      return { delivered: ok, failed: fail };
    }, {
      description: 'Send a test Web Push to all of my own subscriptions.',
      visibility:  'authenticated',
    }),

    /* ── Phase 22: Layer-2 personal interest matching ──────────── */

    /**
     * scorePostRelevance({ text, categoryId?, tags?, member? })
     *   — Combines Layer 1 (deterministic skill match) with Layer 2
     *   (TF-IDF over the user's response history).  Returns
     *   `{matched, ...}` with `via: 'category'|'tags'|'interest'`
     *   when matched, plus the raw `layer2Score` for inspection.
     *
     *   `member` defaults to the calling actor's MemberMap entry.
     */
    defineSkill('scorePostRelevance', async ({ parts, from }) => {
      const a = dataArgs(parts);
      if (typeof a.text !== 'string' || !a.text) return { error: 'text required' };

      const member = a.member ?? (members ? await members.resolveByWebid(from) : null);
      const layer1 = matchesProfile(
        { categoryId: a.categoryId ?? null, tags: a.tags ?? [] },
        member ?? {},
      );
      const layer2 = bundle?.interestProfile
        ? scoreInterest(bundle.interestProfile, a.text)
        : 0;
      const combined = combinedRelevance(layer1, layer2, a.threshold ?? 0.15);
      return { ...combined, layer1, layer2 };
    }, {
      description: 'Layer-1 + Layer-2 relevance score for a post body.',
      visibility:  'authenticated',
    }),

    /**
     * getInterestProfile()
     *   — Read-only snapshot of the bundle's Layer-2 profile.  Used
     *   by /interests.html for inspection + a "reset" button.
     */
    defineSkill('getInterestProfile', async () => {
      const p = bundle?.interestProfile ?? { docFrequency: {}, totalDocs: 0, centroidTerm: {} };
      const top = Object.entries(p.centroidTerm ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([term, weight]) => ({ term, weight }));
      return { totalDocs: p.totalDocs, topTerms: top };
    }, {
      description: 'Read-only snapshot of the Layer-2 interest profile.',
      visibility:  'authenticated',
    }),

    /**
     * resetInterestProfile()
     *   — Wipe the profile.  Useful for users who want to start over.
     */
    defineSkill('resetInterestProfile', async () => {
      if (bundle?.interestProfile) {
        bundle.interestProfile.docFrequency = {};
        bundle.interestProfile.centroidTerm = {};
        bundle.interestProfile.totalDocs    = 0;
        bundle.interestProfile.centroidNorm = null;
      }
      metrics?.record?.('interest-profile-reset');
      return { ok: true };
    }, {
      description: 'Reset the Layer-2 interest profile.',
      visibility:  'authenticated',
    }),

    /**
     * getMetrics()
     *   — Phase 18.  Returns a read-only snapshot of in-process
     *   `UsageMetrics` counters (event-name → {count, lastAt}).  Used
     *   by the closed-beta dashboard to surface usage signal to the
     *   beta facilitators; counters are local-only + reset on
     *   restart (apps that need durable metrics snapshot to the pod).
     */
    defineSkill('getMetrics', async () => {
      const snapshot = metrics?.snapshot?.() ?? {};
      return { snapshot, capturedAt: Date.now() };
    }, {
      description: 'Read-only snapshot of in-process usage counters.',
      visibility:  'authenticated',
    }),
  ];
}

// ── Group-aware skill dispatch wrapper ─────────────────────────────────────

/**
 * Sentinel bundle used to introspect the canonical skill-id list +
 * metadata at registration time. Skill bodies are closures that don't
 * fire until the first dispatch — passing harmless placeholders here
 * is safe; the real per-group bundle resolves at dispatch.
 */
const _SENTINEL_BUNDLE = Object.freeze({
  store:      null,
  skillMatch: null,
  notifier:   null,
  reveals:    null,
  members:    null,
  muted:      new Set(),
  localActor: null,
  groupId:    null,
  chat:       null,
  metrics:    null,
  bundle:     null,
});

/**
 * Wrap each skill with a group-aware dispatch prelude.
 *
 * For each skill defined by buildSkills, we register a shim that:
 *   1. Reads `args.groupId` (or derives it from the pubsub topic).
 *   2. Calls `getBundle(args, ctx)` to fetch the per-group bundle.
 *   3. Reuses (cached per-groupId) a real skill array built against
 *      that bundle, and delegates to the matching skill's handler.
 *
 * The cache is the user-managed `Map<groupId, Map<skillId, def>>`.
 * Apps invalidate via the returned `_invalidateGroup(groupId)` when a
 * bundle is torn down (group removed).
 */
function _buildScopedSkills({ getBundle, dataLocationConfig }) {
  // Build templates once with the sentinel — gives us the canonical
  // skill IDs + metadata for registration.
  const templates = buildSkills({ ..._SENTINEL_BUNDLE, dataLocationConfig });

  /** @type {Map<string, Map<string, object>>} */
  const cache = new Map();

  function _resolveSkill(bundleCtx, skillId) {
    const groupId = bundleCtx.groupId;
    let group = cache.get(groupId);
    if (!group) {
      const arr = buildSkills({ ...bundleCtx, dataLocationConfig });
      group = new Map(arr.map(s => [s.id, s]));
      cache.set(groupId, group);
    }
    return group.get(skillId) ?? null;
  }

  const wrapped = templates.map((tmpl) => {
    const handler = async (skillCtx) => {
      let args = {};
      try {
        args = dataArgs(skillCtx.parts);
      } catch { /* malformed parts → still let getBundle handle */ }

      const bundleCtx = getBundle(args, skillCtx);
      if (!bundleCtx) return { error: 'groupId required' };

      const skill = _resolveSkill(bundleCtx, tmpl.id);
      if (!skill) return { error: `skill-not-built: ${tmpl.id}` };

      return skill.handler(skillCtx);
    };
    // Preserve template metadata so SkillRegistry's tier/posture
    // filtering still works correctly.
    return defineSkill(tmpl.id, handler, {
      description:    tmpl.description,
      visibility:     tmpl.visibility,
      inputModes:     tmpl.inputModes,
      outputModes:    tmpl.outputModes,
      tags:           tmpl.tags,
      streaming:      tmpl.streaming,
      humanInTheLoop: tmpl.humanInTheLoop,
      posture:        tmpl.posture,
    });
  });

  // Stash the cache invalidator on the array (out-of-band; non-enumerable
  // so it doesn't end up serialised by accident).
  Object.defineProperty(wrapped, '_invalidateGroup', {
    value: (groupId) => cache.delete(groupId),
    enumerable: false,
  });

  return wrapped;
}
