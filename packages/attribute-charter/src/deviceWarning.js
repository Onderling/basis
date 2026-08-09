/**
 * Device warning — the traceability guard's third layer, an ON-DEVICE, low-leak
 * heuristic. The round exposes only an approximate cohort size `n` (a count —
 * low sensitivity). The device warns when the participant's enabled combo is
 * likely rare: it never needs the actual distribution, only `n` + the
 * participant's own enabled set.
 *
 * Heuristic (plans/NOTE-requested-attributes-charter.md §4.3): warn when the
 * participant enables ≥2 attributes AND the possible-combo space of their enabled
 * attributes exceeds `n` (so their combo is probably unique in the cohort).
 *
 * Returns a structured verdict; the UI renders the localised copy from it (this
 * package holds NO user-facing strings — invariant #8). Pure function.
 */
import { bucketCount } from './vocabulary.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';

// The graduated warning modes (property-layer §10b). 'minimal' warns only on NEAR-CERTAIN uniqueness (a
// stricter bar than 'normal'); 'off' never warns.
// Parameter register (#36) — k-anonymity minimal-factor (scope:agent, kind:internal — a privacy safety bound).
export const MINIMAL_FACTOR = param({ key: 'charter.minimalFactor', scope: PARAM_SCOPE.AGENT, kind: PARAM_KIND.INTERNAL, default: 4 });

/**
 * On-device disclosure warning: warns when the participant's enabled attribute combo is likely
 * rare in a cohort of size `n` — i.e. ≥2 keys enabled AND their possible-combo space (product of
 * bucket counts) exceeds the threshold (`n` in 'normal' mode, `n × MINIMAL_FACTOR` in 'minimal';
 * 'off' never warns). Pure; returns a structured verdict, no user-facing strings. An unknown or
 * non-positive `n` yields `n: null` and no warning.
 *
 * @param {{enabledKeys: string[], n: number, mode?: 'normal'|'minimal'|'off'}} args
 *   enabledKeys — the attribute keys the participant is about to share
 *   n           — approximate cohort size for this round/charter
 *   mode        — 'normal' (combo-space > n) · 'minimal' (near-certain: combo-space > n×MINIMAL_FACTOR) · 'off'
 * @returns {{warn: boolean, comboSpace: number, enabledCount: number, n: number|null}}
 *   `n` is echoed back, or `null` when the given cohort size was missing/non-finite/non-positive.
 */
export function disclosureWarning({ enabledKeys = [], n, mode = 'normal' } = {}) {
  const keys = Array.isArray(enabledKeys) ? enabledKeys : [];
  const enabledCount = keys.length;
  // Possible-combo space = product of each enabled attribute's bucket count.
  const comboSpace = keys.reduce((acc, key) => acc * Math.max(1, bucketCount(key)), 1);
  const knownN = Number.isFinite(n) && n > 0 ? n : null;
  // 'minimal' raises the bar (only warn when the combo is near-certainly unique); 'off' silences.
  const threshold = mode === 'minimal' ? (knownN ?? 0) * MINIMAL_FACTOR : knownN;
  const warn = mode !== 'off' && enabledCount >= 2 && knownN !== null && comboSpace > threshold;
  return { warn, comboSpace, enabledCount, n: knownN };
}
