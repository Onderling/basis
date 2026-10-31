/**
 * THE OFFER CARRIES THE OFFERING DEVICE — SEALED. A new device must learn the device it was shown the offer on (its
 * delegation record: its device address under each persona it holds), because after the switch to one address per
 * persona per circle the two share every circle address and nothing else introduces them. A device address is on no
 * roster, so it rides SEALED to a key the phrase re-derives (the recovery seal's 'enroll-devices' key — every device
 * holds the seal, root or delegated); the clear part names no device.
 */
import { describe, it, expect } from 'vitest';
import { Bootstrap } from '@onderling/core';
import { encodeEnrollOffer, parseEnrollOffer, sealOfferDevices, openOfferDevices } from '../../src/v2/enrollOffer.js';

const RECOVERY_SEAL_LABEL = 'recovery-seal';

describe('the offer carries the offering device, sealed to the phrase', () => {
  it('a phrase opens the offering device\'s records; another phrase opens nothing; the clear part names no device', async () => {
    const { bootstrap: root, mnemonic } = Bootstrap.create();
    const rec = { profileId: 'default', deviceId: 'wire-1', pubKey: 'DEVICE-ADDRESS-PUBKEY', by: 'auth', sig: 'sig' };
    const recW = { ...rec, profileId: 'p-aaaaaaaaaaaa', deviceId: 'wire-2', pubKey: 'WERK-DEVICE-ADDRESS' };
    const devicesSealed = sealOfferDevices(root.deriveAgentSeed(RECOVERY_SEAL_LABEL), { default: rec, 'p-aaaaaaaaaaaa': recW });
    const uri = encodeEnrollOffer({ relays: ['wss://r'], circles: [{ id: 'c1', address: 'circle-addr' }], devicesSealed });
    const parsed = parseEnrollOffer(uri);
    expect(parsed.devicesSealed).toBe(devicesSealed);
    expect(openOfferDevices(uri, mnemonic)).toEqual({ default: rec, 'p-aaaaaaaaaaaa': recW });
    const other = Bootstrap.create();
    expect(openOfferDevices(uri, other.mnemonic), 'another phrase opens nothing').toEqual({});
    const clear = JSON.stringify({ ...parsed, devicesSealed: null });
    expect(clear).not.toContain('DEVICE-ADDRESS-PUBKEY');
    expect(clear).not.toContain('WERK-DEVICE-ADDRESS');
  });
});

describe('the new device keeps only what the person\'s authority signed', () => {
  it('a record signed by the persona\'s authority is kept; a forged one, another persona\'s, or a tombstone is not', async () => {
    const { signDeviceDelegation, deviceDelegationPubKey, deriveDeviceSeed } = await import('@onderling/core');
    const { bootstrap: root, mnemonic } = Bootstrap.create();
    const seed = deriveDeviceSeed(root.deriveAgentSeed('default'), 'wire-1');
    const good = signDeviceDelegation(root.deriveProfileAuthority('default'), { profileId: 'default', deviceId: 'wire-1', pubKey: deviceDelegationPubKey(seed) });
    const { offeredDevicesFor } = await import('../../src/v2/enrollOffer.js');
    const at = (records, held) => offeredDevicesFor(encodeEnrollOffer({ circles: [{ id: 'c', address: 'a' }], devicesSealed: sealOfferDevices(root.deriveAgentSeed(RECOVERY_SEAL_LABEL), records) }), mnemonic, held);
    expect(at({ default: good }, ['default'])).toEqual([good]);
    expect(at({ default: { ...good, pubKey: 'SOMEONE-ELSE' } }, ['default']), 'forged').toEqual([]);
    expect(at({ default: good }, []), 'a persona this device does not hold').toEqual([]);
    expect(at({ default: { ...good, revoked: true } }, ['default']), 'a tombstone').toEqual([]);
    const otherRoot = Bootstrap.create().bootstrap;
    const alien = signDeviceDelegation(otherRoot.deriveProfileAuthority('default'), { profileId: 'default', deviceId: 'wire-9', pubKey: deviceDelegationPubKey(seed) });
    expect(at({ default: alien }, ['default']), 'another person\'s authority').toEqual([]);
  });
});

describe('only the ceremony writes the introduction', () => {
  it('a SCANNED offer carrying an introduction is stashed without it; the ceremony\'s own stash keeps it', async () => {
    const { stashEnrollOffer, pendingEnrollOffer } = await import('../../src/v2/enrollOffer.js');
    const mem = () => { const m = new Map(); return { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, v); }, removeItem: async (k) => { m.delete(k); } }; };
    const crafted = encodeEnrollOffer({ circles: [{ id: 'c', address: 'a' }], introduce: [{ profileId: 'default', deviceId: 'x', pubKey: 'ATTACKER', by: 'b', sig: 's' }] });
    const scanned = mem();
    expect((await stashEnrollOffer(scanned, crafted)).ok).toBe(true);
    expect((await pendingEnrollOffer(scanned))?.introduce ?? [], 'a scanned offer introduces nobody').toEqual([]);
    const ceremony = mem();
    expect((await stashEnrollOffer(ceremony, crafted, { keepIntroduce: true })).ok).toBe(true);
    expect((await pendingEnrollOffer(ceremony))?.introduce?.length, 'the ceremony\'s own stash keeps it').toBe(1);
  });
});
