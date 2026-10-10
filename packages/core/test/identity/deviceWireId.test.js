// The id a device shows on the wire is per persona and keyed by a device SECRET. The device keeps one internal id (its
// keys derive from it, so no address changes); old records already showed that internal id, so a wire id computable
// from it would reopen the very link the persona closes.
import { describe, it, expect } from 'vitest';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { mintDeviceSalt, wireDeviceId } from '../../src/identity/deviceDelegation.js';
import { mintProfileId } from '../../src/identity/profileIds.js';

describe('wireDeviceId', () => {
  it('is per persona, stable for one device, and shaped d-<32 hex>', () => {
    const salt = mintDeviceSalt();
    const a = mintProfileId();
    expect(salt).toBeInstanceOf(Uint8Array);
    expect(salt.length).toBe(32);
    expect(wireDeviceId(salt, 'default')).toMatch(/^d-[0-9a-f]{32}$/);
    expect(wireDeviceId(salt, a)).toBe(wireDeviceId(salt, a));
    expect(wireDeviceId(salt, 'default')).not.toBe(wireDeviceId(salt, a));
  });

  it('cannot be computed from an old record: the internal id and the persona id are not enough', () => {
    const internalId = 'c7e1f0a2-5b9d-4e3a-8f61-2d4c9b7a1e05';   // what an old record showed
    const persona = mintProfileId();                               // what the persona's own record shows
    const salt = mintDeviceSalt();
    const wire = wireDeviceId(salt, persona);
    expect(wire).not.toContain(internalId);
    // the obvious recomputations from what an observer holds do not land on it
    const fromInternal = (ikm) => `d-${Buffer.from(hkdf(sha256, new TextEncoder().encode(ikm), new Uint8Array(0), new TextEncoder().encode(persona), 16)).toString('hex')}`;
    expect(wire).not.toBe(fromInternal(internalId));
    // the salt is what decides: another device's salt, same persona → another id
    expect(wireDeviceId(mintDeviceSalt(), persona)).not.toBe(wire);
  });

  it('refuses a salt that is not 32 bytes, and a profile id that is not one', () => {
    expect(() => wireDeviceId(new Uint8Array(16), 'default')).toThrow(/salt/);
    expect(() => wireDeviceId(mintDeviceSalt(), 'first-device')).toThrow(/reserved/);
  });
});
