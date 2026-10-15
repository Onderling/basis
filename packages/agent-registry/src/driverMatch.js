// Personal-drivers matcher (#4) — the ON-DEVICE engine. Your private drivers never leave the device;
// each device scores an incoming item's driver signature against its OWN drivers locally and surfaces
// the matches. No network, no new crypto (invariant #7); the deterministic layer needs no model at all.
//
// EXPLAINABILITY IS A HARD INVARIANT (Frits, 2026-07-15): a match may only be surfaced if it can state
// its reason in plain language. So there are exactly two match sources, both explainable:
//   1. tag overlap        → reason { kind:'tags', tags:[shared…] }   (deterministic, offline, no model)
//   2. an injected LLM     → reason { kind:'llm', text:'…' }          (semantic, only WHEN a judge is wired)
// A raw similarity score is NEVER a match reason on its own (that was the TF-IDF trap: unexplainable
// mismatches). TF-IDF, if ever added, may only PRE-FILTER candidates INTO the judge — never surface.
//
// Pure deterministic core + an optional async judge-aware wrapper. web ≡ mobile.

import { normalizeTags, driversFromProperties, isDriverValue } from './drivers.js';

/**
 * A "driver signature" is what an item carries for matching: `{ text, tags[] }` (#5 puts it on
 * questions/tasks). Normalises to the same tag space as a driver so overlap is stable.
 * @param {{text?:string, tags?:string[]}} sig
 */
export function deriveSignature({ text = '', tags = [] } = {}) {
  return { text: String(text ?? '').trim(), tags: normalizeTags(tags) };
}

/**
 * Derive a driver signature FROM an item. An item that carries an explicit `driverSignature`
 * (#5 — questions/tasks author it) uses that; otherwise fall back to the item's own `{text, tags}`
 * (so a plain tagged post still matches). Returns a normalised `{text, tags}`.
 *
 * @param {{driverSignature?:object, text?:string, title?:string, tags?:string[]}} item
 */
export function itemSignature(item) {
  // Broadcast payloads carry these at the top level; a STORED item nests them under `source`. Accept both.
  const src = (item?.source && typeof item.source === 'object') ? item.source : {};
  const sig = item?.driverSignature ?? src.driverSignature;
  if (sig && typeof sig === 'object' && !Array.isArray(sig)) return deriveSignature(sig);
  // Fall back to the author's EXISTING tags — `tags`, or a post's `skillTags` / `requiredSkills`
  // (which already ride the broadcast) — so a normally-tagged post is matchable with no new field.
  const tags = [
    ...(Array.isArray(item?.tags) ? item.tags : []),
    ...(Array.isArray(item?.skillTags) ? item.skillTags : []),
    ...(Array.isArray(item?.requiredSkills) ? item.requiredSkills : []),
    ...(Array.isArray(src.skillTags) ? src.skillTags : []),
    ...(Array.isArray(src.requiredSkills) ? src.requiredSkills : []),
  ];
  // the taxonomy category is one more tag, the same on the driver side (`categoryTag`): a post that only names its
  // category still meets an offering of that category — one matcher, no second rule
  const cat = typeof item?.categoryId === 'string' && item.categoryId ? item.categoryId : (typeof src.categoryId === 'string' ? src.categoryId : null);
  return deriveSignature({ text: item?.text ?? item?.title ?? '', tags: cat ? [...tags, categoryTag(cat)] : tags });
}

/** The tag a taxonomy category is on both sides of a match (item and driver). */
export function categoryTag(categoryId) {
  return `category-${categoryId}`;
}

/** A driver's tags as the matcher reads them: its own, plus its category's tag when it has one. */
function driverTags(driver) {
  const own = Array.isArray(driver?.tags) ? driver.tags : [];
  return typeof driver?.categoryId === 'string' && driver.categoryId ? [...own, categoryTag(driver.categoryId)] : own;
}

/**
 * Convenience bridge: match an item against the DRIVER properties held on a profile's property map
 * (pulls the drivers out with `driversFromProperties`, derives the item signature, then matches).
 * Deterministic when no `judge`; semantic when one is wired. This is the seam the app calls per
 * incoming feed item — the private drivers stay in the profile, on-device.
 *
 * @param {object} a
 * @param {Record<string, any>} a.properties   the profile's full property map
 * @param {object} a.item                       the incoming item (carries a driverSignature or text/tags)
 * @param {Function} [a.judge]                   optional injected LLM judge
 * @param {number} [a.minShared=1]
 * @returns {Promise<Array<object>>}
 */
export function matchProfileDrivers({ properties, item, judge, minShared = 1 } = {}) {
  return matchDriversSemantic({
    drivers: driversFromProperties(properties),
    signature: itemSignature(item),
    judge,
    minShared,
  });
}

/**
 * Build a driver-matching SIGNATURE from a candidate's MATCHABLE value-set — the `{ key → value }`
 * map produced by `releasedForMatching` (disclosure.js). This is the counterpart to `itemSignature`:
 * where that turns an incoming feed ITEM into a signature, this turns another person's matchable
 * surface into one, so MY drivers can be scored against it (profile↔profile matching).
 *
 * A driver value contributes its tags (+ text); a plain string value (a coarse-enum like a place)
 * contributes as a single tag. Everything flattens into the SAME normalised tag space the item
 * matcher already uses, so no new matching logic is needed — just a new signature source.
 *
 * NOTE: the input is a MATCHABLE set, never a disclosed one — the caller feeds it the output of
 * `releasedForMatching`, NOT `releasedValues`. The values are used only to compute a match on the
 * matcher's device; they are not surfaced anywhere (the de-identification model).
 *
 * @param {Record<string, any>} matchableValues   releasedForMatching(...) output
 * @returns {{text:string, tags:string[]}}
 */
export function matchableSignature(matchableValues) {
  const tags = [];
  const texts = [];
  for (const v of Object.values(matchableValues ?? {})) {
    if (isDriverValue(v)) {
      if (v.text) texts.push(v.text);
      for (const t of v.tags) tags.push(t);
    } else if (typeof v === 'string' && v.trim()) {
      tags.push(v);                       // a coarse-enum value (e.g. 'bird-watching') matches as a tag
    }
    // structured coded values ({code,system,…}) carry no tag space → not matched on here
  }
  return deriveSignature({ text: texts.join(' '), tags });
}

/**
 * PROFILE↔PROFILE matchable-aware match: score MY private drivers against a CANDIDATE's MATCHABLE
 * surface. My side never leaves my device (the drivers stay in `properties`); the candidate's side is
 * ONLY the matchable set they consented to expose for matching (`releasedForMatching` output) — never
 * their disclosed/roster values. Reuses the exact same explainable matcher (`matchDriversSemantic`):
 * tag overlap, optional injected judge, every surfaced match carries its plain-language reason.
 *
 * This is the on-device matcher's matchable path. The existing item path (`matchProfileDrivers`) is
 * unchanged — this ADDS the profile↔profile path by feeding the matcher a matchable-derived signature
 * instead of an item-derived one.
 *
 * @param {object} a
 * @param {Record<string, any>} a.properties         MY full property map (drivers pulled out locally)
 * @param {Record<string, any>} a.candidateMatchable a candidate's releasedForMatching(...) value-set
 * @param {Function} [a.judge]                        optional injected LLM judge
 * @param {number} [a.minShared=1]
 * @returns {Promise<Array<object>>}
 */
export function matchProfilesMatchable({ properties, candidateMatchable, judge, minShared = 1 } = {}) {
  return matchDriversSemantic({
    drivers: driversFromProperties(properties),
    signature: matchableSignature(candidateMatchable),
    judge,
    minShared,
  });
}

// TODO (P4c follow-ons, NOT in this pass — kept as seam notes):
//  • basis match-PROPOSAL trigger — call this from apps/basis (the driverMatchNotify seam) on
//    property-change and circle-join, not only per-incoming-feed-item, and surface "N people here
//    also care about Y — connect?" (NOTE-skills-vs-capabilities.md volley 3; the wiring is app-side).
//  • TEE two-sided-blind — matchProfilesMatchable is still ONE-SIDED: the candidate's matchable set
//    reaches this (the matcher's) device, safe today only via de-identification / anon circles. The
//    neither-side-exposed upgrade is TEE matching (drivers-#6), deferred.

/** The tags two tag-lists share (normalised inputs assumed), first-seen order of `a`. */
export function sharedTags(a = [], b = []) {
  const set = new Set(b);
  return a.filter((t) => set.has(t));
}

/** Jaccard overlap ∈ [0,1] over two tag sets — used ONLY to RANK explainable matches, never to gate. */
export function jaccard(a = [], b = []) {
  if (!a.length && !b.length) return 0;
  const A = new Set(a); const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Deterministic score of ONE driver against a signature. Returns a match ONLY when they share at
 * least `minShared` tags (the explainable signal); otherwise null. `score` (Jaccard) is for ranking.
 *
 * @param {{kind:string, text:string, tags:string[]}} driver
 * @param {{text:string, tags:string[]}} signature
 * @param {{minShared?:number}} [opts]
 * @returns {{kind:string, score:number, sharedTags:string[], reason:{kind:'tags',tags:string[]}}|null}
 */
export function scoreDriver(driver, signature, { minShared = 1 } = {}) {
  const tags = normalizeTags(driverTags(driver));
  const shared = sharedTags(tags, signature?.tags ?? []);
  if (shared.length < minShared) return null;
  return {
    kind: driver?.kind ?? 'driver',
    score: jaccard(tags, signature?.tags ?? []),
    sharedTags: shared,
    reason: { kind: 'tags', tags: shared },
  };
}

/**
 * DETERMINISTIC on-device match: score every private driver against the item signature, keep the
 * explainable (tag-overlapping) ones, ranked by score desc. `drivers` is a `{ key → driverValue }`
 * map (as stored on the profile) OR an array of driver values.
 *
 * @param {object} a
 * @param {Record<string,object>|Array<object>} a.drivers
 * @param {{text?:string, tags?:string[]}} a.signature
 * @param {number} [a.minShared=1]
 * @returns {Array<{key:string|null, kind:string, score:number, sharedTags:string[], reason:object}>}
 */
export function matchDrivers({ drivers, signature, minShared = 1 } = {}) {
  const sig = deriveSignature(signature);
  const entries = Array.isArray(drivers)
    ? drivers.map((v, i) => [String(i), v])
    : Object.entries(drivers ?? {});
  const out = [];
  for (const [key, driver] of entries) {
    const m = scoreDriver(driver, sig, { minShared });
    if (m) out.push({ key: Array.isArray(drivers) ? null : key, ...m });
  }
  out.sort((x, y) => y.score - x.score);
  return out;
}

/**
 * SEMANTIC on-device match: the deterministic matches PLUS, when an LLM `judge` is wired, the drivers
 * that DON'T share tags but the judge rules resonant (catching the synonyms tag-overlap misses). The
 * judge runs locally/privatemode/companion — the drivers still never leave a trusted environment.
 * Every judge match carries the judge's own reason, so the explainability invariant holds.
 *
 * `judge({ driver, signature })` resolves `{ match:boolean, reason?:string }`. A judge that throws (or
 * a missing judge) simply yields no semantic additions — the deterministic layer always stands.
 *
 * @param {object} a
 * @param {Record<string,object>|Array<object>} a.drivers
 * @param {{text?:string, tags?:string[]}} a.signature
 * @param {(x:{driver:object, signature:object})=>Promise<{match:boolean, reason?:string}>} [a.judge]
 * @param {number} [a.minShared=1]
 * @returns {Promise<Array<{key:string|null, kind:string, score:number, sharedTags:string[], reason:object}>>}
 */
export async function matchDriversSemantic({ drivers, signature, judge, minShared = 1 } = {}) {
  const sig = deriveSignature(signature);
  const isArray = Array.isArray(drivers);
  // One pass over a uniform [key, driver] list (arrays keyed by index → null in output, like matchDrivers).
  const entries = isArray
    ? drivers.map((v, i) => [i, v])
    : Object.entries(drivers ?? {});

  const tagMatches = [];
  const judgeCandidates = [];
  for (const [key, driver] of entries) {
    const outKey = isArray ? null : key;
    const tags = normalizeTags(driverTags(driver));
    const shared = sharedTags(tags, sig.tags);
    if (shared.length >= minShared) {
      tagMatches.push({
        key: outKey, kind: driver?.kind ?? 'driver',
        score: jaccard(tags, sig.tags),
        sharedTags: shared, reason: { kind: 'tags', tags: shared },
      });
    } else {
      judgeCandidates.push([outKey, driver]);   // no tag overlap → only a judge can explain a match
    }
  }
  tagMatches.sort((x, y) => y.score - x.score);
  if (typeof judge !== 'function') return tagMatches;

  const semantic = [];
  for (const [outKey, driver] of judgeCandidates) {
    let verdict;
    try { verdict = await judge({ driver, signature: sig }); }
    catch { verdict = null; }   // a judge failure never removes the deterministic layer
    if (verdict?.match) {
      semantic.push({
        key: outKey, kind: driver?.kind ?? 'driver',
        score: 0,                              // no tag overlap → ranked below every tag match
        sharedTags: [],
        reason: { kind: 'llm', text: String(verdict.reason ?? '').trim() || 'a semantic match' },
      });
    }
  }
  // Tag matches first (explainable by shared tags), then judge matches (explainable by the judge's reason).
  return [...tagMatches, ...semantic];
}
