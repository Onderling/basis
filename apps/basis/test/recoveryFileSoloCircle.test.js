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
    expect(v1.form?.step, 'nothing here yet: the flow asks for the circles').toBe('source');
    const after = await Promise.race([
      runner.resume(FLOW, first, { input: { source: 'file', file } }),
      new Promise((resolve) => { setTimeout(() => resolve({ hung: true }), 20_000); }),
    ]);
    expect(after.hung, 'the resume did not answer in 20 s').toBeUndefined();
    const v2 = renderFlow(FLOW, after, { ops: OPS });
    expect(v2.form?.step, 'the load moves on to the question').toBe('intent');
    await fresh.shutdown?.();
  }, 90_000);

  it('the file\'s rules row lands as it was stored (same id, author, statement), and a NEWER head from a member wins', async () => {
    const me = { owner: new VaultMemory(), chat: new VaultMemory() };
    const phone = await boot(me);
    await phone.callSkill('pinboard', 'createGroupV2', { groupId: CIRCLE, name: 'Testkring1128', rules: { text: 'Testkring1128' } });
    const rulesOf = async (agent) => ((await agent.callSkill('pinboard', 'listOpenRequests', { type: 'group-rules' }))?.items ?? [])
      .filter((it) => it?.source?.groupId === CIRCLE);
    const [original] = await rulesOf(phone);
    expect(original, 'the maker holds a rules row').toBeTruthy();
    const { file } = await phone.callSkill('household', 'exportRecoveryFile', {});
    await phone.shutdown?.();
    const fresh = await boot({ owner: me.owner, chat: me.chat });
    expect((await fresh.callSkill('household', 'importRecoveryFile', { file })).ok).toBe(true);
    const [landed] = await rulesOf(fresh);
    expect(landed?.id, 'id-preserved').toBe(original.id);
    expect(landed?.addedBy, 'its author as stored').toBe(original.addedBy);
    expect(JSON.stringify(landed?.source?.statement ?? null), 'its statement as stored, never re-signed').toBe(JSON.stringify(original.source?.statement ?? null));
    // a member's newer rules arrive after the import (the rules lane's receive half): the newer head is the name
    const v = Number(original.source?.version ?? 1);
    const r = await fresh.callSkill('pinboard', 'recordGroupRulesUpdate', { groupId: CIRCLE, rules: { name: 'Nieuwe naam', text: 'x' }, version: v + 1 });
    expect(r?.applied, JSON.stringify(r)).toBe(true);
    expect(await mine(fresh), 'the newer head wins over the file\'s').toEqual({ held: true, name: 'Nieuwe naam' });
    await fresh.shutdown?.();
  }, 90_000);
});
