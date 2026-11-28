/**
 * A CIRCLE WITH ONLY ITS MAKER, THROUGH A RECOVERY FILE. The phone walk (2026-11-28): the load brought such a circle
 * back as "Circle without a name", and the restore-finish dialog then said nothing and would not close.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { createFlowRunner, renderFlow } from '@onderling/app-manifest';
import { householdManifest } from '../../household/manifest.js';
import { restoreFinishOutcome } from '../src/v2/restoreFinishView.js';

const CIRCLE = 'testkring1128';
const boot = (v) => createRealHouseholdAgent({
  seedHousehold: false, seedDemoData: false,
  ownerRootVault: v.owner, chatVault: v.chat, registryBackend: v.registry ?? createMemoryBackend(),
});

/** listMyCircles' own shape: `{ circles: [id], names: { id: name } }`. */
const mine = async (agent) => {
  const r = await agent.callSkill('pinboard', 'listMyCircles', {});
  return { held: (r?.circles ?? []).includes(CIRCLE), name: r?.names?.[CIRCLE] ?? null };
};

describe('a one-member circle through a recovery file', () => {
  it('the load answers, and the circle comes back with its name', async () => {
    const me = { owner: new VaultMemory(), chat: new VaultMemory() };
    const phone = await boot(me);
    const made = await phone.callSkill('pinboard', 'createGroupV2', { groupId: CIRCLE, name: 'Testkring1128', rules: { text: 'Testkring1128' } });
    expect(made?.ok ?? true, JSON.stringify(made)).not.toBe(false);
    expect(await mine(phone), 'named on the phone that made it').toEqual({ held: true, name: 'Testkring1128' });
    const exported = await phone.callSkill('household', 'exportRecoveryFile', {});
    expect(exported.ok, JSON.stringify(exported)).toBe(true);
    await phone.shutdown?.();

    // the phone is wiped: the same root, an empty registry and stores
    const fresh = await boot({ owner: me.owner, chat: me.chat });
    expect((await mine(fresh)).held, 'the wiped phone does not have it yet').toBe(false);
    const started = Date.now();
    const r = await Promise.race([
      fresh.callSkill('household', 'restoreSource', { source: 'file', file: exported.file }),
      new Promise((resolve) => { setTimeout(() => resolve({ hung: true }), 20_000); }),
    ]);
    expect(r.hung, `the load did not answer in 20 s`).toBeUndefined();
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, outcome: 'ok' });
    console.info(`[probe] restoreSource answered in ${Date.now() - started} ms: ${JSON.stringify(r).slice(0, 300)}`);
    expect(await mine(fresh), 'the circle came back, with its name').toEqual({ held: true, name: 'Testkring1128' });
    await fresh.shutdown?.();
  }, 90_000);

  it('through the restore-finish flow, as the phone runs it: the load moves on to the question', async () => {
    const me = { owner: new VaultMemory(), chat: new VaultMemory() };
    const phone = await boot(me);
    await phone.callSkill('pinboard', 'createGroupV2', { groupId: CIRCLE, name: 'Testkring1128', rules: { text: 'Testkring1128' } });
    const { file } = await phone.callSkill('household', 'exportRecoveryFile', {});
    await phone.shutdown?.();
    const fresh = await boot({ owner: me.owner, chat: me.chat });
    const FLOW = householdManifest.flows.find((f) => f.id === 'restore-finish');
    const OPS = new Map(householdManifest.operations.map((o) => [o.id, o]));
    const runner = createFlowRunner({ ops: OPS, callSkill: (opId, args) => fresh.callSkill('household', opId, args) });
    const first = await runner.start(FLOW, {});
    const v1 = renderFlow(FLOW, first, { ops: OPS });
    console.info(`[probe] start: ${v1.status} ${v1.form?.step ?? ''}`);
    expect(v1.form?.step, 'nothing here yet: the flow asks for the circles').toBe('source');
    const after = await Promise.race([
      runner.resume(FLOW, first, { input: { source: 'file', file } }),
      new Promise((resolve) => { setTimeout(() => resolve({ hung: true }), 20_000); }),
    ]);
    expect(after.hung, 'the resume did not answer in 20 s').toBeUndefined();
    const v2 = renderFlow(FLOW, after, { ops: OPS });
    console.info(`[probe] after the load: ${v2.status} ${v2.form?.step ?? ''} outcome=${JSON.stringify(restoreFinishOutcome(after))} steps=${JSON.stringify(after.steps?.source ?? null).slice(0, 300)}`);
    expect(v2.form?.step, 'the load moves on to the question').toBe('intent');
    await fresh.shutdown?.();
  }, 90_000);
});
