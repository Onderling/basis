/**
 * basis v2 — per-circle pending-recipe cache (γ-next.recipe).
 *
 * Thin re-export of the shared circle-kind pending store
 * (`circleKindFactory.js`).  Stashes ONE pending incoming recipe per
 * circle; the recipe receiver writes on every valid broadcast, the recipe
 * editor reads on mount (via γ.3's `incomingRecipe` opt) and clears the
 * slot after apply/discard.  Storage IO is injected — see
 * `circleRecipePendingStorage.js`.  Store behaviour is identical across the
 * policy/rules/recipe triplet, so it lives once in the factory.
 */

export { createCircleKindPendingStore as createCircleRecipePendingStore } from './circleKindFactory.js';
