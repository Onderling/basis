/**
 * The app binds its agent before a sealed circle's producer can exist: the agent's per-circle sealing key pair (a pure
 * derivation, the same pair for a circle every time) is what the producer opens with. Tests that build circle
 * producers without an agent bind a stand-in derivation the same way (`setCircleKeyEventWiring`).
 */
import { generateKeypair } from '@onderling/pod-client';
import { setCircleKeyEventWiring } from '../../src/core/circlePods.js';

const pairs = new Map();

/** The same sealing key pair for a circle every time (as the agent's derivation is). */
export function circleKeyPairFor(circleId) {
  if (!pairs.has(circleId)) pairs.set(circleId, generateKeypair());
  return pairs.get(circleId);
}

/** Bind the stand-in derivation (plus any other wiring the test needs), as boot binds the agent's. */
export function bindCircleKeyPairs(extra = {}) {
  setCircleKeyEventWiring({ circleSealingKeyPairFor: circleKeyPairFor, ...extra });
}
