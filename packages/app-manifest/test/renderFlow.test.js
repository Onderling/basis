// The one flow projector — pure view models over (flow, instance). The restore flow again:
// its three-way branch is exactly what the skipped-vs-done progress semantics exist for.
import { describe, it, expect } from 'vitest';
import { renderFlow } from '../src/renderFlow.js';
import { createFlowRunner } from '../src/flowRunner.js';

const OPS = new Map([
  ['unlock', { id: 'unlock', params: [{ name: 'phrase', kind: 'secret', required: true, labelKey: 'restore.phrase' }] }],
  ['probe', { id: 'probe', params: [] }],
  ['merge', { id: 'merge', params: [{ name: 'choices', kind: 'object', required: true }] }],
  ['overwrite', { id: 'overwrite', params: [] }],
]);

const FLOW = {
  id: 'restore', version: 'v1',
  needs: [{ name: 'phrase', kind: 'secret', required: true }],
  steps: [
    { id: 'unlock', op: 'unlock', bind: { phrase: { ref: '$flow.needs.phrase' } }, next: { ok: 'probe', error: null } },
    { id: 'probe', op: 'probe', next: { openable: 'merge', undecryptable: 'choose', transport: null } },
    { id: 'merge', op: 'merge' },
    { id: 'choose', op: 'overwrite' },
  ],
};

const runner = (results) => createFlowRunner({
  ops: OPS,
  callSkill: async (opId) => results[opId] ?? { ok: true },
});

describe('renderFlow', () => {
  it('idle: everything pending, no form, restart/cancel off', () => {
    const m = renderFlow(FLOW, null, { ops: OPS });
    expect(m.status).toBe('idle');
    expect(m.progress.every((p) => p.state === 'pending')).toBe(true);
    expect(m.form).toBe(null);
    expect(m.actions).toEqual({ canSubmit: false, canCancel: false, canRestart: false });
    expect(m.labelKey).toBe('flow.restore.title');
  });

  it('awaiting-input: the form carries labelKeys (op-declared wins, deterministic fallback else)', async () => {
    const r = runner({ unlock: { ok: true }, probe: { ok: true, outcome: 'openable' } });
    const inst = await r.start(FLOW, { needs: { phrase: 'x' } });
    const m = renderFlow(FLOW, inst, { ops: OPS });
    expect(m.status).toBe('awaiting-input');
    expect(m.form.step).toBe('merge');
    expect(m.form.params).toEqual([{ name: 'choices', kind: 'object', required: true, labelKey: 'flow.restore.merge.choices' }]);
    expect(m.progress.find((p) => p.id === 'merge').state).toBe('current');
    expect(m.progress.find((p) => p.id === 'unlock').state).toBe('done');
    expect(m.actions.canSubmit).toBe(true);
    expect(m.actions.canCancel).toBe(true);
  });

  it('done via the transport branch: the untaken branches show SKIPPED, produces surface', async () => {
    const flow = { ...FLOW, produces: [{ name: 'how', from: '$steps.probe.outcome' }] };
    const r = runner({ unlock: { ok: true }, probe: { ok: true, outcome: 'transport' } });
    const inst = await r.start(flow, { needs: { phrase: 'x' } });
    const m = renderFlow(flow, inst, { ops: OPS });
    expect(m.status).toBe('done');
    expect(m.progress.map((p) => `${p.id}:${p.state}`)).toEqual([
      'unlock:done', 'probe:done', 'merge:skipped', 'choose:skipped',
    ]);
    expect(m.actions).toEqual({ canSubmit: false, canCancel: false, canRestart: false });
  });

  it('failed: reason surfaces and restart is offered', async () => {
    const r = runner({ unlock: { ok: true }, probe: { ok: true, outcome: 'weird' } });
    const inst = await r.start(FLOW, { needs: { phrase: 'x' } });
    const m = renderFlow(FLOW, inst, { ops: OPS });
    expect(m.status).toBe('failed');
    expect(m.reason).toBe('unmapped-outcome:probe:weird');
    expect(m.actions.canRestart).toBe(true);
  });
});
