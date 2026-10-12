/**
 * A REVOKED DEVICE LOSES EVERY PERSONA IT HELD (persona arc c4c).
 *
 * A device is known to each persona by a wire id derived from that persona's seed over the device's internal id — no two
 * personas' records link (by design). The person's own revoke ceremony still retires the lost device under EVERY
 * persona: each device puts its internal id on the person's private device map (a `device-link` row in the own-devices
 * scope — never in a signed record, never in a circle), and the ceremony derives the device's wire id per persona from
 * it, tombstones it there, and retires its addresses in that persona's circles AS that persona.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { Bootstrap, wireDeviceId, deriveDeviceSeed, deriveCircleAddress } from '@onderling/core';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { EventLog } from '../src/eventLog.js';

const boot = () => createRealHouseholdAgent({
  seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(),
  registryBackend: createMemoryBackend(), deviceLog: new EventLog({ initial: [], muted: [] }),
});
const wait = async (pred, ms = 5000) => { const end = Date.now() + ms; for (;;) { const v = await pred(); if (v || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 100)); } };

describe('the private device map', () => {
  it('each device puts its own line on it at boot: its default wire id and its internal id', async () => {
    const dev = await boot();
    const me = dev.persona('default');
    const row = await wait(async () => ((await (await dev.ownStore()).list()) ?? []).find((it) => it?.type === 'device-link') ?? null);
    expect(row).toMatchObject({ wireId: me.enrolledDevice.deviceId, internalId: me.internalDeviceId });
    await dev.shutdown?.();
  }, 60_000);
});

describe('the revoke ceremony retires a device under every persona', () => {
  it('the lost device is tombstoned under persona B by B\'s own wire id for it, and its address in B\'s circle is retired as B', async () => {
    const dev1 = await boot();
    const phrase = (await dev1.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const root = Bootstrap.fromMnemonic(phrase);
    const { id } = await dev1.callSkill('agents', 'createProfile', { name: 'Buurt' });
    const B = dev1.persona(id);
    // B holds a circle (its membership on B's record)
    const Y = 'circle-of-buurt';
    expect((await dev1.callSkill('household', 'bindCirclePersona', { circleId: Y, personaId: id })).ok).toBe(true);
    expect((await dev1.callSkill('agents', 'setProfileCircleMembership', { id, circleId: Y, address: B.circleAddressFor(Y) }))?.ok).toBe(true);
    // the lost device's line, as the own-devices sync carried it here
    const lostInternal = 'i-lost-0123456789';
    const lostWire = wireDeviceId(root.deriveAgentSeed('default'), lostInternal);
    await (await dev1.ownStore()).put({ type: 'device-link', id: `device-link:${lostWire}`, wireId: lostWire, internalId: lostInternal }, { by: 'test' });

    const r = await dev1.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: lostWire, circleIds: [] });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const bWire = wireDeviceId(root.deriveAgentSeed(id), lostInternal);
    expect(r.revokedUnder, 'retired under the default and under B, by each one\'s own wire id').toEqual({ default: lostWire, [id]: bWire });
    expect(bWire).not.toBe(lostWire);
    const bAddr = deriveCircleAddress(deriveDeviceSeed(root.deriveAgentSeed(id), bWire), Y);
    expect(r.revokedIn.some((x) => x.circleId === Y && x.address === bAddr), 'its address in B\'s circle retired').toBe(true);
    await dev1.shutdown?.();
  }, 90_000);
});
