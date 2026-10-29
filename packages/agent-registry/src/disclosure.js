// Disclosure layer — the single mechanism the whole property layer shares (design Phase 0).
// See plans/NOTE-property-layer-design.md §1–2.
//
// A DISCLOSURE POLICY records, PER CONTEXT (a circle / project / request), which properties
// the user chose to share and at which coarseness RUNG. It is default-WITHHOLD: a property
// not enabled for a context is simply not released — and a withheld key is ABSENT from the
// release, never marked (a "withheld" flag would itself be a signal).
//
// THREE ORTHOGONAL DISCLOSURE AXES (foundation; NOTE-skills-vs-capabilities.md volley 3).
// A property carries three INDEPENDENT switches per (context, key), none collapsing into a
// single "share" toggle — each defaults to withhold (false):
//   • disclosed  (`enabled`)   — visible to the circle (the disclosure ladder; the only axis
//                                `releasedValues` reads). Default false.
//   • matchable                — may participate in on-device MATCHING without being disclosed
//                                (the "secret/passive" match: I don't publish my hobby, but the
//                                matcher may check it). A consent by the matched-AGAINST party;
//                                its safety rests on de-identification (anon circles) today, TEE
//                                two-sided-blind later. Can be TRUE while disclosed is FALSE —
//                                that is the whole point. Default false.
//   • requestable              — may others' agents invoke/ping me about it. Default false.
// matchable/requestable NEVER leak a VALUE: `releasedValues` keys off `enabled`/`rung` only.
//
// This is the generalisation of @onderling/attribute-charter's feedback-local disclosureProfile:
// ONE policy on the profile, reused across every app/bot. The policy is a plain serialisable
// object (persist it wherever); all functions are pure transforms.

import { resolveProperty, isMarkerKey } from './profileProperties.js';
import { isPresentedAttributeKey } from './personaHandle.js';

/** A fresh, share-nothing policy. */
export function createDisclosurePolicy() {
  return { perContext: {} };
}

/**
 * Set the disclosure of one property for one context across the THREE independent axes.
 * Returns a NEW policy. Default is withhold — you only ever ADD a deliberate share.
 *
 * Each axis is set INDEPENDENTLY: pass only the axis you want to change and the others are
 * PRESERVED (not clobbered), so `matchable` can be toggled without touching `enabled`, and vice
 * versa. An axis never touched stays at its withheld default (false / null). This is what lets
 * matchable be TRUE while disclosed is FALSE.
 *
 * @param {object} policy
 * @param {string} contextId
 * @param {string} key
 * @param {{ enabled?: boolean, rung?: string|null, matchable?: boolean, requestable?: boolean }} [choice]
 */
export function setDisclosure(policy, contextId, key, choice = {}) {
  if (typeof contextId !== 'string' || !contextId) throw new TypeError('setDisclosure: contextId required');
  if (typeof key !== 'string' || !key) throw new TypeError('setDisclosure: key required');
  const c = choice || {};
  const has = (f) => Object.prototype.hasOwnProperty.call(c, f);
  const perContext = { ...(policy?.perContext || {}) };
  const ctx = { ...(perContext[contextId] || {}) };
  const prev = ctx[key] || {};
  ctx[key] = {
    // disclosed (the released axis) + its coarseness rung
    enabled:     has('enabled')     ? c.enabled === true     : prev.enabled === true,
    rung:        has('rung')        ? (c.rung ?? null)       : (prev.rung ?? null),
    // matchable — may participate in matching without being disclosed (default withhold)
    matchable:   has('matchable')   ? c.matchable === true   : prev.matchable === true,
    // requestable — may others' agents invoke/ping about it (default withhold)
    requestable: has('requestable') ? c.requestable === true : prev.requestable === true,
  };
  perContext[contextId] = ctx;
  return { perContext };
}

/**
 * Forget one property's disclosure in EVERY context: what a removed property leaves behind would otherwise be a
 * release with nothing under it, which comes back the day a property of the same key does. Returns a NEW policy; a
 * context left empty goes too.
 */
export function forgetDisclosureKey(policy, key) {
  const perContext = {};
  for (const [contextId, ctx] of Object.entries(policy?.perContext || {})) {
    const { [key]: _gone, ...rest } = ctx || {};
    if (Object.keys(rest).length) perContext[contextId] = rest;
  }
  return { perContext };
}

/**
 * The disclosure choice for a key in a context, across all three axes. Default = full withhold
 * ({enabled:false, rung:null, matchable:false, requestable:false}). Backward-compatible: an old
 * entry carrying only {enabled,rung} reads as matchable:false/requestable:false.
 */
export function getDisclosure(policy, contextId, key) {
  const e = policy?.perContext?.[contextId]?.[key];
  return {
    enabled:     e?.enabled === true,
    rung:        e?.rung ?? null,
    matchable:   e?.matchable === true,
    requestable: e?.requestable === true,
  };
}

/** Is this property DISCLOSED (visible to the circle) for this context? (the released axis) */
export function isDisclosed(policy, contextId, key) {
  return getDisclosure(policy, contextId, key).enabled === true;
}

/** May this property participate in MATCHING for this context — even without being disclosed? */
export function isMatchable(policy, contextId, key) {
  return getDisclosure(policy, contextId, key).matchable === true;
}

/** May others' agents invoke/ping about this property for this context? (default false) */
export function isRequestable(policy, contextId, key) {
  return getDisclosure(policy, contextId, key).requestable === true;
}

/**
 * The values a REQUEST may see for a CONTEXT, given the user's profile + disclosure policy.
 * For each requested key: if the user enabled it for this context AND the profile resolves a
 * value (own, or inherited up the profile chain), release that value coarsened to the chosen
 * rung. Everything else is ABSENT (default-withhold, no marker). Pure.
 *
 * @param {object} profileCtx
 * @param {(id:string)=>({properties?:object}|null|undefined)} profileCtx.getProfile
 * @param {string} profileCtx.profileId
 * @param {string|null} [profileCtx.defaultProfileId]
 * @param {{ items?: Array<{key:string}> }} request   the consumer's typed request
 * @param {object} policy                              the user's disclosure policy
 * @param {string} contextId
 * @param {object} [vocabulary]                        a createVocabulary(...) — for coarsening (optional)
 * @returns {object}  { [key]: releasedValue } for enabled + resolvable keys only
 */
export function releasedValues({ getProfile, profileId, defaultProfileId = null }, request, policy, contextId, vocabulary = null) {
  const out = {};
  const items = Array.isArray(request?.items) ? request.items : [];
  for (const item of items) {
    const key = item?.key;
    if (typeof key !== 'string' || !key || isMarkerKey(key)) continue;   // a marker is never released
    if (isPresentedAttributeKey(key)) continue;   // nor the handle: the persona's own statements present it
    // ONLY the disclosed axis (enabled/rung) releases a VALUE. matchable/requestable are
    // deliberately NOT consulted here — a matchable-but-not-disclosed property never leaks.
    const { enabled, rung } = getDisclosure(policy, contextId, key);
    if (!enabled) continue;                                              // default-withhold → absent
    const value = resolveProperty(getProfile, profileId, key, { defaultProfileId });
    if (value === undefined) continue;                                   // nothing to share
    // Fail-CLOSED: if a declared coarsen fn can't reduce the value (returns undefined), WITHHOLD
    // it — never leak the raw fine value because coarsening failed. No coarsen fn → value as-is.
    const released = vocabulary ? vocabulary.coarsen(key, value, rung) : value;
    if (released === undefined) continue;
    out[key] = released;
  }
  return out;
}

/* ─── release DIFF — "did what I share here actually change?" ──────────────── */

/** Stable value comparison (order-independent for objects; absent ≡ null). */
function sameReleasedValue(a, b) {
  if (a === b) return true;
  try { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }
  catch { return false; }
}

/**
 * Which keys REALLY differ between two releases (two `releasedValues` results for the same
 * context). Added, removed and edited keys all count. The comparator behind the profile-update
 * propagation gate: an unchanged save yields `[]`, so nothing is written, sent or announced.
 *
 * An absent/`null` release and `{}` mean the same thing ("I share nothing here") — the roster
 * normalises an empty disclosure to `null`, so this must treat them alike.
 *
 * @param {object|null} before
 * @param {object|null} after
 * @returns {string[]} changed keys, sorted (stable output for wires + tests)
 */
export function changedReleaseKeys(before, after) {
  const a = (before && typeof before === 'object' && !Array.isArray(before)) ? before : {};
  const b = (after  && typeof after  === 'object' && !Array.isArray(after))  ? after  : {};
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!sameReleasedValue(a[k], b[k])) out.push(k);
  }
  return out.sort();
}

/** True when two releases are the same — the no-op save. */
export function releaseUnchanged(before, after) {
  return changedReleaseKeys(before, after).length === 0;
}

/**
 * The MATCHING counterpart to `releasedValues` — the values the on-device matcher may consult for a
 * CONTEXT, keyed off the `matchable` axis (isMatchable), INDEPENDENT of `disclosed`/`enabled`.
 *
 * This is NOT a disclosure. The output is fed ONLY to the on-device matcher (per the one-sided,
 * de-identification model: the matched-AGAINST party consents that a property "may be checked for
 * matches", and a hit in an anonymous circle doesn't reveal WHO — NOTE-skills-vs-capabilities.md
 * volley 3). It must NEVER be rendered on the roster, added to the released/disclosed set, or used to
 * open a request channel. `releasedValues` remains the ONLY disclosure surface and stays
 * `enabled`-only, so a matchable-but-not-disclosed property is surfaced HERE and nowhere else. True
 * two-sided-blind matching (neither side exposed) is the TEE upgrade, deferred (drivers-#6).
 *
 * Symmetry with `releasedValues`: same resolve → coarsen → fail-closed pipeline (a value the coarsen
 * fn can't reduce is WITHHELD from the matcher too — matching never leaks a raw fine value either),
 * differing ONLY in the axis it keys off (`matchable` here, `enabled` there).
 *
 * Scoping: with a typed `request` (items[]) it restricts to those keys (symmetry with releasedValues);
 * with NO request it surfaces EVERY matchable key for the context — the match-PROPOSAL path (a
 * property change / circle-join runs the matcher with no incoming request).
 *
 * @param {object} profileCtx  { getProfile, profileId, defaultProfileId }  (as releasedValues)
 * @param {{ items?: Array<{key:string}> }|null} [request]  optional key filter; null = all matchable keys
 * @param {object} policy       the user's disclosure policy
 * @param {string} contextId
 * @param {object} [vocabulary] a createVocabulary(...) — for coarsening (optional)
 * @returns {object}  { [key]: matchableValue } for matchable + resolvable keys only
 */
export function releasedForMatching({ getProfile, profileId, defaultProfileId = null }, request, policy, contextId, vocabulary = null) {
  const out = {};
  // An explicit request restricts to its keys; otherwise every key the policy marks for this context
  // (we then keep only the matchable ones) — the request-less match-proposal path.
  const keys = (Array.isArray(request?.items) && request.items.length)
    ? request.items.map((it) => it?.key).filter((k) => typeof k === 'string' && k)
    : Object.keys(policy?.perContext?.[contextId] || {});
  for (const key of keys) {
    if (isMarkerKey(key)) continue;   // a marker is never matched on
    // ONLY the matchable axis gates here — enabled/requestable are deliberately NOT consulted, so this
    // fires for a matchable-but-not-disclosed property (the whole point) and never depends on disclosure.
    const { matchable, rung } = getDisclosure(policy, contextId, key);
    if (!matchable) continue;                                            // not matchable → absent
    const value = resolveProperty(getProfile, profileId, key, { defaultProfileId });
    if (value === undefined) continue;                                   // nothing to match on
    const forMatch = vocabulary ? vocabulary.coarsen(key, value, rung) : value;
    if (forMatch === undefined) continue;                                // fail-closed (as releasedValues)
    out[key] = forMatch;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reveal PRESETS — named bundles over the `enabled` (disclosure) axis (C7, design
// §1.2–1.3). A preset is a convenience for setting MANY attribute keys' `enabled`
// bits at once for a context; the per-attribute booleans remain the truth — after
// applying a preset any single key stays individually hideable, and re-reads then as
// "that preset minus the key".
//
// The presets are named for HOW MUCH you share, never for a specific field name, and
// never with a "verified"/"identity" claim (nothing is verified in the base system):
//   • handle  — the FLOOR: the pseudonym only, nothing beyond the handle enabled.
//   • profile — the presented self (display name, picture, bio, …).
//   • full    — the MOST you have chosen to share (everything the caller lists).
// They are AMOUNT-cumulative: handle ⊆ profile ⊆ full. The caller supplies which keys
// belong to each tier for a context via `keysFor(preset) -> string[]` (the tier's OWN
// keys, non-cumulative); this layer makes them cumulative and reads the highest preset
// whose whole cumulative key-set is enabled.
// ─────────────────────────────────────────────────────────────────────────────

/** Reveal presets, LEAST → MOST revealing (by amount). `handle` = floor, `full` = ceiling. */
export const REVEAL_PRESETS = Object.freeze(['handle', 'profile', 'full']);

/** True iff `p` is one of the REVEAL_PRESETS (`handle` | `profile` | `full`). */
export function isRevealPreset(p) { return REVEAL_PRESETS.includes(p); }

/** Rank a preset (0=handle … 2=full), or -1 for an unknown preset. */
export function revealPresetRank(preset) { return REVEAL_PRESETS.indexOf(preset); }

/** The next preset up (more revealing), or the same when already at the ceiling (`full`). */
export function nextRevealPreset(preset) {
  const i = revealPresetRank(preset);
  if (i < 0) return 'handle';
  return REVEAL_PRESETS[Math.min(i + 1, REVEAL_PRESETS.length - 1)];
}

/**
 * The CUMULATIVE key-set for a preset: every tier's keys up to and including `preset`,
 * de-duplicated, in tier order. `keysFor(tier)` returns that tier's OWN keys.
 * @param {string} preset
 * @param {(preset:string)=>string[]} keysFor
 * @returns {string[]}
 */
function cumulativePresetKeys(preset, keysFor) {
  const idx = revealPresetRank(preset);
  const out = [];
  const seen = new Set();
  REVEAL_PRESETS.forEach((p, i) => {
    if (i > idx) return;
    for (const k of (keysFor?.(p) || [])) {
      if (typeof k === 'string' && k && !seen.has(k)) { seen.add(k); out.push(k); }
    }
  });
  return out;
}

/**
 * Apply a reveal preset to a context: ENABLE every key in tiers ≤ `preset` and DISABLE
 * every key in tiers > `preset` (so `handle` truly floors — nothing beyond the handle
 * enabled — and `full` ceilings — all listed keys enabled). Only the `enabled` axis is
 * touched; `rung`/`matchable`/`requestable` for each key are PRESERVED. Returns a NEW
 * policy (pure). Per-attribute booleans stay the truth: hide one key afterwards and the
 * context reads as "this preset minus that key".
 *
 * @param {object} policy
 * @param {string} contextId
 * @param {string} preset                       one of REVEAL_PRESETS
 * @param {{ keysFor: (preset:string)=>string[] }} opts   the caller's per-tier key assignment
 * @returns {object} a new policy
 */
export function applyRevealPreset(policy, contextId, preset, { keysFor } = {}) {
  if (typeof contextId !== 'string' || !contextId) throw new TypeError('applyRevealPreset: contextId required');
  if (!isRevealPreset(preset)) throw new TypeError(`applyRevealPreset: unknown preset '${preset}'`);
  if (typeof keysFor !== 'function') throw new TypeError('applyRevealPreset: keysFor(preset) function required');
  const idx = revealPresetRank(preset);
  let next = policy;
  const seen = new Set();
  REVEAL_PRESETS.forEach((p, i) => {
    for (const k of (keysFor(p) || [])) {
      if (typeof k !== 'string' || !k || seen.has(k)) continue;
      seen.add(k);
      // enable if this tier is within the applied preset, else disable — other axes untouched.
      next = setDisclosure(next, contextId, k, { enabled: i <= idx });
    }
  });
  return next;
}

/**
 * The highest preset FULLY satisfied for a context: the most-revealing preset whose whole
 * cumulative key-set is `enabled`. Because presets are amount-cumulative, once a preset's
 * set is not fully enabled no higher preset can be either, so the scan stops there. A
 * `handle` tier with no keys is vacuously satisfied → the floor reads as `handle`. Returns
 * `null` only when even the `handle` floor's (non-empty) keys are not all enabled.
 *
 * @param {object} policy
 * @param {string} contextId
 * @param {{ keysFor: (preset:string)=>string[] }} opts
 * @returns {'handle'|'profile'|'full'|null}
 */
export function revealPresetOf(policy, contextId, { keysFor } = {}) {
  if (typeof keysFor !== 'function') throw new TypeError('revealPresetOf: keysFor(preset) function required');
  let best = null;
  for (const p of REVEAL_PRESETS) {
    const keys = cumulativePresetKeys(p, keysFor);
    const satisfied = keys.every((k) => isDisclosed(policy, contextId, k));
    if (!satisfied) break;                       // cumulative → higher presets can't be satisfied either
    best = p;
  }
  return best;
}
