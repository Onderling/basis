/**
 * basis v2 — per-circle pending-policy cache (γ-next.policy).
 *
 * Thin re-export of the shared circle-kind pending store
 * (`circleKindFactory.js`).  Stashes ONE pending incoming policy doc per
 * circle; the policy receiver writes on every valid broadcast, the
 * settings editor reads on mount (via γ.4's `incomingPolicy` opt) and
 * clears the slot after apply/discard.  Storage IO is injected
 * (`load`/`save`/`remove`) — see `circlePolicyPendingStorage.js`.  Store
 * behaviour is identical across the policy/rules/recipe triplet (the doc
 * is treated opaquely), so it lives once in the factory.
 */

export { createCircleKindPendingStore as createCirclePolicyPendingStore } from './circleKindFactory.js';
