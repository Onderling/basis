/**
 * basis v2 — per-circle pending-rules cache (γ-next.rules).
 *
 * Thin re-export of the shared circle-kind pending store
 * (`circleKindFactory.js`).  Stashes ONE pending incoming rules doc per
 * circle; the rules receiver writes on every valid broadcast, the rules
 * editor reads on mount (via γ.4's `incomingRules` opt) and clears the
 * slot after apply/discard.  Storage IO is injected — see
 * `circleRulesPendingStorage.js`.  Store behaviour is identical across the
 * policy/rules/recipe triplet, so it lives once in the factory.
 */

export { createCircleKindPendingStore as createCircleRulesPendingStore } from './circleKindFactory.js';
