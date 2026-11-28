/**
 * "FINISHING YOUR RESTORE" OFFERS THE POD. The phone walk (2026-11-28): the screen named the pod as a way back but offered
 * only "Choose file" and "Not now". Its source step now takes `pod`: the shared sign-in op runs (in place on the phone),
 * the pod's circle list comes in through the pod-session door, and the finish line says the circles came from the pod.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { createRegistryPodMedium } from '../src/v2/registryCarrier.js';
import { restoreFinishOutcome, restoreFinishCameFrom } from '../src/v2/restoreFinishView.js';

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
const CIRCLE = 'circle-oosterpoort';
const boot = ({ vaults, pod, session }) => createRealHouseholdAgent({
  seedHousehold: false, seedDemoData: false,
  ownerRootVault: vaults.owner, chatVault: vaults.chat, registryBackend: createMemoryBackend(),
  provisionRegistryMedium: async (strategy) => (session.on ? createRegistryPodMedium({ podSource: pod, strategy }) : null),
});
/** The shell's sign-in, completing in place: the session becomes ready and the op asks the pod-session door, as signinFlow does. */
const mountSignIn = (agent, session, { fails = false } = {}) => agent.mountAppOps('basis', {
  signin: async () => {
    if (fails) return { ok: false, error: 'the provider refused' };
    session.on = true;
    await agent.callSkill('household', 'podSessionReady', {});
    return { ok: true, message: 'signed in' };
  },
});

describe('the restore finishes from the pod', () => {
  it('source "pod": the sign-in runs, the circles come in, and the line says they came from the pod', async () => {
    const anna = { owner: new VaultMemory(), chat: new VaultMemory() };
    const pod = memoryPodSource();
    const old = await boot({ vaults: anna, pod, session: { on: true } });
    await old.callSkill('agents', 'setProfileCircleMembership', { id: 'default', circleId: CIRCLE, handle: 'anna', address: 'relay:anna-oosterpoort' });
    await old.shutdown?.();
    const session = { on: false };
    const phone = await boot({ vaults: anna, pod, session });
    mountSignIn(phone, session);
    const r = await phone.callSkill('household', 'restoreSource', { source: 'pod' });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, outcome: 'ok', source: 'pod' });
    expect(r.circleIds).toContain(CIRCLE);
    expect(restoreFinishCameFrom({ steps: { source: { outcome: 'ok', out: r } } })).toBe('circle.restore_finish.status_pod');
    await phone.shutdown?.();
  });

  it('a pod with no circles for this person, and a sign-in that failed, each end in words', async () => {
    const anna = { owner: new VaultMemory(), chat: new VaultMemory() };
    const empty = await boot({ vaults: anna, pod: memoryPodSource(), session: { on: false } });
    mountSignIn(empty, { on: false });
    expect(await empty.callSkill('household', 'restoreSource', { source: 'pod' })).toMatchObject({ ok: false, outcome: 'pod-empty' });
    mountSignIn(empty, { on: false }, { fails: true });
    expect(await empty.callSkill('household', 'restoreSource', { source: 'pod' })).toMatchObject({ ok: false, outcome: 'pod-failed', error: 'the provider refused' });
    expect(restoreFinishOutcome({ steps: { source: { outcome: 'pod-empty' } } }).messageKey).toBe('circle.restore_finish.err_pod_empty');
    expect(restoreFinishOutcome({ steps: { source: { outcome: 'pod-failed', out: { error: 'the provider refused' } } } }))
      .toMatchObject({ messageKey: 'circle.restore_finish.err_pod_failed' });
    await empty.shutdown?.();
  });
});
