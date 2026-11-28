/**
 * THE POD BRINGS A ONE-MEMBER CIRCLE BACK, LISTED AND NAMED. The probe on the Samsung (2026-11-28): after a restore and a
 * sign-in in place the registry held the circle and its store opened, but the launcher said "You are not in a circle
 * yet": a circle is listed from its own rows (the rules head, the trail), and the pod's registry copy carried none.
 * Ruled (Fable, 2026-11-28): one path. The pod's sealed registry copy carries per circle the snapshot the recovery file
 * carries; the circle's RULES rows always, its member list behind one switch (off until Frits answers); after a pull
 * or a merge the device lands it through the file's own landing.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { createRegistryPodMedium } from '../src/v2/registryCarrier.js';

function memoryPodSource(store = new Map()) {
  const notFound = () => Object.assign(new Error('not found'), { code: 'NOT_FOUND', status: 404 });
  return {
    store,
    async read(uri) { if (!store.has(uri)) throw notFound(); return { content: store.get(uri) }; },
    async write(uri, content) { store.set(uri, String(content)); return {}; },
    async delete(uri) { store.delete(uri); },
    async list() { return { entries: [...store.keys()] }; },
  };
}
const CIRCLE = 'solokring';
const boot = ({ vaults, pod, session }) => createRealHouseholdAgent({
  seedHousehold: false, seedDemoData: false,
  ownerRootVault: vaults.owner, chatVault: vaults.chat, registryBackend: createMemoryBackend(),
  provisionRegistryMedium: async (strategy) => (session.on ? createRegistryPodMedium({ podSource: pod, strategy }) : null),
});
const listed = async (agent) => {
  const r = await agent.callSkill('pinboard', 'listMyCircles', {});
  return { held: (r?.circles ?? []).includes(CIRCLE), name: r?.names?.[CIRCLE] ?? null };
};

async function aPhoneWithASoloCircleOnThePod() {
  const anna = { owner: new VaultMemory(), chat: new VaultMemory() };
  const pod = memoryPodSource();
  const old = await boot({ vaults: anna, pod, session: { on: true } });
  await old.callSkill('pinboard', 'createGroupV2', { groupId: CIRCLE, name: 'Solokring', rules: { text: 'Solokring' } });
  // the membership the app files after making a circle: a registry write, so the pod copy goes up with its snapshot
  await old.callSkill('agents', 'setProfileCircleMembership', { id: 'default', circleId: CIRCLE, handle: 'anna', address: 'relay:anna-solo' });
  expect(await listed(old)).toEqual({ held: true, name: 'Solokring' });
  await old.shutdown?.();
  return { anna, pod };
}

describe('the pod brings a one-member circle back, listed and named', () => {
  it('the phone\'s order: a first start not signed in, then a sign-in in place: the circle is listed with its name', async () => {
    const { anna, pod } = await aPhoneWithASoloCircleOnThePod();
    const session = { on: false };
    const phone = await boot({ vaults: anna, pod, session });
    expect((await listed(phone)).held).toBe(false);
    session.on = true;
    expect((await phone.callSkill('household', 'podSessionReady', {}))?.ok).toBe(true);
    expect(await listed(phone)).toEqual({ held: true, name: 'Solokring' });
    await phone.shutdown?.();
  });

  it('an OLDER snapshot never replaces newer rows: a newer rules head on the device keeps the name', async () => {
    const { anna, pod } = await aPhoneWithASoloCircleOnThePod();   // the pod's snapshot: rules v1, "Solokring"
    const session = { on: false };
    const phone = await boot({ vaults: anna, pod, session });
    await phone.callSkill('pinboard', 'createGroupV2', { groupId: CIRCLE, name: 'Solokring', rules: { text: 'Solokring' } });
    expect((await phone.callSkill('pinboard', 'recordGroupRulesUpdate', { groupId: CIRCLE, rules: { name: 'Nieuwe naam', text: 'x' }, version: 5 }))?.applied).toBe(true);
    session.on = true;
    await phone.callSkill('household', 'podSessionReady', {});
    expect((await listed(phone)).name, 'the landing is first-write-wins for rows, and the rules fold by version').toBe('Nieuwe naam');
    await phone.shutdown?.();
  });

  it('the member list stays off the pod while the switch is off; the rules go always', async () => {
    const { pod } = await aPhoneWithASoloCircleOnThePod();
    expect(pod.store.size).toBeGreaterThan(0);
    // sealed: nothing of the circle in clear, and ONE resource for the registry (no per-circle files a host could count)
    const all = [...pod.store.values()].join('');
    expect(all).not.toContain(CIRCLE);
    expect(all).not.toContain('Solokring');
  });
});
