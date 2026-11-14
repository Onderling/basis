// Cross-circle link proof — "continue as an existing self" must be PROVABLE, not asserted.
// A joiner signs a challenge with the source circle's identity; the admin verifies it
// against the presented per-circle address. A co-member who only knows the address (no
// private key) cannot forge it, and a proof for one circle can't be replayed to another.
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { Bootstrap } from '../../src/identity/Bootstrap.js';
import { AgentIdentity } from '../../src/identity/AgentIdentity.js';
import { deriveCircleAddress, circleIdentity } from '../../src/identity/circleAddress.js';
import { circleLinkMessage, signCircleLink, signCircleLinkFromSeed, verifyCircleLink, onEarlierCircleLink } from '../../src/identity/circleLink.js';

const ME = 'webid:me';
const seedFor = (name) => Bootstrap.fromMnemonic(Bootstrap.create().mnemonic).deriveAgentSeed(name);

describe('circle link proof', () => {
  it('a proof signed by the source circle identity verifies against its address', async () => {
    const s = seedFor('me');
    const sourceId = await circleIdentity(s, 'circle-42', new VaultMemory());
    const address = deriveCircleAddress(s, 'circle-42');       // my existing self in circle-42
    const proof = signCircleLink(sourceId, 'werk-7', address, ME); // joining werk-7 as that self
    expect(verifyCircleLink({ groupId: 'werk-7', address, memberRef: ME, proof })).toBe(true);
  });

  it('a co-member who only knows the ADDRESS (no key) cannot forge a proof', async () => {
    const s = seedFor('me');
    const address = deriveCircleAddress(s, 'circle-42');
    // an attacker signs with a DIFFERENT key but presents the victim's address
    const attackerId = await circleIdentity(seedFor('attacker'), 'circle-42', new VaultMemory());
    const forged = signCircleLink(attackerId, 'werk-7', address, ME);
    expect(verifyCircleLink({ groupId: 'werk-7', address, memberRef: ME, proof: forged })).toBe(false);
  });

  it('a proof for one circle cannot be replayed to join another (bound to groupId)', async () => {
    const s = seedFor('me');
    const sourceId = await circleIdentity(s, 'circle-42', new VaultMemory());
    const address = deriveCircleAddress(s, 'circle-42');
    const proof = signCircleLink(sourceId, 'werk-7', address, ME);
    expect(verifyCircleLink({ groupId: 'anders-9', address, memberRef: ME, proof })).toBe(false);
  });

  it('signCircleLinkFromSeed (vault-free) verifies against the seed-derived address — the host seam', () => {
    const s = seedFor('me');
    const address = deriveCircleAddress(s, 'circle-42');
    const proof = signCircleLinkFromSeed(s, 'circle-42', 'werk-7', address, ME);   // sign source=circle-42, join=werk-7
    expect(verifyCircleLink({ groupId: 'werk-7', address, memberRef: ME, proof })).toBe(true);
    expect(verifyCircleLink({ groupId: 'other', address, memberRef: ME, proof })).toBe(false);
  });

  it('deny-by-default: missing/malformed inputs verify false', () => {
    expect(verifyCircleLink({ groupId: 'g', address: 'a', proof: '' })).toBe(false);
    expect(verifyCircleLink({ groupId: 'g', address: '', proof: 'p' })).toBe(false);
    expect(verifyCircleLink({})).toBe(false);
    expect(verifyCircleLink({ groupId: 'g', address: 'not-a-real-pubkey', proof: 'not-a-sig' })).toBe(false);
  });

  it('the challenge is deterministic and binds join + address + member', () => {
    expect(circleLinkMessage('werk-7', 'ADDR', 'M')).toBe('onderling-circle-link-v2|werk-7|ADDR|M');
    expect(circleLinkMessage('werk-7', 'ADDR', 'M')).not.toBe(circleLinkMessage('anders-9', 'ADDR', 'M'));
    expect(circleLinkMessage('werk-7', 'ADDR', 'M')).not.toBe(circleLinkMessage('werk-7', 'ADDR', 'N'));
  });

  it('a COPIED proof does not verify for another member: the proof names the member whose address it is', async () => {
    const s = seedFor('me');
    const sourceId = await circleIdentity(s, 'circle-42', new VaultMemory());
    const address = deriveCircleAddress(s, 'circle-42');
    const proof = signCircleLink(sourceId, 'werk-7', address, ME);
    expect(verifyCircleLink({ groupId: 'werk-7', address, memberRef: ME, proof })).toBe(true);
    expect(verifyCircleLink({ groupId: 'werk-7', address, memberRef: 'webid:copier', proof })).toBe(false);
    expect(verifyCircleLink({ groupId: 'werk-7', address, proof }), 'no member, no pass').toBe(false);
  });

  it('the earlier proof (circle + address, no member) is refused', async () => {
    const s = seedFor('me');
    const sourceId = await circleIdentity(s, 'circle-42', new VaultMemory());
    const address = deriveCircleAddress(s, 'circle-42');
    const { encode } = await import('../../src/crypto/b64.js');
    const v1 = encode(sourceId.sign(`onderling-circle-link-v1|werk-7|${address}`));
    expect(verifyCircleLink({ groupId: 'werk-7', address, memberRef: ME, proof: v1 })).toBe(false);
  });

  it('a refused earlier proof is reported to the listener; a forged one is not', async () => {
    const s = seedFor('me');
    const sourceId = await circleIdentity(s, 'circle-42', new VaultMemory());
    const address = deriveCircleAddress(s, 'circle-42');
    const { encode } = await import('../../src/crypto/b64.js');
    const v1 = encode(sourceId.sign(`onderling-circle-link-v1|werk-7|${address}`));
    let heard = 0;
    onEarlierCircleLink(() => { heard += 1; });
    try {
      expect(verifyCircleLink({ groupId: 'werk-7', address, memberRef: ME, proof: v1 })).toBe(false);
      expect(heard).toBe(1);
      const attackerId = await circleIdentity(seedFor('attacker'), 'circle-42', new VaultMemory());
      const forged = encode(attackerId.sign(`onderling-circle-link-v1|werk-7|${address}`));
      expect(verifyCircleLink({ groupId: 'werk-7', address, memberRef: ME, proof: forged })).toBe(false);
      expect(heard, 'a forged proof is not an earlier one').toBe(1);
    } finally { onEarlierCircleLink(null); }
  });

  it('the same earlier proof asked again: one check of the earlier message, one report', async () => {
    const s = seedFor('me');
    const sourceId = await circleIdentity(s, 'circle-42', new VaultMemory());
    const address = deriveCircleAddress(s, 'circle-42');
    const { encode } = await import('../../src/crypto/b64.js');
    const v1 = encode(sourceId.sign(`onderling-circle-link-v1|werk-8|${address}`));
    const asked = [];
    const verifySignature = (msg, sig, key) => { asked.push(msg); return AgentIdentity.verify(msg, sig, key); };
    let heard = 0;
    onEarlierCircleLink(() => { heard += 1; });
    try {
      for (let i = 0; i < 3; i++) expect(verifyCircleLink({ groupId: 'werk-8', address, memberRef: ME, proof: v1, verifySignature })).toBe(false);
      expect(asked.filter((m) => m.startsWith('onderling-circle-link-v1|')), 'the earlier message checked once').toHaveLength(1);
      expect(heard).toBe(1);
    } finally { onEarlierCircleLink(null); }
  });

  it('signing without a member throws: no proof can be minted that names nobody', async () => {
    const s = seedFor('me');
    const sourceId = await circleIdentity(s, 'circle-42', new VaultMemory());
    const address = deriveCircleAddress(s, 'circle-42');
    expect(() => signCircleLink(sourceId, 'werk-7', address)).toThrow();
    expect(() => signCircleLinkFromSeed(s, 'circle-42', 'werk-7', address)).toThrow();
  });
});
