/**
 * THE PROVING MIGRATION (#63): the restore-settings FLOW — declared in the params manifest,
 * verified by verifyFlows, executed by the one runner, projected by the one projector — against
 * the REAL composition (createRealHouseholdAgent). Both branches of the DAG:
 *
 *   • undecryptable → the mismatch step pauses awaiting the coarse choice; 'overwrite' flushes
 *     (and nothing was written before it — the gate's promise, now flow-shaped);
 *   • openable-with-conflicts → the merge step pauses awaiting per-param choices; 'theirs'
 *     adopts the pod's value through set-param.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { CachingDataSource } from '@onderling/local-store';
import { verifyFlows, createFlowRunner, renderFlow } from '@onderling/app-manifest';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { paramsManifest } from '../src/v2/paramsManifest.js';
import { SETTINGS_SHARED_PROBE_PATH } from '../src/v2/settingsRestoreGate.js';

const KEY = 'nearby.ask.defaultTtlMs';
const FLOW = paramsManifest.flows.find((f) => f.id === 'restore-settings');
const OPS = new Map(paramsManifest.operations.map((o) => [o.id, o]));

function fakeMedium({ blob, sealed = false }) {
  const writes = [];
  return {
    writes,
    read: async () => { if (sealed) throw new Error('sealing: secretbox open failed'); return blob; },
    write: async (path, data) => { writes.push({ path, data }); },
    delete: async () => {}, list: async () => [],
  };
}

const boot = (ds, medium) => createRealHouseholdAgent({
  seedHousehold: false,
  ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(),
  settingsDataSource: ds,
  provisionSettingsMedium: async () => medium,
});

const runnerFor = (a) => createFlowRunner({
  ops: OPS,
  callSkill: (opId, args) => a.callSkill('params', opId, args),
});

describe('the restore-settings flow (declared → verified → run → projected, real composition)', () => {
  it('the declaration itself verifies against its manifest', () => {
    const r = verifyFlows(paramsManifest);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('UNDECRYPTABLE branch: pause at the coarse choice; overwrite flushes only after the choice', async () => {
    const medium = fakeMedium({ blob: null, sealed: true });
    const ds = new CachingDataSource();
    await ds.write(SETTINGS_SHARED_PROBE_PATH, { [KEY]: 9 });
    const a = await boot(ds, medium);
    const runner = runnerFor(a);

    const inst = await runner.start(FLOW, {});
    expect(inst.status).toBe('awaiting-input');
    expect(inst.awaiting.step).toBe('mismatch');
    expect(medium.writes).toHaveLength(0);                       // HELD — the flow wrote nothing yet

    // the projector's form for the pause — what a shell would paint
    const view = renderFlow(FLOW, inst, { ops: OPS });
    expect(view.form.params.map((p) => p.name)).toEqual(['choice']);
    expect(view.progress.find((p) => p.id === 'probe').state).toBe('done');

    const done = await runner.resume(FLOW, inst, { input: { choice: 'overwrite' } });
    expect(done.status).toBe('done');
    expect(medium.writes.length).toBeGreaterThan(0);             // now, and only now, it flushed
    expect(done.produces.how).toBe('undecryptable');
  });

  it("the coarse DEFAULT ('local') ends the flow with nothing written", async () => {
    const medium = fakeMedium({ blob: null, sealed: true });
    const ds = new CachingDataSource();
    await ds.write(SETTINGS_SHARED_PROBE_PATH, { [KEY]: 9 });
    const a = await boot(ds, medium);
    const runner = runnerFor(a);
    const inst = await runner.start(FLOW, {});
    const done = await runner.resume(FLOW, inst, { input: { choice: 'local' } });
    expect(done.status).toBe('done');
    expect(medium.writes).toHaveLength(0);
  });

  it('CONFLICTS branch: pause at merge; keep-MINE is a real write-back (the hydrate-adoption fix)', async () => {
    const medium = fakeMedium({ blob: { [KEY]: 111_000 } });
    const ds = new CachingDataSource();
    await ds.write(SETTINGS_SHARED_PROBE_PATH, { [KEY]: 222_000 });
    const a = await boot(ds, medium);
    const runner = runnerFor(a);

    const inst = await runner.start(FLOW, {});
    expect(inst.status).toBe('awaiting-input');
    expect(inst.awaiting.step).toBe('merge');
    expect(inst.steps.probe.out.conflicts).toEqual([{ key: KEY, mine: 222_000, theirs: 111_000 }]);

    // THE HYDRATE-ADOPTION BUG this migration found and fixed: before any choice, hydrate has
    // already adopted the POD's value into the live register — so 'mine' must be a real write-back.
    const pre = await a.callSkill('params', 'get-param', { key: KEY });
    expect(pre.value).toBe(111_000);                             // the bug's shape, pinned

    const done = await runner.resume(FLOW, inst, { input: { choices: { [KEY]: 'mine' } } });
    expect(done.status).toBe('done');
    expect(done.steps.merge.out.applied).toEqual([KEY]);
    const got = await a.callSkill('params', 'get-param', { key: KEY });
    expect(got.value).toBe(222_000);                             // keep-mine now actually keeps mine
  });

  it('CLEAN branch: agreeing values run straight through, no pauses', async () => {
    const medium = fakeMedium({ blob: { [KEY]: 5 } });
    const ds = new CachingDataSource();
    await ds.write(SETTINGS_SHARED_PROBE_PATH, { [KEY]: 5 });
    const a = await boot(ds, medium);
    const inst = await runnerFor(a).start(FLOW, {});
    expect(inst.status).toBe('done');
    expect(inst.produces.how).toBe('clean');
  });
});
