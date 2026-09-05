// Per-circle privacy state — the model behind the privacy indicator (property-layer §10c;
// plans/NOTE-property-layer-design.md). Computes a DISCRETE state (NOT a gradient/score — privacy isn't
// one-dimensional) from the participant's disclosure in a circle + the warning heuristic + the warnings-on
// setting. Pure. The shell renders an icon/affordance from this; tapping opens the why/fix (the guided flow).
//
// Design rules baked in (§10c): discrete states · the ⚠ is EARNED (only a real risk) · no "green = safe"
// (the calm state is neutral; the signal is the ⚠ APPEARING) · indicator ≠ protection (this only reports).
import { consentWarning, enabledConsentKeys } from './charterConsent.js';

/**
 * @param {object} a
 * @param {object} [a.consent]      the participant's charter consent (from charterConsent.emptyConsent + edits)
 * @param {object} [a.charter]      the project's charter (null ⇒ no per-circle privacy state → not applicable)
 * @param {boolean} [a.warningsOn]  the user's warnings toggle (default on; §10b)
 * @param {number} [a.n]            approximate cohort size (§10b) — enables the identifiability trigger
 * @returns {{applicable:boolean, level:'quiet'|'sharing'|'risk', shared:string[], warn:boolean, reason:?string}}
 */
// Shared badge presentation for the per-circle indicator (§10c) — ONE source for BOTH shells (invariant #3).
// Icon carries the meaning (accessible); label localised nl/en. Colours are platform styling → stay per-shell.
const PRIVACY_BADGE = {
  nl: { quiet: 'Privacy: rustig', sharing: 'Privacy: je deelt', risk: 'Privacy: ⚠ risico' },
  en: { quiet: 'Privacy: quiet',  sharing: 'Privacy: sharing',  risk: 'Privacy: ⚠ risk' },
};
export function privacyBadge(level, lang) {
  const L = PRIVACY_BADGE[lang === 'nl' ? 'nl' : 'en'];
  return { level, icon: level === 'risk' ? '⚠️' : '🛡', label: L[level] || L.quiet };
}

export function circlePrivacyState({ consent, charter, warningsMode = 'normal', n } = {}) {
  if (!charter) return { applicable: false, level: 'quiet', shared: [], warn: false, reason: null };
  const shared = consent ? enabledConsentKeys(consent, charter) : [];
  const on = warningsMode !== 'off';   // §10b graduated setting: 'normal' | 'minimal' | 'off'
  // Identifiability risk (needs n) — only when warnings aren't off; graduated by mode ('minimal' = stricter bar).
  const heuristic = on && consent ? consentWarning(consent, charter, n, warningsMode) : { warn: false };
  // Structural risk: warnings OFF while still sharing → the "angry, regret later" case (§10c).
  const structuralRisk = !on && shared.length > 0;
  const risk = heuristic.warn || structuralRisk;
  return {
    applicable: true,   // a charter applies → the indicator is meaningful for this circle
    level: risk ? 'risk' : (shared.length ? 'sharing' : 'quiet'),
    shared,
    warn: risk,
    reason: heuristic.warn ? 'combo-identifiable' : (structuralRisk ? 'warnings-off' : null),
  };
}
