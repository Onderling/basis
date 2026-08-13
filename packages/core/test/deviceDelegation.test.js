// The per-device derivation root + the root-signed delegation record (add-a-device).
// The load-bearing pin: two devices holding the SAME phrase present DISTINCT per-circle
// addresses — the clone collision this layer exists to fix.
import { describe, it, expect } from 'vitest';
import {
  Bootstrap,
  deriveDeviceSeed, deviceDelegationPubKey, deviceDelegationMessage,
  signDeviceDelegation, verifyDeviceDelegation,
  deriveCircleAddress,
} from '../src/index.js';

const root = Bootstrap.create().bootstrap;
const profileSeed = root.deriveAgentSeed('default');

describe('deriveDeviceSeed', () => {
  it('is deterministic and 32 bytes', () => {
    const a = deriveDeviceSeed(profileSeed, 'dev-1');
    const b = deriveDeviceSeed(profileSeed, 'dev-1');
    expect(a).toBeInstanceOf(Uint8Array);
    expect(a.length).toBe(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('distinct per device, and distinct from the profile seed itself', () => {
    const a = deriveDeviceSeed(profileSeed, 'dev-1');
    const b = deriveDeviceSeed(profileSeed, 'dev-2');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(Buffer.from(a).equals(Buffer.from(profileSeed))).toBe(false);
  });

  it('THE COLLISION FIX: two devices of one profile present DISTINCT per-circle addresses', () => {
    const dev1 = deriveDeviceSeed(profileSeed, 'dev-1');
    const dev2 = deriveDeviceSeed(profileSeed, 'dev-2');
    const circleId = 'kring-thuis';
    const a1 = deriveCircleAddress(dev1, circleId);
    const a2 = deriveCircleAddress(dev2, circleId);
    const shared = deriveCircleAddress(profileSeed, circleId);   // the pre-delegation clone address
    expect(a1).not.toBe(a2);
    expect(a1).not.toBe(shared);
    expect(a2).not.toBe(shared);
  });

  it('rejects a wrong-shaped seed or empty deviceId', () => {
    expect(() => deriveDeviceSeed(new Uint8Array(16), 'dev-1')).toThrow();
    expect(() => deriveDeviceSeed(profileSeed, '')).toThrow();
  });
});

describe('the delegation record', () => {
  const seed = deriveDeviceSeed(profileSeed, 'dev-1');
  const pubKey = deviceDelegationPubKey(seed);
  const record = signDeviceDelegation(root.secret, { profileId: 'default', deviceId: 'dev-1', pubKey });

  it('signs the canonical statement and verifies', () => {
    expect(record.pubKey).toBe(pubKey);
    expect(verifyDeviceDelegation(record)).toBe(true);
  });

  it('binds to the owner when the verifier knows the root pubKey', () => {
    expect(verifyDeviceDelegation(record, record.by)).toBe(true);
    const otherRoot = Bootstrap.create().bootstrap;
    const foreign = signDeviceDelegation(otherRoot.secret, { profileId: 'default', deviceId: 'dev-1', pubKey });
    // self-consistent, but NOT this owner's delegation
    expect(verifyDeviceDelegation(foreign)).toBe(true);
    expect(verifyDeviceDelegation(foreign, record.by)).toBe(false);
  });

  it('rejects tampering with any signed field (deny-by-default)', () => {
    expect(verifyDeviceDelegation({ ...record, deviceId: 'dev-2' })).toBe(false);
    expect(verifyDeviceDelegation({ ...record, profileId: 'work' })).toBe(false);
    expect(verifyDeviceDelegation({ ...record, pubKey: deviceDelegationPubKey(deriveDeviceSeed(profileSeed, 'dev-2')) })).toBe(false);
    expect(verifyDeviceDelegation({ ...record, sig: '' })).toBe(false);
    expect(verifyDeviceDelegation(null)).toBe(false);
  });

  it('the statement format is stable', () => {
    expect(deviceDelegationMessage('p', 'd', 'k')).toBe('onderling-device-delegation-v1|p|d|k');
  });
});
