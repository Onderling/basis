/**
 * THE RESTORE, END TO END — the `restore-finish` flow on the household manifest, run by the one runner
 * against the real agent factory, after the reload a phrase ceremony asks for.
 *
 *   A phone runs the phrase ceremony (the note is left) · the next boot says a restore is pending · the
 *   flow asks what came back: nothing → load a recovery file (or not now) → the question: could anyone
 *   else still use the old phone? → broken or lost: the replace ceremony (phrase once more) → done.
 *   Every branch is a screen that says what happened. Journey 4's "nothing" screen is the `later` branch.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { verifyFlows, createFlowRunner, renderFlow } from '@onderling/app-manifest';
import { householdManifest } from '../../household/manifest.js';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

const CIRCLE = 'circle-oosterpoort';
const FLOW = householdManifest.flows.find((f) => f.id === 'restore-finish');
const OPS = new Map(householdManifest.operations.map((o) => [o.id, o]));
const boot = (vaults) => createRealHouseholdAgent({
  seedHousehold: false, seedDemoData: false,
  ownerRootVault: vaults.owner, chatVault: vaults.chat, registryBackend: createMemoryBackend(),
});
const runnerFor = (a) => createFlowRunner({ ops: OPS, callSkill: (opId, args) => a.callSkill('household', opId, args) });

/** The old phone: joined a circle, saved a recovery file, revealed its phrase. */
async function oldPhone() {
  const a = await boot({ owner: new VaultMemory(), chat: new VaultMemory() });
  await a.callSkill('agents', 'setProfileCircleMembership', { id: 'default', circleId: CIRCLE, handle: 'anna', address: 'relay:anna' });
  const { file } = await a.callSkill('household', 'exportRecoveryFile', {});
  const { mnemonic } = await a.callSkill('household', 'revealOwnerPhrase', {});
  return { file, mnemonic };
}
/** The new phone: the phrase ceremony on a first boot, then the reboot the ceremony asks for. */
async function newPhone(mnemonic) {
  const vaults = { owner: new VaultMemory(), chat: new VaultMemory() };
  const pre = await boot(vaults);
  expect((await pre.callSkill('household', 'restoreOwnerPhrase', { mnemonic })).ok).toBe(true);
  const a = await boot(vaults);
  expect(a.restorePending(), 'the ceremony left its note for this boot').toBe(true);
  return a;
}

describe('the restore-finish flow', () => {
  it('declares against its manifest', () => {
    const r = verifyFlows(householdManifest);
    expect(r.problems).toEqual([]);
  });

  it("her phone broke: nothing came back → the file → 'it broke' → the ceremony → a quiet done", async () => {
    const { file, mnemonic } = await oldPhone();
    const a = await newPhone(mnemonic);
    const runner = runnerFor(a);
    let inst = await runner.start(FLOW, {});
    expect(inst.status).toBe('awaiting-input');
    expect(inst.awaiting.step, 'nothing came back → the source question').toBe('source');
    expect(a.restorePending(), 'asked once: the note is cleared by the first step').toBe(false);
    expect(renderFlow(FLOW, inst, { ops: OPS }).form.params.map((p) => p.name)).toEqual(['source']);

    inst = await runner.resume(FLOW, inst, { input: { source: 'file', file } });
    expect(inst.awaiting?.step, 'the file brought the circles → the question').toBe('intent');
    expect(inst.steps.source.out.circles).toBeGreaterThanOrEqual(1);

    inst = await runner.resume(FLOW, inst, { input: { intent: 'broken' } });
    expect(inst.awaiting?.step, 'broken → the ceremony, which needs the phrase').toBe('retire');
    inst = await runner.resume(FLOW, inst, { input: { mnemonic } });
    expect(inst.status).toBe('done');
    expect(inst.steps.retire.outcome).toBe('ok');
    expect(inst.produces).toMatchObject({ source: 'file', intent: 'broken' });
    // the wrong phrase at the ceremony is refused, and the flow says so rather than pretending
    const again = runnerFor(a);
    let i2 = await again.start(FLOW, {});
    i2 = await again.resume(FLOW, i2, { input: { intent: 'lost' } });   // circles are here now → straight to the question
    i2 = await again.resume(FLOW, i2, { input: { mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' } });
    expect(i2.steps.retire.outcome).toMatch(/wrong-phrase|invalid-phrase/);
  });

  it("she has nothing: 'not now' ends on the honest screen; 'adding' retires nothing", async () => {
    const { mnemonic } = await oldPhone();
    const a = await newPhone(mnemonic);
    const runner = runnerFor(a);
    let inst = await runner.start(FLOW, {});
    inst = await runner.resume(FLOW, inst, { input: { source: 'later' } });
    expect(inst.status).toBe('done');
    expect(inst.produces.source).toBe('later');
    expect(inst.steps.intent, 'no question when there is nothing to retire from').toBeUndefined();
    const view = renderFlow(FLOW, inst, { ops: OPS });
    expect(view.progress.find((p) => p.id === 'retire').state).toBe('skipped');

    // with circles back (a membership written by hand stands in for the pod), 'adding' ends without a ceremony
    await a.callSkill('agents', 'setProfileCircleMembership', { id: 'default', circleId: CIRCLE, handle: 'anna', address: 'relay:anna-2' });
    const r2 = runnerFor(a);
    let i2 = await r2.start(FLOW, {});
    expect(i2.awaiting.step).toBe('intent');
    i2 = await r2.resume(FLOW, i2, { input: { intent: 'adding' } });
    expect(i2.status).toBe('done');
    expect(i2.steps.retire).toBeUndefined();
  });
});
