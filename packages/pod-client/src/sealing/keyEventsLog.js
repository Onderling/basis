// keyEventsLog.js — the group key + its rotations, carried AS entries in the durable membership log so they
// self-distribute with NO pod. This is the no-pod counterpart to `groupKeyResource.js` (which distributes the
// same versioned key by writing ONE resource on a shared pod): here the exact same versioned key material rides
// the log/trail that already replicates a circle's membership, and a member folds the events it has back into
// the key chain.
//
// A KEY-EVENT is one log entry:
//   { kind:'group-key-event', groupId, version, members, recipients:[sealing public keys], sealed }
// where `sealed` is the version's group key wrapped MULTI-RECIPIENT (recipient mode) to the then-current
// members' stable sealing public keys — i.e. exactly what `buildGroupKeyResource` produces for one version.
// The wrap IS the distribution: a member unwraps `sealed` with its own sealing private key (an opener, so the
// key never leaves custody) to obtain that version's group key. Nothing new is invented — establish/rotate reuse
// `buildGroupKeyResource` + the envelope primitives verbatim.
//
// ── fold(log, key-events) → the key chain ───────────────────────────────────────────────────────────────────
// `foldKeyEvents` reduces the key-events a member holds into a `groupKeyResource`-shaped object (the CURRENT
// version + a `history[]` of prior versions), the exact shape `readableGroupKeys` / `openSealedAcrossVersions` /
// `groupKeyStrategy({resource, privateKey})` already consume. So a folded chain plugs straight into the retained-
// key readers with zero new crypto — the log is just a different CARRIER for the same versioned material.
//
// ── no-pod rotation + secrecy, entirely from what a member received ─────────────────────────────────────────
// A leave/remove emits a rotation key-event fanned (log-replicated) to the REMAINING members only; the departed
// is NOT a recipient of the new event, so their fold never gains the new version and they cannot open content
// sealed under it (backward secrecy for post-removal content). A member offline during the rotation catches the
// event up on reconnect (it is a durable log entry, re-served like any other) and folds it in order. Each
// rotation DURING a member's tenure was wrapped to THEIR sealing key, so they decrypt the chain they lived
// through; eras before they joined / after they left are simply absent from their fold.

import { sha256 } from '@noble/hashes/sha2.js';
import { generateGroupKey, openWithGroupKey, isSealed } from './envelope.js';
import { buildGroupKeyResource } from './groupKeyResource.js';

/** The log `kind` a key-event carries, so it is distinguishable from other membership-log entries. */
export const KEY_EVENT_KIND = 'group-key-event';

/**
 * Build ONE key-event: the `version` group key wrapped multi-recipient to `recipients` (sealing public keys).
 * Reuses `buildGroupKeyResource` for the wrap, then tags it as a log entry. Pure.
 *
 * @param {object} o
 * @param {string} [o.groupId]        the circle the event belongs to (routes the fold).
 * @param {number} [o.version=1]      the key version this event establishes.
 * @param {string} o.groupKey         the group key (b64url) this event distributes.
 * @param {string[]} o.recipients     the then-current members' sealing PUBLIC keys.
 * @returns {{kind:string, groupId:string|null, version:number, members:number, recipients:string[], sealed:string}}
 */
/**
 * WHICH KEY this event distributes, as a name anyone holding it computes the same way.
 *
 * A version number says WHEN, not WHICH — and two admins who rotate at the same moment both mint version n+1,
 * with different keys. Without a name for the key, "the same version" and "the same key" are indistinguishable,
 * and the only available de-dupe is "whichever I read last", which is how the two of them used to give every
 * device a different answer.
 *
 * A hash of the key, domain-separated so it can never collide with a hash computed for another purpose.
 * It reveals nothing: a holder already has the key, and a non-holder gains only the ability to recognise two
 * wraps as being of the same thing — which is exactly what it is for.
 */
const KEY_ID_DOMAIN = new TextEncoder().encode('onderling/group-key-id/v1');
export function keyIdOf(groupKey) {
  if (typeof groupKey !== 'string' || !groupKey) return null;
  const body = new TextEncoder().encode(groupKey);
  const buf = new Uint8Array(KEY_ID_DOMAIN.length + body.length);
  buf.set(KEY_ID_DOMAIN, 0); buf.set(body, KEY_ID_DOMAIN.length);
  return [...sha256(buf).subarray(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The most a version may carry. Two honest admins colliding is TWO keys; three is a partition healing; more is
 * a client minting keys to grow every member's chain, which is the one place this whole concern meets an
 * adversary. Over the cap the extra events are refused — deny-wins, the same shape as a handle collision.
 */
export const MAX_KEYS_PER_VERSION = 3;

/**
 * Collapse a list of key-events for one circle into the events that must be kept.
 *
 * TWO rules, not one, because "same version" covers two different situations:
 *
 *   · **the same key, wrapped again** — a v1 re-sealed to one more recipient as the roster grows. One must
 *     win, and it must be the wrap that reaches MORE people: a superset always serves everyone the subset
 *     served, while "last read" can drop the wrap that added the newcomer on a device that read the two in the
 *     other order. Ties break on the lower `sealed`, so every device picks the same one.
 *   · **two different keys** — two admins rotating at once. Both are kept. The reader trials the whole chain
 *     (`openAcrossKeyChain`), so content sealed under either opens; discarding one would lose it silently.
 *
 * Beyond `MAX_KEYS_PER_VERSION` distinct keys at one version, the extra ones are dropped in a stable order so
 * every device drops the same ones.
 */
export function collapseKeyEvents(events) {
  const byKey = new Map();                       // `${version}:${keyId}` → the winning wrap
  for (const e of events) {
    const id = `${e.version}:${e.keyId ?? e.sealed}`;   // an event without a keyId is its own key, by its wrap
    const held = byKey.get(id);
    if (!held) { byKey.set(id, e); continue; }
    const mine = Array.isArray(e.recipients) ? e.recipients.length : (e.members ?? 0);
    const theirs = Array.isArray(held.recipients) ? held.recipients.length : (held.members ?? 0);
    if (mine > theirs || (mine === theirs && String(e.sealed) < String(held.sealed))) byKey.set(id, e);
  }
  const perVersion = new Map();
  for (const e of byKey.values()) {
    const list = perVersion.get(e.version) ?? [];
    list.push(e); perVersion.set(e.version, list);
  }
  const out = [];
  for (const [, list] of perVersion) {
    // Stable everywhere: by keyId, so the cap drops the same events on every device.
    list.sort((x, y) => (String(x.keyId ?? x.sealed) < String(y.keyId ?? y.sealed) ? -1 : 1));
    out.push(...list.slice(0, MAX_KEYS_PER_VERSION));
  }
  return out.sort((a, b) => a.version - b.version);
}

export function buildKeyEvent({ groupId, version = 1, groupKey, recipients } = {}) {
  const res = buildGroupKeyResource({ version, groupKey, recipients });
  return {
    kind: KEY_EVENT_KIND,
    groupId: groupId ?? null,
    version: res.version,
    keyId: keyIdOf(groupKey),
    members: res.members,
    recipients: res.recipients,
    sealed: res.sealed,
  };
}

/**
 * Establish a circle's FIRST group key as a version-1 key-event, generating a fresh key if none is supplied.
 * Returns the event to append to the log AND the raw group key (for the establisher to seal new content with).
 *
 * @param {object} o
 * @param {string} [o.groupId]
 * @param {string[]} o.recipients   the founding members' sealing public keys.
 * @param {string} [o.groupKey]     an existing key to establish (else a fresh one is generated).
 * @returns {{ groupKey:string, event:ReturnType<typeof buildKeyEvent> }}
 */
export function establishKeyEvent({ groupId, recipients, groupKey } = {}) {
  const gk = groupKey || generateGroupKey();
  return { groupKey: gk, event: buildKeyEvent({ groupId, version: 1, groupKey: gk, recipients }) };
}

/**
 * Rotate: mint the NEXT-version group key as a key-event sealed to `recipients` (pass the REMAINING members to
 * revoke — the departed, omitted, cannot fold the new version in). The next version is derived from the highest
 * version already in `priorEvents` (or `fromVersion`), so rotation is a pure function of the log so far.
 *
 * @param {object} o
 * @param {string} [o.groupId]
 * @param {Array<object>} [o.priorEvents]  the key-events the rotator holds (used to derive the next version).
 * @param {number} [o.fromVersion]         override the base version explicitly (else read from priorEvents).
 * @param {string[]} o.recipients          the REMAINING members' sealing public keys.
 * @param {string} [o.groupKey]            an explicit new key (else a fresh one is generated).
 * @returns {{ groupKey:string, event:ReturnType<typeof buildKeyEvent> }}
 */
export function rotateKeyEvent({ groupId, priorEvents = [], fromVersion, recipients, groupKey } = {}) {
  const prior = foldKeyEvents(priorEvents, { groupId });
  const base = Number.isInteger(fromVersion) ? fromVersion : (prior ? prior.version : 0);
  const gk = groupKey || generateGroupKey();
  return { groupKey: gk, event: buildKeyEvent({ groupId, version: base + 1, groupKey: gk, recipients }) };
}

/**
 * fold(log, key-events) → the key chain. Reduce the key-events a member holds into a `groupKeyResource`-shaped
 * object: the highest version becomes the CURRENT `{version, members, recipients, sealed}`, every earlier version
 * its `history[]`. Same-version duplicates collapse (a re-issued grant supersedes). The result is exactly what
 * `readableGroupKeys` / `openSealedAcrossVersions` / `groupKeyStrategy({resource, privateKey})` consume, so a
 * private-key holder can read across versions with the EXISTING retained-key readers, unchanged.
 *
 * @param {Array<object>} events    the key-events in the member's log (any order, possibly with gaps).
 * @param {{groupId?:string}} [opts]  restrict the fold to one circle's events.
 * @returns {{v:number, version:number, members:number, recipients:string[]|null, sealed:string, history?:Array}|null}
 *   `null` when the member holds no key-event for the circle (they cannot read any sealed content — the honest
 *   denial for a never-joined / fully-removed member).
 */
export function foldKeyEvents(events, { groupId } = {}) {
  const forGroup = (Array.isArray(events) ? events : []).filter((e) =>
    e && e.kind === KEY_EVENT_KIND && typeof e.sealed === 'string'
    && Number.isInteger(e.version) && (groupId == null || e.groupId === groupId));
  if (forGroup.length === 0) return null;

  // Collapse by (version, KEY) rather than by version — see `collapseKeyEvents`. A version may now hold more
  // than one event, which is what two admins rotating at once looks like.
  const ordered = collapseKeyEvents(forGroup);
  const newest = ordered[ordered.length - 1].version;
  const atNewest = ordered.filter((e) => e.version === newest);

  // CURRENT is still exactly one event, and every device picks the same one: the lowest `keyId` at the newest
  // version. That is not an election over what is TRUE — both keys are true and both are kept below — it is an
  // agreement about what to SEAL WITH next, so the race heals on the following write instead of forking again.
  const current = [...atNewest].sort((a, b) => (String(a.keyId ?? a.sealed) < String(b.keyId ?? b.sealed) ? -1 : 1))[0];
  const resource = {
    v: 1, version: current.version, members: current.members,
    recipients: current.recipients ?? null, sealed: current.sealed,
  };
  // Everything else is history — including the OTHER key(s) at the current version. `history` is a plain list
  // and every reader trials it, so a second row at one version needs nothing new from the shape.
  const history = ordered.filter((e) => e !== current).map((e) => ({
    version: e.version, keyId: e.keyId ?? null, members: e.members, recipients: e.recipients ?? null, sealed: e.sealed,
  }));
  if (history.length) resource.history = history;
  return resource;
}

/**
 * Read the member's key chain from the log: every group-key VERSION this member can unwrap, newest-first, as
 * `{version, groupKey}`. The `opener` is a `(sealedText) => plaintext` closure bound to the member's sealing
 * PRIVATE key (e.g. `AgentIdentity.sharedCopyOpener` / pod-client `makeOpener`) — so the private key stays in
 * custody and never crosses this boundary. A version the opener cannot unwrap (the member was not a recipient —
 * removed, or not yet joined) is silently omitted, so the returned chain is EXACTLY the member's entitlement.
 *
 * @param {Array<object>} events
 * @param {{groupId?:string, opener:(sealedText:string)=>string}} o
 * @returns {Array<{version:number, groupKey:string}>} newest-first
 */
export function readKeyChain(events, { groupId, opener } = {}) {
  if (typeof opener !== 'function') throw new Error('readKeyChain: an opener(sealedText) closure is required');
  const resource = foldKeyEvents(events, { groupId });
  if (!resource) return [];
  const envs = [{ version: resource.version, sealed: resource.sealed }];
  for (const h of [...(resource.history ?? [])].reverse()) envs.push({ version: h.version, sealed: h.sealed });
  const chain = [];
  for (const env of envs) {
    try { chain.push({ version: env.version, groupKey: opener(env.sealed) }); }
    catch { /* not a recipient of this version — the forward/backward-secrecy denial; omit it */ }
  }
  return chain;
}

/** The CURRENT (highest-version) group key the member holds, for sealing NEW content. `null` if the chain is
 *  empty (the member holds no readable version). `chain` is the newest-first output of `readKeyChain`. */
export function currentGroupKey(chain) {
  return Array.isArray(chain) && chain.length ? chain[0].groupKey : null;
}

/** Extract the inner group-key envelope string from either a tagged seal-resolver envelope (`{sealed}`) or a
 *  raw sealed string, so a reader can trial it against the chain regardless of which form the writer produced. */
function innerSealed(sealedEnvelopeOrText) {
  if (sealedEnvelopeOrText && typeof sealedEnvelopeOrText === 'object' && typeof sealedEnvelopeOrText.sealed === 'string') {
    return sealedEnvelopeOrText.sealed;
  }
  return sealedEnvelopeOrText;
}

/**
 * Open content sealed under SOME version, resolving the version by AUTHENTICATED TRIAL across the member's key
 * chain (newest-first) — the same secretbox-auth-tag trial `openSealedAcrossVersions` uses, but over the chain
 * folded from the log rather than a pod resource. Non-sealed text passes through. Throws if no version the
 * member holds opens it — which is precisely the backward-secrecy denial for content sealed after the member's
 * removal (that version's key never entered their chain).
 *
 * @param {{sealed:string}|string} sealedEnvelopeOrText  a tagged seal-resolver envelope or a raw sealed string.
 * @param {Array<{version:number, groupKey:string}>} chain  the member's key chain (from `readKeyChain`).
 * @returns {string} plaintext
 */
export function openAcrossKeyChain(sealedEnvelopeOrText, chain) {
  const inner = innerSealed(sealedEnvelopeOrText);
  if (!isSealed(inner)) return inner;                              // plaintext passes through
  if (!Array.isArray(chain) || chain.length === 0) {
    throw new Error('openAcrossKeyChain: the reader holds no key-event version for this content');
  }
  for (const { groupKey } of chain) {
    try { return openWithGroupKey(inner, groupKey); } catch { /* wrong version — try the next */ }
  }
  throw new Error('openAcrossKeyChain: no key version the reader holds opens this content');
}
