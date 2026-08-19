/**
 * basis v2 — circle recipe-broadcast receiver substrate (γ-next.recipe).
 *
 * Thin instantiation of the shared circle-kind receiver factory
 * (`circleKindFactory.js`).  Caches the incoming recipe in a per-circle
 * "pending" cache; the recipe editor reads on mount and passes it to γ.3's
 * conflict resolver (`incomingRecipe` opt).  Hosts register the handler on
 * the peer-router under subtype `'circle-recipe-broadcast'`.
 *
 * Behaviour (envelope validation, msgId LRU dedup, last-write-wins cache)
 * is identical across the policy/rules/recipe triplet; only the descriptor
 * below differs.
 */

import { makeCircleKindReceiver } from './circleKindFactory.js';

export const makeCircleRecipePeerHandler = makeCircleKindReceiver({
  subtype:    'circle-recipe-broadcast',
  payloadKey: 'recipe',
  logTag:     '[circle-recipe]',
});
