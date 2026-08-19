/**
 * The primitive under proof of possession (DESIGN-boundary-authentication §7, Decision 3).
 *
 * The relay and `RelayTransport` tests prove the protocol end to end. This proves the thing they
 * both stand on, and in particular the property that makes it NOT `circleLink.js`: the message is
 * bound to a nonce, so a captured signature is worth nothing anywhere else.
 */
import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import {
  addressPossessionMessage, signAddressPossession, signAddressPossessionFromSeed,
  circleAddressSigner, verifyAddressPossession, newAddressChallenge, ADDRESS_CHALLENGE_TTL_MS,
} from '../../src/identity/addressPossession.js';
import { circleLinkMessage } from '../../src/identity/circleLink.js';
import { AgentIdentity } from '../../src/identity/AgentIdentity.js';
import { deriveCircleAddress } from '../../src/identity/circleAddress.js';
import { VaultMemory } from '@onderling/vault';

const seed = (fill) => new Uint8Array(32).fill(fill);

describe('addressPossession — an address is a public key, so possession is one signature', () => {
  it('verifies a proof against the ADDRESS itself — no lookup, nothing to substitute', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const nonce = newAddressChallenge();
    const proof = signAddressPossession(identity, identity.pubKey, nonce);
    expect(verifyAddressPossession({ address: identity.pubKey, nonce, proof })).toBe(true);
  });

  it('refuses a proof signed by a different key — the impersonation case', async () => {
    const [mine, theirs] = await Promise.all([
      AgentIdentity.generate(new VaultMemory()),
      AgentIdentity.generate(new VaultMemory()),
    ]);
    const nonce = newAddressChallenge();
    // Someone else signs over MY address: the closest an attacker gets without my private key.
    const proof = signAddressPossession(theirs, mine.pubKey, nonce);
    expect(verifyAddressPossession({ address: mine.pubKey, nonce, proof })).toBe(false);
  });

  it('binds the nonce — THE reason this is not circleLink', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const a = newAddressChallenge();
    const b = newAddressChallenge();
    const proof = signAddressPossession(identity, identity.pubKey, a);

    expect(verifyAddressPossession({ address: identity.pubKey, nonce: a, proof })).toBe(true);
    // The same proof against ANY other challenge is worthless — which is what makes a captured
    // registration useless at another relay and at another time.
    expect(verifyAddressPossession({ address: identity.pubKey, nonce: b, proof })).toBe(false);

    // …and the message really is a different one from circleLink's deliberately static message, so
    // a signature made for a circle link can never double as a registration proof.
    expect(addressPossessionMessage(identity.pubKey, a))
      .not.toBe(circleLinkMessage('some-circle', identity.pubKey));
  });

  it('binds the address — a live proof cannot be lifted onto another one', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const other = await AgentIdentity.generate(new VaultMemory());
    const nonce = newAddressChallenge();
    const proof = signAddressPossession(identity, identity.pubKey, nonce);
    expect(verifyAddressPossession({ address: other.pubKey, nonce, proof })).toBe(false);
  });

  it('is deny-by-default: anything missing or malformed is false, never a throw', () => {
    for (const bad of [
      undefined, {},
      { address: 'a', nonce: 'n' },
      { address: 'a', nonce: 'n', proof: '' },
      { address: '', nonce: 'n', proof: 'p' },
      { address: 'a', nonce: '', proof: 'p' },
      { address: 'not-a-key', nonce: 'n', proof: 'not-a-signature' },
      { address: 42, nonce: 'n', proof: 'p' },
    ]) {
      expect(verifyAddressPossession(bad)).toBe(false);
    }
  });

  it('a challenge is fresh, opaque and long enough not to be guessed', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(newAddressChallenge());
    expect(seen.size).toBe(200);
    // 32 bytes of randomness, base64url — no structure a client could predict or a relay reuse.
    for (const nonce of seen) expect(nonce.length).toBeGreaterThanOrEqual(42);
    // The TTL is short enough that a nonce is not a lasting object; single-use does the real work.
    expect(ADDRESS_CHALLENGE_TTL_MS).toBeLessThanOrEqual(60_000);
  });
});

describe('the per-circle, vault-free path — what makes N aliases as cheap as one', () => {
  it('signs for a derived circle address, and verifies against that address', () => {
    const profileSeed = seed(7);
    const address = deriveCircleAddress(profileSeed, 'circle');
    const nonce = newAddressChallenge();
    const proof = signAddressPossessionFromSeed(profileSeed, 'circle', address, nonce);
    expect(verifyAddressPossession({ address, nonce, proof })).toBe(true);
  });

  it('a signer for circle X cannot prove circle Y — a different key per circle, as designed', () => {
    const profileSeed = seed(7);
    const x = deriveCircleAddress(profileSeed, 'circle-x');
    const nonce = newAddressChallenge();
    const wrong = signAddressPossessionFromSeed(profileSeed, 'circle-y', x, nonce);
    expect(verifyAddressPossession({ address: x, nonce, proof: wrong })).toBe(false);
  });

  it('`circleAddressSigner` is the same key in the shape `addAddress({ sign })` wants', () => {
    const profileSeed = seed(3);
    const address = deriveCircleAddress(profileSeed, 'circle-x');
    const nonce = newAddressChallenge();
    const sign = circleAddressSigner(profileSeed, 'circle-x');
    expect(sign(addressPossessionMessage(address, nonce)))
      .toBe(signAddressPossessionFromSeed(profileSeed, 'circle-x', address, nonce));
  });

  it('needs no vault — the point of deriving from the profile seed', () => {
    // No vault, no async, no identity object: a device registering ten circles signs ten challenges
    // without ten vault round-trips.
    expect(() => circleAddressSigner(seed(1), 'c')('anything')).not.toThrow();
  });

  it('the proof is an ordinary Ed25519 signature over the canonical message — no custom crypto', () => {
    const profileSeed = seed(9);
    const address = deriveCircleAddress(profileSeed, 'circle-x');
    const nonce = 'n-1';
    const proof = signAddressPossessionFromSeed(profileSeed, 'circle-x', address, nonce);
    // Verified by hand against the address, the way any third party could.
    expect(AgentIdentity.verify(addressPossessionMessage(address, nonce), proof, address)).toBe(true);
    expect(nacl.sign.signatureLength).toBe(64);
  });
});
