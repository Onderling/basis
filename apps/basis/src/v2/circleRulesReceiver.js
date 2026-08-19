/**
 * basis v2 — circle rules-broadcast receiver substrate (γ-next.rules).
 *
 * Thin instantiation of the shared circle-kind receiver factory
 * (`circleKindFactory.js`).  Caches the incoming rules doc in a per-circle
 * "pending" cache; the rules editor reads on mount and passes it via γ.4's
 * conflict resolver (`incomingRules` opt).  Hosts register the handler on
 * the peer-router under subtype `'circle-rules-broadcast'`.
 *
 * Behaviour (envelope validation, msgId LRU dedup, last-write-wins cache)
 * is identical across the policy/rules/recipe triplet; only the descriptor
 * below differs.
 */

import { makeCircleKindReceiver } from './circleKindFactory.js';

export const makeCircleRulesPeerHandler = makeCircleKindReceiver({
  subtype:    'circle-rules-broadcast',
  payloadKey: 'rulesDoc',
  logTag:     '[circle-rules]',
});
