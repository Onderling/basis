/**
 * The app half of Decision 4 — installing this device's per-circle signing identities, and binding
 * each member's per-circle address to the key that actually signs there.
 *
 * Two separate things, one bug class between them: if the INSTALL is missed, this device cannot open
 * what was sent to its own per-circle address; if the BINDING uses the person's global key instead of
 * the circle's, every envelope a member sends in the circle fails verification. Both fail silently at
 * the crypto layer, which is why each has a test that names it.
 */
import { describe, it, expect, vi } from 'vitest';
import { deriveCircleAddress, circleIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import nacl from 'tweetnacl';
import {
  useCircleSigningIdentity, installCircleSigningIdentities,
} from '../../src/v2/circleSigningIdentity.js';
import {
  bindCircleAddressKeys, forgetCircleAddressKeys, circleSigningKeyOf,
} from '../../src/v2/circleAddressKeys.js';

const seed = () => new Uint8Array(nacl.randomBytes(32));

/** The seams a host passes: an address per circle, an identity per circle, and somewhere to put it. */
function host(profileSeed = seed()) {
  const installed = new Map();
  return {
    profileSeed,
    installed,
    circleAddressFor: (cid) => deriveCircleAddress(profileSeed, cid),
    circleIdentityFor: (cid) => circleIdentity(profileSeed, cid, new VaultMemory()),
    registerSelfIdentity: (address, identity) => { installed.set(address, identity); return true; },
  };
}

describe('installing a per-circle signing identity', () => {
  it('installs the identity under the address the circle is addressed at', async () => {
    const h = host();
    const address = await useCircleSigningIdentity({ circleId: 'buurt-42', ...h });
    expect(address).toBe(h.circleAddressFor('buurt-42'));
    expect(h.installed.get(address).pubKey).toBe(
      (await circleIdentity(h.profileSeed, 'buurt-42', new VaultMemory())).pubKey,
    );
  });

  it('installs one per circle, and reports the ones it could not', async () => {
    const h = host();
    const broken = { ...h, circleIdentityFor: (cid) => (cid === 'bad' ? Promise.reject(new Error('x')) : h.circleIdentityFor(cid)) };
    const onFailed = vi.fn();
    const r = await installCircleSigningIdentities({
      circleIds: ['buurt-42', 'bad', 'werk-7'], ...broken, onFailed,
    });
    expect(r.installed).toEqual(['buurt-42', 'werk-7']);
    expect(r.failed).toEqual(['bad']);
    expect(onFailed).toHaveBeenCalledWith('bad');
    // The point of best-effort: one broken circle does not cost the others their identity.
    expect(h.installed.size).toBe(2);
  });

  it('is null-safe rather than throwing, so a host without the seams degrades visibly', async () => {
    expect(await useCircleSigningIdentity({ circleId: 'buurt-42' })).toBeNull();
    expect(await useCircleSigningIdentity({ ...host() })).toBeNull();          // no circleId
    const r = await installCircleSigningIdentities({ circleIds: ['a'] });
    expect(r).toEqual({ installed: [], failed: ['a'] });
  });

  it('never assumes the address IS the key — it asks for both (the L2 seam)', async () => {
    // A host whose signing key is unrelated to its address (the two-derivation answer) installs
    // exactly the same way. Nothing here has to change if Frits answers "two".
    const detachedKey = { pubKey: 'a-key-unrelated-to-the-address', sign: () => {}, box: () => {} };
    const installed = new Map();
    const address = await useCircleSigningIdentity({
      circleId: 'buurt-42',
      circleAddressFor: () => 'the-address',
      circleIdentityFor: () => detachedKey,
      registerSelfIdentity: (a, id) => { installed.set(a, id); return true; },
    });
    expect(address).toBe('the-address');
    expect(installed.get('the-address')).toBe(detachedKey);
  });
});

describe('binding a member’s per-circle address to the key that signs there', () => {
  const memberSeed = seed();
  const member = {
    webid: 'webid:anna',
    pubKey: 'ANNAS-GLOBAL-IDENTITY-KEY',
    circleAddress: deriveCircleAddress(memberSeed, 'buurt-42'),
  };

  it('binds the CIRCLE signing key for the crypto, and the person for everything else', () => {
    const calls = [];
    const r = bindCircleAddressKeys({
      members: [member], registerPeerAddress: (...a) => calls.push(a),
    });
    expect(r).toEqual({ bound: 1, skipped: 0 });
    expect(calls[0][0]).toBe(member.circleAddress);
    expect(calls[0][1], 'the person is still named').toBe(member.pubKey);
    expect(calls[0][2], 'and the key that signs at that address is the circle one')
      .toEqual({ signingKey: member.circleAddress });
  });

  it('the signing key is the address today, and an explicit one wins (the L2 seam)', () => {
    expect(circleSigningKeyOf(member)).toBe(member.circleAddress);
    expect(circleSigningKeyOf({ ...member, circleSigningKey: 'A-SEPARATE-SIGNING-KEY' }))
      .toBe('A-SEPARATE-SIGNING-KEY');
    expect(circleSigningKeyOf({})).toBeNull();
  });

  it('still skips my own row and rows missing either half', () => {
    const calls = [];
    const r = bindCircleAddressKeys({
      members: [member, { pubKey: 'x' }, { circleAddress: 'y' }, member],
      registerPeerAddress: (...a) => calls.push(a),
      selfPubKey: member.pubKey,
    });
    expect(r).toEqual({ bound: 0, skipped: 4 });
    expect(calls).toEqual([]);
  });

  it('forgetting an address is unchanged', () => {
    const forgotten = [];
    expect(forgetCircleAddressKeys({ addresses: [member], forgetPeerAddress: (a) => forgotten.push(a) }))
      .toEqual({ forgotten: 1 });
    expect(forgotten).toEqual([member.circleAddress]);
  });
});
