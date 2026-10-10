// A device's internal id needs no secrecy any more (its wire id is keyed by a separate secret salt), but it MUST be
// unique: two devices holding one id derive one seed, so one key set lives on two devices and neither can be retired
// alone. So an enrolment without a cryptographic random source is refused, never guessed at with Math.random.
import { describe, it, expect } from 'vitest';
import { newDeviceId } from '../src/core/agent/ownerRootRestore.js';

describe('the internal device id is minted from a CSPRNG, or not at all', () => {
  it('uses randomUUID when there is one, getRandomValues otherwise', () => {
    expect(newDeviceId({ crypto: { randomUUID: () => 'c7e1f0a2-5b9d-4e3a-8f61-2d4c9b7a1e05' } })).toBe('c7e1f0a2-5b9d-4e3a-8f61-2d4c9b7a1e05');
    const id = newDeviceId({ crypto: { getRandomValues: (b) => { b.fill(171); return b; } } });
    expect(id).toBe('ab'.repeat(16));
  });
  it('refuses when the platform offers no cryptographic random source', () => {
    expect(() => newDeviceId({ crypto: null })).toThrow(/random/);
    expect(() => newDeviceId({ crypto: {} })).toThrow(/random/);
  });
});
