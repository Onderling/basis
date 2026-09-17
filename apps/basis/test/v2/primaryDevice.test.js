/**
 * The primary DEVICE (sync-policy §12, the DM half): a personal claim `{ deviceId, at }`, kept sealed, carried to the
 * siblings, sibling-gated; the host re-registers on the relays when "is it me" flips.
 */
import { describe, it, expect, vi } from 'vitest';
import { createPrimaryDeviceChoice, claimSupersedes, PRIMARY_DEVICE_SUBTYPES, PRIMARY_DEVICE_VAULT_KEY } from '../../src/v2/primaryDevice.js';

const memVault = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); }, m }; };
const SIBS = ['addr:box', 'addr:laptop'];
const rig = ({ myDeviceId = 'dev-phone', siblings = SIBS, vault = memVault(), t = 1000 } = {}) => {
  const sent = []; const flips = [];
  let now = t;
  const choice = createPrimaryDeviceChoice({
    vault, myDeviceId, siblings: async () => siblings,
    sendToPeer: async (to, payload, opts) => { sent.push({ to, payload, opts }); return { delivered: true }; },
    onChanged: (mine) => flips.push(mine), now: () => now,
  });
  return { choice, sent, flips, vault, tick: (n) => { now = n; } };
};

describe('the claim', () => {
  it('no choice yet → not mine (plain registration, as before); a claim is stored, carried to every sibling, and flips "is it me"', async () => {
    const { choice, sent, flips, vault } = rig();
    expect(choice.isMine()).toBe(false);
    const r = await choice.claim();
    expect(r).toMatchObject({ ok: true, attempted: 2, claim: { deviceId: 'dev-phone', at: 1000 } });
    expect(choice.isMine()).toBe(true);
    expect(flips).toEqual([true]);
    expect(sent.map((s) => s.to)).toEqual(SIBS);
    expect(sent[0].payload).toEqual({ subtype: PRIMARY_DEVICE_SUBTYPES.carry, deviceId: 'dev-phone', at: 1000 });
    expect(sent[0].opts).toEqual({ guarantee: 'hold-forward' });
    expect(JSON.parse(vault.m.get(PRIMARY_DEVICE_VAULT_KEY))).toEqual({ deviceId: 'dev-phone', at: 1000 });
  });
  it('a device without an id cannot claim', async () => {
    const { choice } = rig({ myDeviceId: null });
    expect(await choice.claim()).toEqual({ ok: false, reason: 'no-device-id' });
  });
  it('the vault entry survives a boot: a new instance reads it', async () => {
    const vault = memVault();
    const a = rig({ vault }); await a.choice.claim();
    const b = rig({ vault, myDeviceId: 'dev-phone' });
    expect(await b.choice.load()).toEqual({ deviceId: 'dev-phone', at: 1000 });
    expect(b.choice.isMine()).toBe(true);
    const c = rig({ vault, myDeviceId: 'dev-box' });
    await c.choice.load();
    expect(c.choice.isMine()).toBe(false);
  });
});

describe('landing a sibling\'s claim', () => {
  it('a claim from a SIBLING lands and steps this device down; a newer own claim wins back; a stale one is ignored', async () => {
    const { choice, flips, tick } = rig();
    await choice.claim();                                       // mine at 1000
    await choice.handlers[PRIMARY_DEVICE_SUBTYPES.carry]('addr:box', { subtype: PRIMARY_DEVICE_SUBTYPES.carry, deviceId: 'dev-box', at: 2000 });
    expect(choice.isMine()).toBe(false);
    expect(choice.current()).toEqual({ deviceId: 'dev-box', at: 2000 });
    expect(flips).toEqual([true, false]);
    // a stale claim (older than what is held) changes nothing
    await choice.handlers[PRIMARY_DEVICE_SUBTYPES.carry]('addr:laptop', { subtype: PRIMARY_DEVICE_SUBTYPES.carry, deviceId: 'dev-laptop', at: 1500 });
    expect(choice.current()).toEqual({ deviceId: 'dev-box', at: 2000 });
    // the person taps here again: the claim is strictly newer than what is held, even on a slow clock
    tick(1200);
    const r = await choice.claim();
    expect(r.claim.at).toBe(2001);
    expect(choice.isMine()).toBe(true);
  });
  it('a claim from a STRANGER is refused — only a device of mine may say who is primary', async () => {
    const { choice } = rig();
    await choice.handlers[PRIMARY_DEVICE_SUBTYPES.carry]('addr:stranger', { subtype: PRIMARY_DEVICE_SUBTYPES.carry, deviceId: 'dev-evil', at: 9e12 });
    expect(choice.current()).toBe(null);
    await choice.handlers[PRIMARY_DEVICE_SUBTYPES.carry]('addr:box', { subtype: PRIMARY_DEVICE_SUBTYPES.carry, deviceId: '', at: 5 });
    expect(choice.current()).toBe(null);
  });
  it('a sibling\'s REQUEST is answered with the current claim; nothing chosen → silence; a stranger gets nothing', async () => {
    const { choice, sent } = rig();
    await choice.handlers[PRIMARY_DEVICE_SUBTYPES.request]('addr:box', { subtype: PRIMARY_DEVICE_SUBTYPES.request });
    expect(sent).toHaveLength(0);
    await choice.claim(); sent.length = 0;
    await choice.handlers[PRIMARY_DEVICE_SUBTYPES.request]('addr:box', { subtype: PRIMARY_DEVICE_SUBTYPES.request });
    expect(sent).toEqual([{ to: 'addr:box', payload: { subtype: PRIMARY_DEVICE_SUBTYPES.carry, deviceId: 'dev-phone', at: 1000 }, opts: { guarantee: 'hold-forward' } }]);
    sent.length = 0;
    await choice.handlers[PRIMARY_DEVICE_SUBTYPES.request]('addr:stranger', { subtype: PRIMARY_DEVICE_SUBTYPES.request });
    expect(sent).toHaveLength(0);
    expect((await choice.requestFromSiblings()).attempted).toBe(2);
  });
  it('supersedes: newer wins; the same moment resolves by the smaller id everywhere', () => {
    expect(claimSupersedes({ deviceId: 'b', at: 2 }, { deviceId: 'a', at: 1 })).toBe(true);
    expect(claimSupersedes({ deviceId: 'b', at: 1 }, { deviceId: 'a', at: 2 })).toBe(false);
    expect(claimSupersedes({ deviceId: 'a', at: 1 }, { deviceId: 'b', at: 1 })).toBe(true);
    expect(claimSupersedes({ deviceId: 'b', at: 1 }, { deviceId: 'a', at: 1 })).toBe(false);
    expect(claimSupersedes({ deviceId: 'a', at: 1 }, null)).toBe(true);
    expect(claimSupersedes(null, { deviceId: 'a', at: 1 })).toBe(false);
  });
});
