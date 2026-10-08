// A statement a person's device signs for a party outside their devices: the chain (root → delegation → statement)
// verifies on its own and binds the op, the receiver and the arguments; another root, another op, a stale time, a
// replayed nonce and a device the receiver holds revoked are refused. The tombstone itself is root-signed.
import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import {
  Bootstrap, deriveDeviceSeed, deviceDelegationPubKey, signDeviceDelegation,
  signDeviceStatement, verifyDeviceStatement, createNonceWindow, signDeviceRevocation, verifyDeviceRevocation, ownerRootFingerprint,
} from '../src/index.js';

function device(root, deviceId) {
  const seed = deriveDeviceSeed(root.deriveAgentSeed('default'), deviceId);
  const delegation = signDeviceDelegation(root.secret, { profileId: 'default', deviceId, pubKey: deviceDelegationPubKey(seed) });
  const kp = nacl.sign.keyPair.fromSeed(seed);
  return { delegation, sign: (m) => nacl.sign.detached(new TextEncoder().encode(m), kp.secretKey) };
}
const ann = Bootstrap.create().bootstrap;
const eve = Bootstrap.create().bootstrap;
const T = 1_700_000_000_000;
const base = { domain: 'companion-manage', node: 'NODE-1', op: 'node.status', args: { a: 1, b: [2, 3] } };

describe('a device-signed statement', () => {
  it('verifies through the whole chain and names the root it speaks for', () => {
    const phone = device(ann, 'phone');
    const s = signDeviceStatement({ ...base, ...phone, now: () => T });
    const r = verifyDeviceStatement(s, { ...base, args: { b: [2, 3], a: 1 }, now: () => T + 1000 });
    expect(r.ok).toBe(true);
    expect(r.root).toBe(phone.delegation.by);
    expect(ownerRootFingerprint(r.root)).toBe(ann.fingerprint());
    expect(r.deviceId).toBe('phone');
    // pinned to the owner's root: the same statement holds, another root's device does not
    expect(verifyDeviceStatement(s, { ...base, root: phone.delegation.by, now: () => T }).ok).toBe(true);
    const eves = signDeviceStatement({ ...base, ...device(eve, 'laptop'), now: () => T });
    expect(verifyDeviceStatement(eves, { ...base, root: phone.delegation.by, now: () => T })).toEqual({ ok: false, reason: 'not-this-owner' });
  });

  it('stands for nothing else: another op, node or arguments, a stale time, a forged signature', () => {
    const phone = device(ann, 'phone');
    const s = signDeviceStatement({ ...base, ...phone, now: () => T });
    expect(verifyDeviceStatement(s, { ...base, op: 'grant.revoke', now: () => T }).reason).toBe('not-for-this');
    expect(verifyDeviceStatement(s, { ...base, node: 'NODE-2', now: () => T }).reason).toBe('not-for-this');
    expect(verifyDeviceStatement(s, { ...base, args: { a: 2, b: [2, 3] }, now: () => T }).reason).toBe('args-differ');
    expect(verifyDeviceStatement(s, { ...base, now: () => T + 6 * 60 * 1000 }).reason).toBe('stale');
    // a device signing for a delegation that is not its own
    const other = device(ann, 'tablet');
    const swapped = { ...s, delegation: other.delegation };
    expect(verifyDeviceStatement(swapped, { ...base, now: () => T }).reason).toBe('bad-signature');
    expect(verifyDeviceStatement({ ...s, nonce: 'short' }, { ...base, now: () => T }).reason).toBe('no-nonce');
    expect(verifyDeviceStatement(null, base).reason).toBe('no-statement');
  });

  it('is single use inside its window; a device the receiver holds revoked is refused before anything else', () => {
    const phone = device(ann, 'phone');
    const nonces = createNonceWindow({ now: () => T });
    const s = signDeviceStatement({ ...base, ...phone, now: () => T });
    expect(verifyDeviceStatement(s, { ...base, nonces, now: () => T }).ok).toBe(true);
    expect(verifyDeviceStatement(s, { ...base, nonces, now: () => T }).reason).toBe('replayed');
    const again = signDeviceStatement({ ...base, ...phone, now: () => T });
    expect(verifyDeviceStatement(again, { ...base, nonces, now: () => T, isRevoked: (id) => id === 'phone' }).reason).toBe('revoked');
    // a fresh device of the same root still speaks
    const tablet = device(ann, 'tablet');
    const t = signDeviceStatement({ ...base, ...tablet, now: () => T });
    expect(verifyDeviceStatement(t, { ...base, nonces, root: phone.delegation.by, now: () => T, isRevoked: (id) => id === 'phone' }).ok).toBe(true);
  });
});

describe('a root-signed revocation', () => {
  it('verifies under its root only, and names the device', () => {
    const rev = signDeviceRevocation(ann.secret, { profileId: 'default', deviceId: 'phone' });
    const annRoot = device(ann, 'x').delegation.by;
    expect(verifyDeviceRevocation(rev)).toBe(true);
    expect(verifyDeviceRevocation(rev, annRoot)).toBe(true);
    expect(verifyDeviceRevocation(rev, device(eve, 'x').delegation.by)).toBe(false);
    expect(verifyDeviceRevocation({ ...rev, deviceId: 'tablet' })).toBe(false);
  });
});
