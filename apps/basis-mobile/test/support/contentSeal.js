/**
 * A device content key for tests that build a local store directly.
 *
 * Every local store now seals at rest, and the key is published by the agent at boot
 * (`setShellContentSeal`). A test that constructs a circle pod or a versions adapter WITHOUT booting an
 * agent is composing something the app never composes: a real device always has this key by the time any
 * circle is opened. Rather than let those tests write in the clear — which would quietly re-open the hole
 * this closes, and only in the tests that look most like the product — they announce the key here.
 *
 * The strategy is the real one (`groupKeyStrategy`, the same `fp1:` envelope the app writes), so what a
 * test stores is sealed exactly as it would be on a phone.
 */
import { groupKeyStrategy } from '@onderling/pod-client';
import { setShellContentSeal } from '../../../basis/src/v2/localStoreSeal.js';

/** Publish a deterministic test content key. Call once, at the top of a test file. */
export function useTestContentSeal() {
  const key = 'A'.repeat(43);   // 32 bytes of b64url — fixed, so a failure reproduces
  setShellContentSeal(groupKeyStrategy({ groupKey: key }));
}
