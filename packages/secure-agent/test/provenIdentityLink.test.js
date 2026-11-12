/**
 * THE IDENTITY LINK HAS TWO STRENGTHS. An alias address is bound to a person's key whenever a roster row names the two
 * side by side (that is what makes it sealable), proof or no proof: a legacy row carries a per-circle address without
 * the person's signature over it. Reading "who is this" for SENDING may use every binding; a decision that lets a
 * send leave on the person key because the address is a CONTACT's other device may use only a binding the person
 * PROVED (the circle-link signature, checked before the row was written). `provenPubKeyForAddr` is that read.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createSecureAgent } from '../src/createSecureAgent.js';

const agent = () => createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false });

describe('the identity link: every binding for sealing, only proven ones for "is this my contact"', () => {
  it('an unproven binding resolves for the seal but not as proven; a proven one resolves both ways', async () => {
    const a = await agent();
    expect(a.registerPeerAddress('addr-unproven', 'bob-key')).toBe(true);
    expect(a.registerPeerAddress('addr-proven', 'bob-key', { proven: true })).toBe(true);
    expect(a.resolver.pubKeyForAddr('addr-unproven')).toBe('bob-key');
    expect(a.resolver.provenPubKeyForAddr('addr-unproven')).toBe(null);
    expect(a.resolver.provenPubKeyForAddr('addr-proven')).toBe('bob-key');
    // no fallback to the crypto layer or a host hook: only the proven link answers
    expect(a.resolver.provenPubKeyForAddr('never-bound')).toBe(null);
  });
  it('a later unproven binding of the same address does not keep an old proof; forgetting drops it', async () => {
    const a = await agent();
    a.registerPeerAddress('addr', 'bob-key', { proven: true });
    a.registerPeerAddress('addr', 'mallory-key');
    expect(a.resolver.provenPubKeyForAddr('addr')).toBe(null);
    a.registerPeerAddress('addr', 'bob-key', { proven: true });
    a.forgetPeerAddress('addr');
    expect(a.resolver.provenPubKeyForAddr('addr')).toBe(null);
  });
});
