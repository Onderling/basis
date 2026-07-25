// Cross-circle link proof — "continue as an existing self" must be PROVABLE, not asserted.
// A joiner signs a challenge with the source circle's identity; the admin verifies it
// against the presented per-circle address. A co-member who only knows the address (no
// private key) cannot forge it, and a proof for one circle can't be replayed to another.
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { Bootstrap } from '../../src/identity/Bootstrap.js';
import { deriveCircleAddress, circleIdentity } from '../../src/identity/circleAddress.js';
import { circleLinkMessage, signCircleLink, signCircleLinkFromSeed, verifyCircleLink } from '../../src/identity/circleLink.js';

const seedFor = (name) => Bootstrap.fromMnemonic(Bootstrap.create().mnemonic).deriveAgentSeed(name);

describe('circle link proof', () => {
  it('a proof signed by the source circle identity verifies against its address', async () => {
    const s = seedFor('me');
    const sourceId = await circleIdentity(s, 'buurt-42', new VaultMemory());
    const address = deriveCircleAddress(s, 'buurt-42');       // my existing self in buurt-42
    const proof = signCircleLink(sourceId, 'werk-7', address); // joining werk-7 as that self
    expect(verifyCircleLink({ groupId: 'werk-7', address, proof })).toBe(true);
  });

  it('a co-member who only knows the ADDRESS (no key) cannot forge a proof', async () => {
    const s = seedFor('me');
    const address = deriveCircleAddress(s, 'buurt-42');
    // an attacker signs with a DIFFERENT key but presents the victim's address
    const attackerId = await circleIdentity(seedFor('attacker'), 'buurt-42', new VaultMemory());
    const forged = signCircleLink(attackerId, 'werk-7', address);
    expect(verifyCircleLink({ groupId: 'werk-7', address, proof: forged })).toBe(false);
  });

  it('a proof for one circle cannot be replayed to join another (bound to groupId)', async () => {
    const s = seedFor('me');
    const sourceId = await circleIdentity(s, 'buurt-42', new VaultMemory());
    const address = deriveCircleAddress(s, 'buurt-42');
    const proof = signCircleLink(sourceId, 'werk-7', address);
    expect(verifyCircleLink({ groupId: 'anders-9', address, proof })).toBe(false);
  });

  it('signCircleLinkFromSeed (vault-free) verifies against the seed-derived address — the host seam', () => {
    const s = seedFor('me');
    const address = deriveCircleAddress(s, 'buurt-42');
    const proof = signCircleLinkFromSeed(s, 'buurt-42', 'werk-7', address);   // sign source=buurt-42, join=werk-7
    expect(verifyCircleLink({ groupId: 'werk-7', address, proof })).toBe(true);
    expect(verifyCircleLink({ groupId: 'other', address, proof })).toBe(false);
  });

  it('deny-by-default: missing/malformed inputs verify false', () => {
    expect(verifyCircleLink({ groupId: 'g', address: 'a', proof: '' })).toBe(false);
    expect(verifyCircleLink({ groupId: 'g', address: '', proof: 'p' })).toBe(false);
    expect(verifyCircleLink({})).toBe(false);
    expect(verifyCircleLink({ groupId: 'g', address: 'not-a-real-pubkey', proof: 'not-a-sig' })).toBe(false);
  });

  it('the challenge is deterministic and binds join + address', () => {
    expect(circleLinkMessage('werk-7', 'ADDR')).toBe('canopy-circle-link-v1|werk-7|ADDR');
    expect(circleLinkMessage('werk-7', 'ADDR')).not.toBe(circleLinkMessage('anders-9', 'ADDR'));
  });
});
