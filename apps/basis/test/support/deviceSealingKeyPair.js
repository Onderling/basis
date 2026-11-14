/**
 * A device's per-circle sealing key pair, for tests that build a circle producer without an agent.
 *
 * The shells hand every sealed producer the agent's `circleSealingKeyPairFor(circleId)`: a pure derivation, so the
 * same device gets the same pair for a circle on every boot. This stands in for that derivation — stable per
 * (device, circle) for the life of the test process — so a "restart" test still re-opens with the same key.
 */
import { generateKeypair } from '@onderling/pod-client';
import { createCirclePodProducer } from '../../src/v2/circlePodProducer.js';

const pairs = new Map();

/** The same key pair for the same device and circle, every time it is asked. */
export function sealingPairFor(circleId, device = 'self') {
  const k = `${device}\u0000${circleId}`;
  if (!pairs.has(k)) pairs.set(k, generateKeypair());
  return pairs.get(k);
}

/** createCirclePodProducer with this device's key pair handed in, as a shell hands the agent's. */
export function produceWithPair(opts = {}, device = 'self') {
  return createCirclePodProducer({ sealingKeyPair: sealingPairFor(opts.circleId, device), ...opts });
}
