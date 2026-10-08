/**
 * A companion is CLAIMED, not configured: started without an owner it prints one claim code, and the first person to
 * hand that code back — in a statement signed by one of their DEVICES, with the device's root-signed delegation
 * alongside — makes their OWNER ROOT the node's owner, recorded in the node's own config so a restart remembers.
 * Until then every management op is refused. Afterwards every device of that root manages it; a device of another
 * root does not, a device the root revoked does not (the root's own tombstone, delivered to the node), and a replayed
 * statement does not. The code works once, lasts ten minutes, and is burnt after a few wrong tries. Over a REAL relay.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, AgentIdentity, Parts, Bootstrap, signDeviceRevocation } from '@onderling/core';
import { ownerDevice } from './support/ownerDevice.js';
import { VaultMemory } from '@onderling/vault';
import { RelayTransport } from '@onderling/transports';
import { startCompanionNode } from '../src/index.js';
import { createOwnerClaim, CLAIM_TTL_MS, CLAIM_MAX_TRIES } from '../src/ownerClaim.js';

const cleanups = [];
afterEach(async () => { while (cleanups.length) { try { await cleanups.pop()(); } catch { /* best-effort */ } } });

/** One device of a person: on the relay as any identity; signs management with its root-delegated key. */
async function device(host, root, deviceId) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const agent = new Agent({ identity: id, transport: new RelayTransport({ relayUrl: host.relayUrl, identity: id }), label: deviceId });
  await agent.start();
  await agent.hello(host.agent.address);
  cleanups.push(() => agent.stop?.());
  const { delegation, auth: sign } = ownerDevice(root, deviceId);
  /** Ask the node `op` as this device — signed unless told otherwise; `statement` is returned for a replay. */
  const ask = async (op, args = {}, { unsigned = false, statement = null } = {}) => {
    const auth = statement ?? (unsigned ? undefined : sign(host.agent.address, op, args));
    const res = Parts.data(await agent.invoke(host.agent.address, op, { ...args, ...(auth ? { auth } : {}) }));
    return { res, auth };
  };
  return { agent, delegation, ask };
}
function configDir() {
  const dir = mkdtempSync(join(tmpdir(), 'companion-claim-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
async function node(dir) {
  const host = await startCompanionNode({ configDir: dir, management: true });
  cleanups.push(() => host.stop());
  return host;
}
const ann = Bootstrap.create().bootstrap;
const eve = Bootstrap.create().bootstrap;

describe('a companion is claimed by its owner', () => {
  it('unclaimed it refuses every management op; a signed claim makes the device\'s ROOT the owner, once', async () => {
    const dir = configDir();
    const host = await node(dir);
    const code = host.claimCode();
    expect(code, 'an unclaimed node shows a code').toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const phone = await device(host, ann, 'phone');
    const evesLaptop = await device(host, eve, 'laptop');
    expect((await phone.ask('node.status')).res, 'unclaimed: nobody manages it').toEqual({ ok: false, error: 'forbidden' });

    // a claim without a statement is refused before the code is read — and does not burn the code
    expect((await phone.ask('manage.claimOwner', { code }, { unsigned: true })).res).toEqual({ ok: false, error: 'unsigned' });
    expect(host.claimCode()).toBe(code);

    expect((await phone.ask('manage.claimOwner', { code: code.toLowerCase() })).res, 'case and dash as typed').toEqual({ ok: true });
    expect(host.claimCode(), 'no code once owned').toBeNull();
    expect(host.managementOwnerRoot).toBe(phone.delegation.by);
    expect((await phone.ask('node.status')).res.ok).toBe(true);
    expect((await evesLaptop.ask('node.status')).res, 'another root\'s device').toEqual({ ok: false, error: 'forbidden' });
    expect((await evesLaptop.ask('manage.claimOwner', { code })).res, 'a second claim').toEqual({ ok: false, error: 'already-owned' });
  });

  it('every device of the owner manages; a replayed statement does not; a revoked device does not', async () => {
    const host = await node(configDir());
    const phone = await device(host, ann, 'phone');
    const tablet = await device(host, ann, 'tablet');
    expect((await phone.ask('manage.claimOwner', { code: host.claimCode() })).res).toEqual({ ok: true });

    const first = await tablet.ask('node.status');
    expect(first.res.ok, 'a second device of the same root').toBe(true);
    expect((await tablet.ask('node.status', {}, { statement: first.auth })).res, 'the same statement again').toEqual({ ok: false, error: 'forbidden' });

    // the owner revokes the phone (the root's own tombstone; anyone may deliver it — here the tablet)
    const forged = signDeviceRevocation(eve.secret, { profileId: 'default', deviceId: 'tablet' });
    expect((await phone.ask('manage.revokeDevice', { revocation: forged }, { unsigned: true })).res, 'another root\'s tombstone').toEqual({ ok: false, error: 'forbidden' });
    const revocation = signDeviceRevocation(ann.secret, { profileId: 'default', deviceId: 'phone' });
    expect((await tablet.ask('manage.revokeDevice', { revocation }, { unsigned: true })).res).toEqual({ ok: true });
    expect((await phone.ask('node.status')).res, 'the revoked phone').toEqual({ ok: false, error: 'forbidden' });
    expect((await tablet.ask('node.status')).res.ok, 'the tablet still').toBe(true);
    const laptop = await device(host, ann, 'laptop');
    expect((await laptop.ask('node.status')).res.ok, 'a fresh device of the same root').toBe(true);
  });

  it('a statement from a device whose clock is off is refused as STALE — the one refusal worth naming', async () => {
    const host = await node(configDir());
    const phone = await device(host, ann, 'phone');
    const late = () => Date.now() - 20 * 60 * 1000;
    const claimLate = ownerDevice(ann, 'phone').auth(host.agent.address, 'manage.claimOwner', { code: host.claimCode() }, { now: late });
    expect((await phone.ask('manage.claimOwner', { code: host.claimCode() }, { statement: claimLate })).res).toEqual({ ok: false, error: 'stale' });
    expect(host.claimString()).toMatch(new RegExp(`^[A-Z2-9]{4}-[A-Z2-9]{4}@${host.agent.address.replace(/[-_]/g, '\\$&')}$`));
    expect((await phone.ask('manage.claimOwner', { code: host.claimCode() })).res).toEqual({ ok: true });
    const statusLate = ownerDevice(ann, 'phone').auth(host.agent.address, 'node.status', {}, { now: late });
    expect((await phone.ask('node.status', {}, { statement: statusLate })).res).toEqual({ ok: false, error: 'stale' });
  });

  it('the owner and the tombstones survive a restart; the record names no device key', async () => {
    const dir = configDir();
    const first = await node(dir);
    const phone = await device(first, ann, 'phone');
    expect((await phone.ask('manage.claimOwner', { code: first.claimCode() })).res).toEqual({ ok: true });
    const tablet = await device(first, ann, 'tablet');
    await tablet.ask('manage.revokeDevice', { revocation: signDeviceRevocation(ann.secret, { profileId: 'default', deviceId: 'phone' }) }, { unsigned: true });
    const onDisk = JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8'));
    expect(onDisk).toMatchObject({ root: phone.delegation.by, revoked: ['phone'] });
    await first.stop();

    const again = await node(dir);
    expect(again.claimCode()).toBeNull();
    expect(again.managementOwnerRoot).toBe(phone.delegation.by);
    const phone2 = await device(again, ann, 'phone');
    const tablet2 = await device(again, ann, 'tablet');
    expect((await phone2.ask('node.status')).res.ok, 'still revoked after the restart').toBe(false);
    expect((await tablet2.ask('node.status')).res.ok).toBe(true);
  });
});

describe('the claim code', () => {
  it('expires after its time and a fresh one replaces it', () => {
    let t = 1_000;
    const saved = [];
    const claim = createOwnerClaim({ load: () => null, save: (o) => { saved.push(o); }, now: () => t });
    const first = claim.code();
    t += CLAIM_TTL_MS + 1;
    expect(claim.claim({ code: first, root: 'ann' })).toEqual({ ok: false, error: 'invalid-code' });
    const second = claim.code();
    expect(second).not.toBe(first);
    expect(claim.claim({ code: second, root: 'ann' })).toEqual({ ok: true });
    expect(saved).toHaveLength(1);
    expect(saved[0].root).toBe('ann');
  });

  it('is burnt after a few wrong tries, so it cannot be guessed', () => {
    const claim = createOwnerClaim({ load: () => null, save: () => {}, now: () => 0 });
    const right = claim.code();
    for (let i = 0; i < CLAIM_MAX_TRIES; i++) expect(claim.claim({ code: 'WRNG-CODE', root: 'eve' }).ok).toBe(false);
    expect(claim.claim({ code: right, root: 'ann' }), 'the burnt code').toEqual({ ok: false, error: 'invalid-code' });
    expect(claim.code()).not.toBe(right);
  });

  it('a claim without a root or a code is refused; an owned node mints no code', () => {
    const claim = createOwnerClaim({ load: () => ({ root: 'ann' }), save: () => {}, now: () => 0 });
    expect(claim.owner()).toBe('ann');
    expect(claim.code()).toBeNull();
    const fresh = createOwnerClaim({ load: () => null, save: () => {}, now: () => 0 });
    expect(fresh.claim({ code: fresh.code(), root: '' }).ok).toBe(false);
    expect(fresh.claim({ root: 'ann' }).ok).toBe(false);
  });
});

describe('the shipped boot', () => {
  it('has no owner of its own: no owner env var, no composed-in owner — the node is claimed or unowned', () => {
    const boot = readFileSync(new URL('../src/boot.js', import.meta.url), 'utf8');
    expect(boot).not.toMatch(/COMPANION_MANAGE_OWNER_PUBKEY/);
    expect(boot).not.toMatch(/claimedOwner/);
    expect(boot).toMatch(/onClaimCode/);
  });
});
