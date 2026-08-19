/**
 * basis v2 — per-circle bottom tabs derived from Functies axis
 * (v2 1 board mockups).
 *
 * The circle view's bottom tab bar isn't a fixed Circles/Stroom/Mij set
 * (that's the LAUNCHER bar).  Inside a circle it derives from the
 * circle's `policy.features`:
 *
 *   chat            → GESPREK   (always present + first)
 *   noticeboard     → PRIKBORD
 *   tasks           → TAKEN
 *   lists           → LIJSTEN
 *   notes           → NOTITIES
 *   calendar        → AGENDA
 *   memberDirectory → LEDEN     (always rendered last when on)
 *
 * `houseRules` doesn't get a tab — it lives in the circle header's
 * overflow `⋯` menu as "Huisregels" (per).
 *
 * Boards in `Onderling interface · v2 — circle als bouwsteen · print.pdf`:
 *   - Voorbeeld 1 · NEIGHBOURHOOD     → GESPREK / PRIKBORD / LEDEN
 *   - Voorbeeld 2 · HUISHOUDEN → GESPREK / TAKEN / LIJSTEN
 *   - Voorbeeld 3 · PRIVÉ     → GESPREK / NOTITIES / TAKEN
 *
 * Pure: hosts pass a policy + `t`, get back `[{id, labelKey, label}]`
 * in render order.  GESPREK is always the first tab so users always
 * have a chat surface even when the admin turned the chat feature
 * off via an explicit policy edit (the chat axis is documented as a
 * core right in v2 §1, not an opt-in feature).
 */

import { isFeatureEnabled } from './circlePolicy.js';

/** Canonical tab id ↔ feature key ↔ locale-key triples, in render order. */
const TAB_DEFS = [
  { id: 'gesprek',  feature: 'chat',            labelKey: 'circle.tabs.gesprek'  },
  { id: 'prikbord', feature: 'noticeboard',     labelKey: 'circle.tabs.prikbord' },
  { id: 'taken',    feature: 'tasks',           labelKey: 'circle.tabs.taken'    },
  { id: 'lijsten',  feature: 'lists',           labelKey: 'circle.tabs.lijsten'  },
  { id: 'notities', feature: 'notes',           labelKey: 'circle.tabs.notities' },
  { id: 'agenda',   feature: 'calendar',        labelKey: 'circle.tabs.agenda'   },
  { id: 'leden',    feature: 'memberDirectory', labelKey: 'circle.tabs.leden'    },
];

/**
 * Build the ordered tab list for a circle.
 *
 * @param {object|null} policy
 * @param {function}    [t]   host translator; when omitted the entries
 *                            carry only `labelKey` (host can resolve later).
 * @returns {Array<{id:string, feature:string, labelKey:string, label?:string}>}
 */
export function buildCircleTabs(policy, t) {
  const tr = typeof t === 'function' ? t : null;
  const out = [];
  for (const def of TAB_DEFS) {
    // GESPREK always renders (chat is the circle's core surface even
    // when the chat feature flag was explicitly turned off).
    const on = def.id === 'gesprek' ? true : isFeatureEnabled(policy, def.feature);
    if (!on) continue;
    out.push({
      id:       def.id,
      feature:  def.feature,
      labelKey: def.labelKey,
      ...(tr ? { label: tr(def.labelKey) } : {}),
    });
  }
  return out;
}

/** Always-safe default tab id (GESPREK). */
export const DEFAULT_CIRCLE_TAB = 'gesprek';

// D1 (§5A) — feature key → locale key for the quickActions pill labels.
// Covers all 8 CIRCLE_FEATURES; the 7 tab features reuse their tab label,
// and the two non-tab features (houseRules, memberDirectory) borrow their
// Settings labels.  `featureActionLabelKey(feature)` falls back to the
// raw key so an unknown feature still renders something.
const FEATURE_LABEL_KEYS = Object.freeze({
  chat:            'circle.tabs.gesprek',
  noticeboard:     'circle.tabs.prikbord',
  tasks:           'circle.tabs.taken',
  lists:           'circle.tabs.lijsten',
  notes:           'circle.tabs.notities',
  calendar:        'circle.tabs.agenda',
  memberDirectory: 'circle.tabs.leden',
  houseRules:      'circle.settings.feat.houseRules',
});

/** D1 — locale key for a feature's quickActions pill label (raw key if unknown). */
export function featureActionLabelKey(feature) {
  return FEATURE_LABEL_KEYS[feature] ?? feature;
}

// D1 — feature key → circle tab id, for hosts wiring a pill tap to a tab
// switch.  Features without a tab (houseRules) map to `null` so the host
// can route them elsewhere (e.g. open the rules panel).
const FEATURE_TAB_IDS = Object.freeze(
  Object.fromEntries(TAB_DEFS.map((d) => [d.feature, d.id])),
);

/** D1 — circle tab id for a feature, or `null` when the feature has no tab. */
export function featureTabId(feature) {
  return FEATURE_TAB_IDS[feature] ?? null;
}

const TAB_ID_TO_FEATURE = Object.freeze(
  Object.fromEntries(TAB_DEFS.map((d) => [d.id, d.feature])),
);

/** D1 — feature key for a circle tab id, or `null` when unknown. */
export function featureForTabId(tabId) {
  return TAB_ID_TO_FEATURE[tabId] ?? null;
}
