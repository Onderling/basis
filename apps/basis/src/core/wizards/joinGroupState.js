/**
 * joinGroup — state-machine helpers lifted from
 * src/web/wizards/joinGroupWizard.js (2026-05-24).
 *
 * Zero DOM — pure parsing + validation + a multi-step substrate
 * chain.  The web wizard's render layer keeps the DOM construction;
 * basis-mobile's RN wizard can import these helpers verbatim.
 *
 * `globalThis.atob` is used in decodeInvite for base64 decoding —
 * present on both browser AND Hermes (RN), so this stays portable
 * without an explicit polyfill check.
 */

import { normalizeDriverKind, REVEAL_PRESETS, isRevealPreset } from '@onderling/agent-registry';

// Re-export so the wizards render the reveal-level picker off ONE import (they already
// pull setJoinReveal/state from here) without reaching into @onderling/agent-registry
// directly (keeps the RN metro subpath surface small).
export { REVEAL_PRESETS };

import { buildJoinConsentModel, optOutsFromDeclined } from '../../v2/circleConsent.js';
import { endpointToDialForInvite } from '../../v2/connectionPoints.js';
import { personaPresetKeys } from '../../v2/memberCards.js';

/* ─── Locale strings ────────────────────────────────────────── */

/**
 * Privacy notice text shown in step 2.  Bilingual constant; the
 * caller passes `lang: 'nl' | 'en'` (defaults to 'en') to pick.
 * Future sweep moves these into the locale JSON; for now they
 * live here for surface-parity with the original web wizard.
 */
export const PRIVACY_NOTICE = Object.freeze({
  nl: `Lid worden van een buurt betekent dat andere
leden je posts kunnen zien, je kunnen aanspreken en — afhankelijk van
groepsregels — kunnen oordelen over conflicten. Buurt-admins hebben
geen toegang tot je privé-chats, alleen tot wat je publiek post.`,
  en: `Joining a circle means other members can see
your posts, contact you, and — depending on group rules — weigh in on
conflicts. Circle admins have no access to your private chats, only to
what you post publicly.`,
});

export function privacyNoticeFor(lang) {
  return PRIVACY_NOTICE[lang] ?? PRIVACY_NOTICE.en;
}

/* ─── Handle helpers ───────────────────────────────────────── */

/**
 * Suggest handle candidates for the join field.
 *
 * Wave B (NOTE-identity-and-linkability, Decision B): the PRIMARY source is the
 * joiner's OWN prior handles — the handles you've used in circles you're already
 * in (`loadPriorHandles` → `stoop.listMyHandles`). That is your own information,
 * so surfacing it leaks nothing, and it lets you re-use a handle you like. Only
 * when you have no prior handles yet do we fall back to display-name-derived
 * candidates (the pre-Wave-B behaviour).
 *
 * Polymorphic for back-compat: a STRING first arg is the legacy display-name seed
 * (`handleSuggestions(displayName)`); an ARRAY first arg is the prior-handle list
 * (`handleSuggestions(priorHandles, displayName)`).
 */
export function handleSuggestions(priorOrName, existingDisplayName) {
  let priorHandles = priorOrName;
  let displayName = existingDisplayName;
  if (typeof priorOrName === 'string') { priorHandles = []; displayName = priorOrName; }
  const prior = Array.isArray(priorHandles)
    ? [...new Set(priorHandles.map((h) => String(h ?? '').trim().toLowerCase()).filter(isValidHandle))]
    : [];
  if (prior.length) return prior.slice(0, 8);        // your own prior handles — no leak
  // Derived candidates, and three things this got wrong (seen on a device, S3 2026-07-30 — the chips read
  // as an empty pill, `-29` and `.2026`):
  //
  //   1. `displayName ?? 'me'` only catches null/undefined, so an EMPTY STRING passed straight through and
  //      `base` became ''. Every candidate was then a bare suffix.
  //   2. `Math.random()` made the suggestions change on every render, so a chip a person was reaching for
  //      moved under their finger.
  //   3. Nothing checked the output against `isValidHandle`, three lines above in this same file — '' and
  //      '-29' are not handles, and the field would have refused them if anyone had tried.
  //
  // Deterministic, and validated with the rule the field itself uses.
  const base = String(displayName ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  // No name to work from ⇒ suggest NOTHING. The old fallback was `'me'`, which is not even a valid handle
  // (the rule three lines up wants 3+ characters), and inventing an English word as someone's name in a
  // Dutch-first product is the wrong instinct regardless. An empty list is honest: we do not know.
  if (!base) return [];
  const year = new Date().getFullYear();
  return [base, `${base}-${year}`, `${base}2`].filter(isValidHandle);
}

/**
 * Load the joiner's OWN prior handles for the suggestion dropdown — the distinct
 * handles they've used across the circles they belong to (`stoop.listMyHandles`).
 * Pure read; on any failure returns `[]` so the field simply falls back to
 * display-name-derived candidates. Your own info only — nothing about anyone else.
 *
 * @param {{callSkill:Function}} a
 * @returns {Promise<string[]>}
 */
export async function loadPriorHandles({ callSkill } = {}) {
  if (typeof callSkill !== 'function') return [];
  try {
    const reply = await callSkill('stoop', 'listMyHandles', {});
    const arr = Array.isArray(reply?.handles) ? reply.handles : [];
    return arr.filter((h) => typeof h === 'string' && h);
  } catch {
    return [];
  }
}

/** Validate a circle handle: lowercase, digits, _ / -; 3-30 chars. */
export function isValidHandle(handle) {
  return typeof handle === 'string'
    && /^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])?$/.test(handle);
}

/* ─── Invite decoding ───────────────────────────────────────── */

/**
 * Decode an invite arg (URL form OR pre-decoded object) and write
 * the result into `state.invite` / `state.inviteParseError`.
 *
 * Supports three URL forms (slash-arg parsers sometimes mangle "://"):
 *   - `onderling-invite://<base64url>`  (canonical)
 *   - `onderling-invite:<base64url>`
 *   - `onderling-invite/<base64url>`
 *
 * And accepts a JSON-encoded invite directly (starts with `{`).
 *
 * Mutates state in place; no return value.
 */
export function decodeInvite(invite, state) {
  if (!invite) {
    state.inviteParseError = 'No invite supplied — type /join-group <invite-url>.';
    return;
  }
  if (typeof invite === 'object') {
    state.invite = invite;
    return;
  }
  const PREFIX = 'onderling-invite://';
  let str = String(invite).trim();
  if (str.startsWith(PREFIX)) {
    str = str.slice(PREFIX.length);
  } else if (str.startsWith('onderling-invite:')) {
    str = str.replace(/^onderling-invite:[/]*/i, '');
  } else if (str.startsWith('onderling-invite/')) {
    str = str.replace(/^onderling-invite[/]+/i, '');
  }
  try {
    if (str.startsWith('{')) {
      state.invite = JSON.parse(str);
      return;
    }
    const padded = str.replace(/-/g, '+').replace(/_/g, '/')
                       + '=='.slice(0, (4 - str.length % 4) % 4);
    if (typeof globalThis.atob !== 'function') {
      throw new Error('no base64 decoder available (browser/RN only)');
    }
    const bin = globalThis.atob(padded);
    try {
      state.invite = JSON.parse(bin);
    } catch {
      const snippet = bin.slice(0, 50).replace(/[^\x20-\x7e]/g, '·');
      throw new Error(`base64 decoded to non-JSON: "${snippet}…" — likely the URL was corrupted in transit (paste mangled?).  Try copy-pasting the full URL again.`);
    }
  } catch (err) {
    state.inviteParseError = `Bad invite: ${err.message ?? err}`;
  }
}

/* ─── Peer-address population from an invite ─────────────────── */

/**
 * Populate an app-owned PeerGraph with the ADMIN's per-transport wire
 * addresses carried in a decoded invite, so the secure router's
 * `addressesOf(adminPubKey)` resolves the transport-appropriate address for
 * the redeem handshake — the relay address (the Ed25519 pubKey) AND the NKN
 * native address — instead of the send path degrading to the bare pubKey (a
 * string NKN can't route). Call after `decodeInvite`, BEFORE the peer redeem
 * send, so `route → addressFor` picks the relay tier and addresses it right.
 *
 * The invite carries `adminPeerAddr` (the pubKey = relay wire address) and,
 * when the admin had NKN up at invite time, `adminNknAddr` (the native
 * address). The PeerGraph is keyed by `pubKey`, so the admin's canonical id
 * here is `adminPeerAddr`; `transports` shallow-merges on upsert and
 * `addressesOf` reads a string value directly, so we store the flat shape
 * `{ relay: <pubKey>, nkn: <native> }` (nkn omitted for a relay-only admin).
 *
 * Additive + best-effort: no invite / no adminPeerAddr / no graph → no-op
 * (returns null); never throws into the join flow.
 *
 * @param {{ peerGraph:{upsert:Function}, invite:object }} a
 * @returns {Promise<object|null>} the merged peer record, or null when skipped
 */
export async function populateAdminAddressesFromInvite({ peerGraph, invite } = {}) {
  const adminPeerAddr = invite?.adminPeerAddr;
  if (!adminPeerAddr || !peerGraph || typeof peerGraph.upsert !== 'function') return null;
  const transports = { relay: adminPeerAddr };
  if (invite?.adminNknAddr) transports.nkn = invite.adminNknAddr;
  try {
    return await peerGraph.upsert({ pubKey: adminPeerAddr, transports });
  } catch {
    return null;   // population must never block the join
  }
}

/* ─── Rules text ────────────────────────────────────────────── */

/**
 * 5.5b — extract a v2 structured rules doc from an embedded rules
 * blob, OR null when the blob carries no structured fields (older
 * invites that only set `rulesText`).  When non-null, the renderer
 * surfaces the doc as per-section answers; when null, it
 * falls back to `state.rulesText` (the summary).
 */
export function extractRulesDoc(rules) {
  if (!rules || typeof rules !== 'object') return null;
  const docFields = ['purpose', 'admins', 'agreements', 'conflict', 'admission', 'leaving', 'responsibility'];
  const hit = docFields.some(
    (k) => typeof rules[k] === 'string' && rules[k].trim() !== '',
  );
  if (!hit) return null;
  const out = {};
  for (const k of docFields) out[k] = typeof rules[k] === 'string' ? rules[k] : '';
  return out;
}

/**
 * Format a rules object as readable text — same layout the
 * getGroupRules adapter uses.  Pure transform; keeps the joiner's
 * pre-join display consistent with what /group-rules shows post-join.
 */
export function summariseEmbeddedRules(r) {
  if (r?.rulesText && String(r.rulesText).trim()) return String(r.rulesText);
  const parts = [];
  if (r?.purpose)        parts.push(`Purpose: ${r.purpose}`);
  if (r?.accessPolicy)   parts.push(`Access: ${r.accessPolicy}`);
  if (r?.leavePolicy)    parts.push(`Leave: ${r.leavePolicy}`);
  if (r?.conflictPolicy) parts.push(`Conflict resolution: ${r.conflictPolicy}`);
  if (Array.isArray(r?.tags) && r.tags.length)
    parts.push(`Tags: ${r.tags.join(', ')}`);
  if (Array.isArray(r?.additionalAdmins) && r.additionalAdmins.length)
    parts.push(`Extra admins: ${r.additionalAdmins.join(', ')}`);
  return parts.length > 0
    ? parts.join('\n')
    : '(no rules set; defaults apply)';
}

/**
 * Fetch the group rules — embedded in the invite first, then fall
 * back to the substrate getGroupRules.  Mutates state.rulesText
 * (or state.rulesError on failure); returns the mutated state.
 */
export async function fetchGroupRules({ state, callSkill }) {
  const embedded = state.invite?.rules;
  if (embedded && typeof embedded === 'object') {
    // 5.5b — surface the v2 structured doc when the invite carries it.
    state.rulesDoc  = extractRulesDoc(embedded);
    state.rulesText = summariseEmbeddedRules(embedded);
    return state;
  }
  try {
    const reply = await callSkill('stoop', 'getGroupRules', { groupId: state.invite.groupId });
    state.rulesDoc  = extractRulesDoc(reply?.rules ?? reply ?? null);
    state.rulesText = reply?.rules ?? reply?.message ?? '(no rules set for this group)';
  } catch (err) {
    state.rulesError = err?.message ?? String(err);
  }
  return state;
}

/* ─── Consent-at-join (B) ─────────────────────────── */

/**
 * build the join-time capability CONSENT MODEL from the invite's embedded freedom
 * template (`invite.capabilities` + `invite.apps`) and the host-injected manifest `sources`. Sets
 * `state.consentModel` (the opt-outable caps the joiner reviews) and resets `state.capabilityOptOuts`
 * to whatever the model already records. Pure — the shared model both web + RN wizards render.
 *
 * Additive: with no embedded template OR no sources, the model is empty and the consent step is a
 * no-op (a joiner who opts out of nothing behaves exactly as before).
 *
 * @param {{state:object, sources?:Array<{manifest:object}>}} a
 * @returns {object} the mutated state
 */
export function buildJoinConsent({ state, sources } = {}) {
  const inv = state?.invite;
  const template = (inv?.capabilities && typeof inv.capabilities === 'object' && !Array.isArray(inv.capabilities))
    ? inv.capabilities : {};
  // Consent-at-join surfaces the admin's PER-CAP freedom choices. With no authored template there is
  // nothing template-driven to review — stay a no-op (an un-configured circle is default-on today).
  if (Object.keys(template).length === 0) {
    state.consentModel = { items: [], keys: [] };
    state.capabilityOptOuts = [];
    return state;
  }
  const policy = { apps: Array.isArray(inv?.apps) ? inv.apps : null, capabilities: template };
  state.consentModel = buildJoinConsentModel(Array.isArray(sources) ? sources : [], policy, {
    optOuts: state.capabilityOptOuts,
  });
  // Keep only still-valid opt-outs (a template change could have made a previously-declined cap mandatory).
  state.capabilityOptOuts = optOutsFromDeclined(state.consentModel, state.capabilityOptOuts);
  return state;
}

/**
 * record/clear the joiner's decision for one capability. `declined === true` opts out
 * (adds the key); `false` opts back in (removes it). Only opt-outable keys in the consent model survive
 * (`optOutsFromDeclined` drops anything mandatory/unknown), so a mandatory cap can never be declined.
 */
export function setConsentDecline(state, key, declined) {
  const cur = new Set(Array.isArray(state?.capabilityOptOuts) ? state.capabilityOptOuts : []);
  if (declined) cur.add(key); else cur.delete(key);
  state.capabilityOptOuts = optOutsFromDeclined(state.consentModel, [...cur]);
  return state;
}

/* ─── Persona selection (property layer · join-with-persona) ── */

/**
 * Load the user's personas for the join picker — the registry profiles
 * (`role: 'profile'`, incl. the always-present `default`). Pure read; on any
 * failure returns `[]` so the picker simply offers nothing (join minimally).
 * The shape is `[{ id, name }]`, freshest curation surfaced by the agents skill.
 *
 * @param {{callSkill:Function}} a
 * @returns {Promise<Array<{id:string,name:string}>>}
 */
export async function loadPersonas({ callSkill } = {}) {
  try {
    const reply = await callSkill('agents', 'listAgents', {});
    const rows = Array.isArray(reply?.agents) ? reply.agents : [];
    return rows
      .filter((a) => a && a.role === 'profile')
      .map((a) => ({ id: a.agentId, name: a.name || a.agentId }));
  } catch {
    return [];
  }
}

/**
 * Record the joiner's persona choice. `null` (the protective default) means
 * "join minimally — disclose no background"; a profile id means "join AS this
 * persona, sharing what it discloses in THIS circle" (finalSubmit computes the
 * release). Only the identity part; the disclosure itself stays default-withhold.
 */
export function setPersona(state, personaId) {
  state.persona = (typeof personaId === 'string' && personaId.length) ? personaId : null;
  return state;
}

/* ─── Reveal-state default at join (C7 · NOTE-reveal-state-and-profile-updates §1.6) ─ */

/** The personal-default fallback when the joiner has set no usual level yet. */
export const REVEAL_JOIN_FALLBACK = 'profile';

/**
 * Resolve the reveal preset the join starts at (§1.6): a per-circle `override`
 * wins; else the joiner's `personalDefault` ("your usual level") is honoured;
 * else the fallback. The circle-suggested level is NEVER an input here — it is
 * shown as a non-binding hint (`state.circleSuggestedReveal`), never forced.
 *
 * @param {{personalDefault?:string, override?:string}} a
 * @returns {'handle'|'profile'|'full'}
 */
export function resolveJoinRevealPreset({ personalDefault, override } = {}) {
  if (isRevealPreset(override)) return override;
  if (isRevealPreset(personalDefault)) return personalDefault;
  return REVEAL_JOIN_FALLBACK;
}

/**
 * Load the joiner's personal-default reveal level from their `default` profile
 * (`reveal.default` property). Best-effort; falls back to the join fallback.
 * This is your own usual level — read-only here (a settings surface sets it).
 *
 * @param {{callSkill:Function}} a
 * @returns {Promise<'handle'|'profile'|'full'>}
 */
export async function loadPersonalRevealDefault({ callSkill } = {}) {
  if (typeof callSkill !== 'function') return REVEAL_JOIN_FALLBACK;
  try {
    const props = (await callSkill('agents', 'getProfileProperties', { id: 'default' }))?.properties ?? {};
    const entry = props['reveal.default'];
    const preset = typeof entry === 'string' ? entry : entry?.value;
    return isRevealPreset(preset) ? preset : REVEAL_JOIN_FALLBACK;
  } catch {
    return REVEAL_JOIN_FALLBACK;
  }
}

/** Record the joiner's per-circle reveal-preset choice (adjustable, floors at `handle`). */
export function setJoinReveal(state, preset) {
  if (isRevealPreset(preset)) state.revealPreset = preset;
  return state;
}

/**
 * Enact the chosen reveal preset for `contextId` (the joined circle) onto the
 * effective persona's per-circle disclosure BEFORE the join release is computed,
 * so the release honours the preset. ENABLE every attribute in tiers ≤ the chosen
 * preset, DISABLE those above (the same amount-cumulative rule as
 * `applyRevealPreset`, applied over the persona tier keys). Only the `enabled`
 * axis is touched. Best-effort per key. No-op when no preset is set.
 *
 * @param {{state:object, callSkill:Function, contextId:string}} a
 * @returns {Promise<{applied:boolean, preset?:string}>}
 */
export async function applyJoinRevealState({ state, callSkill, contextId } = {}) {
  const preset = state?.revealPreset;
  if (!isRevealPreset(preset) || typeof callSkill !== 'function' || !contextId) return { applied: false };
  const personaId = state.persona ?? 'default';
  const idx = REVEAL_PRESETS.indexOf(preset);
  const seen = new Set();
  for (let i = 0; i < REVEAL_PRESETS.length; i++) {
    for (const key of personaPresetKeys(REVEAL_PRESETS[i])) {
      if (typeof key !== 'string' || !key || seen.has(key)) continue;
      seen.add(key);
      try {
        await callSkill('agents', 'setProfileDisclosure', {
          id: personaId, contextId, key, enabled: i <= idx,
        });
      } catch { /* best-effort — one failed key must not block the join */ }
    }
  }
  return { applied: true, preset };
}

/* ─── Cross-circle linkability — the KEY choice (NOTE-identity-and-linkability, Decision B) ─
 *
 * SENSITIVE — this touches key custody. Linkability is a conscious JOIN-TIME choice:
 * present a FRESH per-circle key (unlinkable coincidence — the DEFAULT), or CONTINUE as
 * one of your existing selves by presenting the SAME per-circle key you use in another
 * circle (provably the same person to anyone in BOTH circles). No new crypto: the key you
 * present is `deriveCircleAddress(profileSeed, <sourceCircleId>)`, the spine's existing
 * per-circle address — "continue as self in circle X" = present circle X's address here.
 * A fresh key is `deriveCircleAddress(profileSeed, <this circle>)`, which the callSkill seam
 * derives by default; presenting a chosen existing key is the explicit opt-in that OVERRIDES it.
 */

/**
 * Build the "continue as an existing self?" option list from the circles the joiner
 * already belongs to (each circle you're in is one existing self, labelled by where
 * it lives). Excludes the circle being joined. `[{ circleId, name }]`.
 *
 * @param {Array<{id:string,name?:string}>} circles  the joiner's existing circles
 * @param {string} joiningCircleId                    the circle being joined (excluded)
 * @returns {Array<{circleId:string,name:string}>}
 */
export function existingSelvesFrom(circles, joiningCircleId) {
  if (!Array.isArray(circles)) return [];
  return circles
    .filter((c) => c && typeof c.id === 'string' && c.id && c.id !== joiningCircleId)
    .map((c) => ({ circleId: c.id, name: c.name || c.id }));
}

/**
 * Record the linkability choice. `'fresh'` (the default) = a fresh, unlinkable key;
 * any other string = a source circleId whose key to CONTINUE presenting (linkable to
 * that circle). Guarded so only a known existing-self circleId can be chosen.
 */
export function setLinkChoice(state, choice) {
  if (typeof choice !== 'string' || !choice || choice === 'fresh') {
    state.linkChoice = 'fresh';
    return state;
  }
  const known = Array.isArray(state.existingSelves)
    && state.existingSelves.some((s) => s.circleId === choice);
  state.linkChoice = known ? choice : 'fresh';
  return state;
}

/** True when the joiner chose to continue as an existing self (a linkable key). */
export function isLinkableChoice(state) {
  return typeof state?.linkChoice === 'string' && state.linkChoice !== 'fresh';
}

/**
 * The per-circle ADDRESS the join should present, given the link choice. `undefined`
 * for the fresh/unlinkable default (the callSkill seam then derives this circle's own
 * address); for "continue as self in X" it is `circleAddressFor(X)` — the SAME key X
 * already records, which is what makes the two circles linkable. No new derivation.
 *
 * @param {object} state
 * @param {(circleId:string)=>(string|null)} circleAddressFor  the spine presenter
 * @returns {string|undefined}
 */
export function presentedCircleAddress(state, circleAddressFor) {
  if (!isLinkableChoice(state) || typeof circleAddressFor !== 'function') return undefined;
  try { return circleAddressFor(state.linkChoice) ?? undefined; }
  catch { return undefined; }
}

/**
 * Bootstrap the join-time identity inputs in the background so step 3 is ready:
 * the joiner's prior handles (suggestion source), their personal-default reveal
 * level (→ the starting preset, honouring §1.6), the non-binding circle-suggested
 * level from the invite, and the existing-selves list for the key choice. Mutates
 * + returns state. Every part is best-effort — a failure just leaves a safe default.
 *
 * @param {{state:object, callSkill:Function, circles?:Array}} a
 * @returns {Promise<object>} the mutated state
 */
export async function prepareJoinIdentity({ state, callSkill, circles } = {}) {
  const [priorHandles, personalDefault] = await Promise.all([
    loadPriorHandles({ callSkill }),
    loadPersonalRevealDefault({ callSkill }),
  ]);
  state.priorHandles = priorHandles;
  state.personalRevealDefault = personalDefault;
  // Circle-suggested level rides the invite; shown, NEVER forced.
  const suggested = state.invite?.suggestedReveal;
  state.circleSuggestedReveal = isRevealPreset(suggested) ? suggested : null;
  // Starting preset = personal default (override is null on first resolve).
  state.revealPreset = resolveJoinRevealPreset({ personalDefault });
  // Existing selves = the circles you're already in (each a presentable key).
  state.existingSelves = existingSelvesFrom(Array.isArray(circles) ? circles : [], state.invite?.groupId ?? null);
  return state;
}

/* ─── Charter-driven skill-sharing default (fold-in phase C) ──── */

/**
 * Skills→property fold-in phase C (NOTE-skills-properties-audit, "charter-driven
 * default"). When the joined circle is ABOUT skills-matching — signalled by
 * `invite.offeringsMatching: true`, embedded at invite-build from the circle's board-8
 * skill record (`offeringsMatchingEnabled`, @onderling/kring-host/circleOfferings) — the
 * disclosure default for the persona's skill keys flips from withhold to enabled at
 * the COARSE rung `'category'` (only the taxonomy category is released, never the
 * text/tags). NEVER silent: the wizard renders this as a visible pre-checked line
 * the joiner can uncheck. Circles without the signal (incl. all older invites)
 * keep the protective default-withhold.
 *
 * Call after decodeInvite; mutates + returns state.
 */
export function applyCharterOfferingsDefault(state) {
  // Read-accept: new invites carry `offeringsMatching`; older invites embed
  // the legacy `skillsMatching` field. Both mean the same charter signal.
  const on = state?.invite?.offeringsMatching === true
          || state?.invite?.skillsMatching   === true;
  state.offeringsMatching = on;
  state.shareOfferingsAtJoin = on;
  return state;
}

/** Record the joiner's (un)check of the pre-checked skill-sharing line. */
export function setShareOfferingsAtJoin(state, on) {
  state.shareOfferingsAtJoin = on === true;
  return state;
}

/** The coarse rung the join-time default discloses offerings at (OFFERING_LADDER's coarsest). */
export const OFFERINGS_JOIN_RUNG = 'category';

/**
 * Enact the accepted skill-sharing default for `contextId` (the joined circle):
 * enable disclosure at the coarse `'category'` rung for every skill-kind driver
 * key on the effective persona (the chosen one, else `'default'` — the charter
 * default must also work for a first-join user who never made personas). No-op
 * unless `state.shareOfferingsAtJoin` is true. Best-effort per key; returns the
 * keys enabled so finalSubmit can fold them into the join release.
 *
 * @param {{state:object, callSkill:Function, contextId:string}} a
 * @returns {Promise<string[]>} the enabled skill keys
 */
export async function applyOfferingsDisclosureAtJoin({ state, callSkill, contextId } = {}) {
  if (state?.shareOfferingsAtJoin !== true || typeof callSkill !== 'function' || !contextId) return [];
  const personaId = state.persona ?? 'default';
  let drivers = {};
  try { drivers = (await callSkill('agents', 'getProfileDrivers', { id: personaId }))?.drivers ?? {}; }
  catch { return []; }
  const keys = Object.entries(drivers)
    // offering-kind drivers (legacy `skill` kind read-accepted / normalized)
    .filter(([, v]) => normalizeDriverKind(v?.kind) === 'offering')
    .map(([k]) => k);
  const enabled = [];
  for (const key of keys) {
    try {
      const r = await callSkill('agents', 'setProfileDisclosure', {
        id: personaId, contextId, key, enabled: true, rung: OFFERINGS_JOIN_RUNG,
      });
      if (r?.ok !== false) enabled.push(key);
    } catch { /* best-effort — one failed key must not block the join */ }
  }
  return enabled;
}

/* ─── Initial state + final-submit chain ───────────────────── */

/**
 * The join flow's DECLARED steps (batch 6) — the first flow to live on a manifest (`stoop`'s
 * `flows: [{ id: 'joinGroup', … }]`), and this export is what keeps that declaration honest: the
 * flow-integrity guard (G-S3, `scripts/flowIntegrity.test.js`) asserts declared ids ≡ these ids and
 * that the `next` chain is acyclic and fully reachable. The wizard's own machine still runs on the
 * numeric `state.step` 1..3 below — this is a DECLARATION of that existing flow, not a rewrite —
 * and the index of each entry is its numeric step minus one.
 */
export const JOIN_FLOW_STEPS = Object.freeze([
  // step 1 — paste/scan the invite; decode + validate it (`decodeInvite`).
  Object.freeze({ id: 'invite',   next: 'consent' }),
  // step 2 — the rules gate: circle rules + privacy notice + the join-time capability consent.
  Object.freeze({ id: 'consent',  next: 'identity' }),
  // step 3 — who joins: handle, persona, reveal preset, the key/link choice; then `finalSubmit`.
  Object.freeze({ id: 'identity', next: null }),
]);

export function initialState() {
  return {
    step:             1,            // 1..3 — JOIN_FLOW_STEPS[step - 1] is the declared name
    invite:           null,         // decoded invite object
    inviteParseError: null,
    rulesText:        null,
    rulesDoc:         null,      // 5.5b — structured v2 doc; null → fallback to rulesText
    rulesError:       null,
    rulesAccepted:    false,
    privacyAccepted:  false,
    shareAddress:     true,         // mesh-consent default ON
    // the join-time capability consent (opt-outable caps + this joiner's declines).
    consentModel:     { items: [], keys: [] },
    capabilityOptOuts: [],
    handle:           '',
    // Property layer — join-with-persona. `null` = join minimally (disclose no
    // background); a profile id = join AS that persona (its per-circle disclosure
    // applies). `personas` is the picker's option list, lazily loaded. Protective
    // default: null (first join discloses nothing regardless — this is the label).
    persona:          null,
    personas:         [],
    // Fold-in phase C — charter-driven skill-sharing default. `offeringsMatching`
    // mirrors the invite's embedded circle signal; `shareOfferingsAtJoin` is the
    // joiner's decision on the visible pre-checked line (applyCharterOfferingsDefault
    // pre-checks it ONLY for a matching circle; otherwise both stay false =
    // default-withhold).
    offeringsMatching:    false,
    shareOfferingsAtJoin: false,
    // Wave B — prior-handle suggestions (your own handles; loadPriorHandles).
    priorHandles:     [],
    // Wave B — handle-uniqueness rejection surfaced back on the handle step so the
    // joiner can pick another. `handleRejected` flags it; `submitErrorKey` is the
    // localisable key the shell renders via t() (invariant #8), null = no i18n key.
    handleRejected:   false,
    submitErrorKey:   null,
    /** Machine-readable failure reason — see the catch in `finalSubmit` for why both exist. */
    submitErrorReason: null,
    // Wave B — reveal-state default (C7 · §1.6). `revealPreset` = the chosen
    // in-circle disclosure level (handle|profile|full), starting at the personal
    // default; `personalRevealDefault` = your usual level (loaded, overridable);
    // `circleSuggestedReveal` = the admin's NON-BINDING hint from the invite (shown).
    revealPreset:            null,
    personalRevealDefault:   REVEAL_JOIN_FALLBACK,
    circleSuggestedReveal:   null,
    // Wave B — cross-circle linkability key choice (SENSITIVE). `'fresh'` (default) =
    // a fresh, unlinkable per-circle key; a circleId = continue as the self living
    // there (present that circle's key → provably linkable). `existingSelves` = the
    // circles you're already in, each a presentable existing self.
    linkChoice:       'fresh',
    existingSelves:   [],
    submitting:       false,
    submitError:      null,
  };
}

/**
 * Final submission chain.  ONE path: `kind:'membershipCode'`.
 * Mutates state.submitting / state.submitError.  Returns
 * `{result?, state}` so the caller can react to success.
 *
 * setMyHandle → redeemMembershipCode → (on invalid-or-expired-code)
 *   sendPeerRedeem fallback → recordRemoteRedemption mirror.
 *
 * A second path used to sit here for the old GroupManager invite
 * (`redeemInviteWithGate` → setMyHandle → redeemInvite). It was removed
 * 2026-08-19: BOTH halves of that mechanism were already gone. `issueInvite`
 * and `redeemInvite` live in `@onderling/identity-resolver` and are wired only
 * by the retired tasks-v0 app, so this app could neither mint such an invite nor
 * redeem one — the branch ended in a call that threw `Unknown skill`. Anything
 * that is not a membership code is now refused by NAME instead.
 *
 * `circleAddressFor(circleId)` (optional) is the spine's per-circle address
 * presenter; it lets the SENSITIVE "continue as an existing self" choice present a
 * chosen existing key instead of the fresh (this-circle) default. Absent → fresh.
 */
export async function finalSubmit({
  state, callSkill, sendPeerRedeem, circleAddressFor, signCircleLink,
  dialEndpoint = null, activeEndpointUrl = null, onJoined = null,
}) {
  state.submitting    = true;
  state.submitError   = null;
  state.submitErrorKey = null;
  state.handleRejected = false;
  try {
    // J-CP1 (S4, 2026-07-29) — be ON the circle's endpoint before asking its admin for anything.
    // Best-effort: a join that would have worked over a shared transport must not start failing
    // because a relay was unreachable, so a dial failure is logged and the chain continues.
    await dialInviteEndpoint({ invite: state.invite, dialEndpoint, activeEndpointUrl });
    const result = await runFinalSubmitChain(state, callSkill, sendPeerRedeem, circleAddressFor, signCircleLink);
    // carry the joiner's declined caps out with the success envelope so the host records
    // them into the member's prefs (`override.capabilityOptOuts`), feeding the gate's admin ∩ user set.
    if (result && Array.isArray(state.capabilityOptOuts) && state.capabilityOptOuts.length) {
      result.capabilityOptOuts = [...state.capabilityOptOuts];
    }
    state.submitting = false;
    // A joined circle is not yet a REACHABLE one (found on hardware 2026-07-30).
    //
    // Before anyone can message a new member, their device must register its per-circle address for the
    // circle and bind the other members' circle addresses to their keys from the roster. Both existed;
    // neither was reached from the join. They hung off `CircleLauncherScreen`'s load and circle-open
    // effects, so a join that happened anywhere else -- a tapped invite link opens this wizard over
    // whatever screen you were on -- left the member on the roster at an address their own device had
    // never registered. Confirmed by experiment: the roster had the address, the relay did not, and a
    // restart fixed it. A new member was unreachable until they relaunched the app, which is exactly
    // when someone is most likely to message them.
    //
    // The seam lives HERE rather than only in `joinCircleFromInvite` because the wizard calls
    // `finalSubmit` directly -- this is the one choke point the UI and the programmatic path share.
    // Best-effort and after the fact: the join has already succeeded, and failing it here would turn a
    // completed join into a reported failure.
    if (result && result.groupId && typeof onJoined === 'function') {
      try { await onJoined({ circleId: result.groupId }); }
      catch { /* reachability is repaired on the next circles load either way */ }
    }
    // Record this circle membership into the profile registry (restore-data) so a restored device knows its
    // circles + the handle it used there. The one choke point both the UI and programmatic paths share, and
    // where `state.handle` + `result.groupId` + `circleAddressFor` are all in scope (the `onJoined` seam
    // carries neither the handle nor, on the web render wizard, itself). Only when handle + a resolved address
    // are present — an address-less record is invalid (the registry setter requires both). Best-effort AFTER
    // success: a failure just means the restored-device circle list won't include this one; the join already
    // succeeded. The wrapped-key ref is written later (group-key event) and is optional in the record.
    if (result && result.groupId && state.handle && typeof circleAddressFor === 'function') {
      try {
        const address = circleAddressFor(result.groupId);
        if (address) {
          await callSkill('agents', 'setProfileCircleMembership', {
            id: 'default', circleId: result.groupId, handle: state.handle, address,
          });
        }
      } catch { /* best-effort restore-data — never fails a completed join */ }
    }
    return { result, state };
  } catch (err) {
    // Handle-uniqueness rejection (Decision C): surface it as a localisable prompt to
    // pick another handle, and keep the joiner on the handle step. Any other error is
    // reported verbatim (raw substrate string) as before.
    //
    // `submitErrorReason` is the MACHINE-readable half, and it is why this block changed (2026-07-30).
    // The typed reason exists right here — the throw sites mint `admin-unreachable` and `handle-taken`
    // deliberately — and it used to be spent entirely on choosing a locale key. A programmatic caller
    // (`joinCircleFromInvite`) reads `submitError`, which these branches never set, so every typed failure
    // reached it as a bare `join-failed`. That made "this invite expired" indistinguishable from "the admin
    // is offline" — a distinction that matters to the person joining, and one that made the invite-expiry
    // bug found the same week harder to diagnose than it needed to be.
    if (err?.reason === 'handle-taken' || /handle-taken/.test(String(err?.message ?? ''))) {
      state.handleRejected = true;
      state.submitErrorKey = 'circle.errors.invalid_handle.handle-taken';
      state.submitErrorReason = 'handle-taken';
      state.step = 3;
    } else if (/invite-redemption-limit-reached/.test(String(err?.message ?? ''))) {
      // B5 — the ISSUER refused: this invite has admitted everyone it may. A different failure from
      // an expired code (a fresh one from the same admin fixes it) and from an offline admin (waiting
      // fixes it), so it gets its own typed reason and its own sentence rather than a raw substrate
      // string. The joiner is told the invite is spent, never the circle's limit.
      state.submitError = err?.message ?? String(err);
      state.submitErrorKey = 'circle.invite.limit_reached';
      state.submitErrorReason = 'invite-redemption-limit-reached';
    } else if (err?.reason === 'admin-unreachable') {
      // J-NP2 — a notice, not a failure verdict: no admin was online, the invitation stays valid, try
      // again later. The state keeps the decoded invite, so retrying is the same wizard, same step.
      state.submitErrorKey = 'circle.nearbyScreen.join_no_admin';
      state.submitErrorReason = 'admin-unreachable';
    } else {
      state.submitError = err?.message ?? String(err);
      // An expired or rotated-away code arrives as the substrate's own string. Naming it here means a
      // caller can act on it — "ask for a fresh invite" is a different instruction from "try again later".
      state.submitErrorReason = /invalid-or-expired-code/.test(String(err?.message ?? ''))
        ? 'invalid-or-expired-code'
        : 'join-failed';
    }
    state.submitting = false;
    return { state };
  }
}

/**
 * Connect to the endpoint the invite names, before the redeem that needs it.
 *
 * The ordering bug this fixes (J-CP1, walked on hardware 2026-07-29): the only consumer of an invite's
 * `relayUrl` ran from the join callback, which needs a circle id — which only exists once the join has
 * already succeeded. So a joiner adopted the circle's relay strictly AFTER the redeem that had to travel
 * over it. With a relay-only admin and a joiner on defaults, the redeem went out over NKN, waited 15s for
 * an HI that could never arrive, and the join died holding an invite that named the relay it needed.
 *
 * Best-effort on purpose. The decision is `endpointToDialForInvite`; connecting belongs to the host, so it
 * arrives as a seam. A missing seam is not an error — the programmatic path (`joinCircleFromInvite`) is
 * used by callers that manage their own transport.
 */
async function dialInviteEndpoint({ invite, dialEndpoint, activeEndpointUrl }) {
  if (typeof dialEndpoint !== 'function') return { dialled: null };
  const active = typeof activeEndpointUrl === 'function' ? activeEndpointUrl() : activeEndpointUrl;
  const url = endpointToDialForInvite({ invite, activeUrl: active ?? null });
  if (!url) return { dialled: null };
  try {
    await dialEndpoint(url);
    return { dialled: url };
  } catch (err) {
    // Not fatal: the admin may still be reachable another way, and a hard failure here would turn a
    // working join into a broken one.
    if (typeof console !== 'undefined') {
      console.warn(`[join] could not connect to the invite's endpoint ${url}:`, err?.message ?? err);
    }
    return { dialled: null, error: err?.message ?? String(err) };
  }
}

/**
 * Typed admin-unreachable error (J-NP2). The invite is NOT consumed by this failure — the state keeps it,
 * so "try again later" is literally a retry of the same wizard.
 */
function adminUnreachableError() {
  const e = new Error('admin-unreachable');
  e.reason = 'admin-unreachable';
  return e;
}

/** Throw a typed handle-taken error the finalSubmit catch maps to the localised prompt. */
function handleTakenError() {
  const e = new Error('handle-taken');
  e.reason = 'handle-taken';
  return e;
}

async function runFinalSubmitChain(state, callSkill, sendPeerRedeem, circleAddressFor, signCircleLink) {
  const inv = state.invite;
  // SENSITIVE — the presented per-circle KEY. undefined = fresh/unlinkable (the seam
  // derives this circle's own address); a value = the chosen existing self's key.
  const circleAddress = presentedCircleAddress(state, circleAddressFor);
  // Signing PROOF that the joiner controls that key (Decision B — the "continue as an
  // existing self" claim must be PROVABLE, not merely asserted: a co-member who has seen
  // the source address cannot forge this signature). Signed by the SOURCE circle's identity
  // (state.linkChoice) over a challenge bound to the JOINING circle. The admin verifies it
  // and drops the linkage if it's missing/invalid. Absent seam ⇒ no proof ⇒ admin drops it.
  let circleAddressProof = null;
  if (circleAddress && typeof signCircleLink === 'function') {
    try { circleAddressProof = (await signCircleLink(state.linkChoice, inv?.groupId, circleAddress)) ?? null; }
    catch { circleAddressProof = null; }
  }
  const circleAddressArg = circleAddress
    ? { circleAddress, ...(circleAddressProof ? { circleAddressProof } : {}) }
    : {};

  if (inv?.kind === 'membershipCode' && inv.code && inv.groupId) {
    // Path A — membershipCode.
    const handle = await callSkill('stoop', 'setMyHandle', { handle: state.handle });
    if (handle?.reason === 'handle-taken') throw handleTakenError();
    if (handle?.ok === false || handle?.error) {
      throw new Error(handle.error ?? "Couldn't set handle.");
    }
    // Fold-in phase C — enact the ACCEPTED charter-driven skill-sharing default BEFORE the
    // release is computed, so the coarse (category-rung) skill keys ride the same join release.
    // The effective persona falls back to 'default' when joining minimally: the accepted skills
    // default must still work for a joiner who never made personas (setShareOfferingsAtJoin(false)
    // — unchecking the visible line — keeps everything withheld, exactly as before).
    await applyOfferingsDisclosureAtJoin({ state, callSkill, contextId: inv.groupId });
    // Wave B — enact the chosen reveal preset (C7 · §1.6) onto the persona's per-circle
    // disclosure BEFORE the release, so the join release honours the reveal-state default.
    await applyJoinRevealState({ state, callSkill, contextId: inv.groupId });
    // Property layer — join AS a chosen persona: release what that persona discloses in THIS circle
    // (getPersonaRelease) and carry it so the roster records it. No persona / nothing disclosed → absent (withhold).
    let personaProperties;
    const releasePersona = state.persona
      ?? ((state.shareOfferingsAtJoin === true || isRevealPreset(state.revealPreset)) ? 'default' : null);
    if (releasePersona) {
      try { personaProperties = (await callSkill('agents', 'getPersonaRelease', { id: releasePersona, contextId: inv.groupId }))?.released; }
      catch { personaProperties = undefined; }
    }
    const personaArg = (personaProperties && Object.keys(personaProperties).length) ? { personaProperties } : {};
    // Rules acceptance (task #80, sitting-A decision): the wizard's tick becomes the CURRENT rules
    // version as a string on the redeem — the writer records it verbatim onto the SIGNED join
    // statement, and every receiving device's fold is what judges it. Unticked (a programmatic caller
    // that did not pass acceptance) sends nothing, and a rules-gated fold refuses the join — the
    // statement is the record, never the tick-box. Versions are monotonic integers from 1
    // (createGroupV2 / updateGroupRules), so an invite without an embedded rules doc means v1.
    const rulesArg = state.rulesAccepted === true
      ? { rulesAccepted: String(inv.rules?.version ?? 1) }
      : {};
    const redeem = await callSkill('stoop', 'redeemMembershipCode', {
      groupId: inv.groupId, code: inv.code,
      ...(state.handle ? { peerDisplay: state.handle } : {}),
      ...personaArg, ...circleAddressArg, ...rulesArg,
    });
    if (redeem?.error === 'handle-taken') throw handleTakenError();
    // Cross-instance fallback.
    if (redeem?.error === 'invalid-or-expired-code' && inv.adminPeerAddr && typeof sendPeerRedeem === 'function') {
      // J-NP2 — the admin-offline case gets its own TYPE. The peer redeem reaching nobody (a transport
      // throw, a timeout, an empty reply) is not a broken invite: the code may be perfectly valid and the
      // admin's phone simply off. Reported generically, this failure is indistinguishable from a bad
      // invite, people conclude the app does not work, and the retry that would have succeeded never
      // happens. Same pattern as handle-taken: typed here, mapped to a localisable key in the catch.
      let peerReply;
      try {
        peerReply = await sendPeerRedeem({
          adminPeerAddr:    inv.adminPeerAddr,
          groupId:     inv.groupId,
          code:        inv.code,
          shareCard:   !!state.shareAddress,
          peerDisplay: state.handle,
          ...personaArg,
          ...circleAddressArg,
          ...rulesArg,   // the remote path carries the SAME acceptance (task #80) — the admin forwards it onto the join it signs
        });
      } catch {
        throw adminUnreachableError();     // could not even reach them — the clearest offline signal
      }
      if (peerReply?.error === 'handle-taken') throw handleTakenError();
      if (!peerReply) throw adminUnreachableError();   // reached out, heard nothing
      if (peerReply.error) {
        // A real REJECTION from a live admin device stays verbatim — that is not "offline".
        throw new Error(peerReply.error);
      }
      await callSkill('stoop', 'recordRemoteRedemption', {
        groupId:     inv.groupId,
        code:        inv.code,
        codeId:      peerReply.codeId ?? null,
        expiresAt:   peerReply.validUntil ?? null,
        confirmedBy: inv.adminPeerAddr,
        // The ADMIN's own per-circle address for this circle, riding back on the redeem response
        // (2026-07-30). Forwarded raw WITH its proof: the substrate verifies it (`verifyCircleLink`) and
        // records it only if the proof holds, exactly as the admin does with ours on the way in. Without
        // this the joiner knows the admin only as `confirmedBy` — a global signing key — and a send to
        // them is refused whenever the per-user address-fallback setting is off.
        ...(peerReply.circleAddress ? { confirmedByCircleAddress: peerReply.circleAddress } : {}),
        ...(peerReply.circleAddressProof ? { confirmedByCircleAddressProof: peerReply.circleAddressProof } : {}),
        // The joiner's OWN per-circle address + proof (batch 5) — the same pair just presented to the
        // admin, so the LOCAL mirror row is complete at redeem too (the substrate re-verifies the
        // proof; an unproven address is dropped there, never recorded).
        ...circleAddressArg,
        ...(state.handle ? { peerDisplay: state.handle } : {}),
        ...(inv.rules && typeof inv.rules === 'object' ? { rules: inv.rules } : {}),
      });
      return {
        ok:      true,
        message: `✓ Joined circle "${inv.groupId}" as ${state.handle} (confirmed by admin over peer-bridge).`,
        groupId: inv.groupId,
        handle:  state.handle,
      };
    }
    if (redeem?.ok === false || redeem?.error) {
      throw new Error(redeem.error ?? "Couldn't redeem code.");
    }
    return {
      ok:      true,
      message: `✓ Joined circle "${inv.groupId}" as ${state.handle}.`,
      groupId: inv.groupId,
      handle:  state.handle,
    };
  }

  // Not a membership code. REFUSE BY NAME rather than falling off the end: a bare `return`
  // here would hand the caller `undefined`, and every caller reads a missing result as "nothing
  // went wrong", which is how an unjoined circle would report itself as joined.
  throw new Error(
    `This invite is not a membership code (kind: ${inv?.kind ?? 'none'}) — ask for a new invite link.`,
  );
}
