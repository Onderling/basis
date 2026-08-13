// The flow runner — traversal, bindings, the awaiting-input round-trip, and THE SECRETS RULE
// at runtime: saveInstance never sees secret material. Restore-shaped flows throughout.
import { describe, it, expect } from 'vitest';
import { createFlowRunner } from '../src/flowRunner.js';

const OPS = new Map([
  ['unlock', { id: 'unlock', params: [{ name: 'phrase', kind: 'secret', required: true }] }],
  ['probe', { id: 'probe', params: [] }],
  ['merge', { id: 'merge', params: [{ name: 'choices', kind: 'object', required: true }] }],
  ['overwrite', { id: 'overwrite', params: [] }],
]);

const FLOW = {
  id: 'restore', version: 'v1', scope: 'device',
  needs: [{ name: 'phrase', kind: 'secret', required: true }],
  produces: [{ name: 'how', kind: 'string', from: '$steps.probe.status' }],
  steps: [
    { id: 'unlock', op: 'unlock', bind: { phrase: { ref: '$flow.needs.phrase' } }, next: { ok: 'probe', error: null } },
    { id: 'probe', op: 'probe', next: { openable: 'merge', undecryptable: 'choose', transport: null } },
    { id: 'merge', op: 'merge' },                       // choices arrives via awaiting-input
    { id: 'choose', op: 'overwrite' },
  ],
};

function harness(results) {
  const calls = [];
  const saved = [];
  const runner = createFlowRunner({
    ops: OPS,
    genId: () => 'i1',
    callSkill: async (opId, args) => { calls.push({ opId, args }); return results[opId] ?? { ok: true }; },
    saveInstance: (inst) => { saved.push(JSON.stringify(inst)); },
  });
  return { runner, calls, saved };
}

describe('the flow runner', () => {
  it('walks the DAG by outcome; produces resolve at the end', async () => {
    const { runner, calls } = harness({
      unlock: { ok: true },
      probe: { ok: true, outcome: 'openable', status: 'openable', conflicts: [1, 2] },
      merge: { ok: true },
    });
    // merge's required `choices` bound from probe's output so it runs without input
    const flow = structuredClone(FLOW);
    flow.steps[2].bind = { choices: { from: '$steps.probe.conflicts' } };
    const inst = await runner.start(flow, { needs: { phrase: 'geheime woorden' } });
    expect(inst.status).toBe('done');
    expect(calls.map((c) => c.opId)).toEqual(['unlock', 'probe', 'merge']);
    expect(calls[2].args.choices).toEqual([1, 2]);
    expect(inst.produces.how).toBe('openable');
  });

  it('THE SECRETS RULE: the phrase reaches the op but NEVER the persistence seam', async () => {
    const { runner, calls, saved } = harness({
      unlock: { ok: true },
      probe: { ok: true, outcome: 'transport' },
    });
    const inst = await runner.start(FLOW, { needs: { phrase: 'geheime woorden' } });
    expect(inst.status).toBe('done');
    expect(calls[0].args.phrase).toBe('geheime woorden');       // the op got it
    expect(saved.join('')).not.toContain('geheime');             // the record never did
    expect(JSON.stringify(inst.needs ?? {})).not.toContain('geheime');
  });

  it('awaiting-input pauses at the unsatisfied required param; resume with input finishes', async () => {
    const { runner } = harness({
      unlock: { ok: true },
      probe: { ok: true, outcome: 'openable' },
      merge: { ok: true },
    });
    const inst = await runner.start(FLOW, { needs: { phrase: 'x' } });
    expect(inst.status).toBe('awaiting-input');
    expect(inst.awaiting).toEqual({ step: 'merge', params: [{ name: 'choices', kind: 'object' }] });

    const done = await runner.resume(FLOW, inst, { transient: { phrase: 'x' }, input: { choices: { keep: 'theirs' } } });
    expect(done.status).toBe('done');
    expect(done.steps.merge.outcome).toBe('ok');
  });

  it('an unmapped outcome on a step WITH declared next fails loudly; error outcome routes', async () => {
    const { runner } = harness({ unlock: { ok: true }, probe: { ok: true, outcome: 'weird' } });
    const inst = await runner.start(FLOW, { needs: { phrase: 'x' } });
    expect(inst.status).toBe('failed');
    expect(inst.reason).toBe('unmapped-outcome:probe:weird');

    const { runner: r2 } = harness({ unlock: { ok: false } });   // error → declared null = clean end
    const i2 = await r2.start(FLOW, { needs: { phrase: 'x' } });
    expect(i2.status).toBe('done');
    expect(i2.steps.unlock.outcome).toBe('error');
  });

  it('version drift on resume RESTARTS the instance (never resume into changed steps)', async () => {
    const { runner } = harness({ unlock: { ok: true }, probe: { ok: true, outcome: 'transport' } });
    const inst = await runner.start(FLOW, { needs: { phrase: 'x' } });
    inst.status = 'awaiting-input'; inst.at = 'merge'; inst.version = 'v0';   // a stale persisted instance
    const re = await runner.resume(FLOW, inst, { transient: { phrase: 'x' } });
    expect(re.version).toBe('v1');
    expect(re.status).toBe('done');                              // ran from the entry again
    expect(Object.keys(re.steps)).toContain('unlock');
  });

  it('one-level flow-refs run as sub-instances; their produces feed the parent step outcome', async () => {
    const sub = {
      id: 'sub', steps: [{ id: 'p', op: 'probe' }],
      produces: [{ name: 'status', from: '$steps.p.status' }],
    };
    const parent = {
      id: 'parent',
      steps: [{ id: 's', flow: 'sub', next: { ok: null } }],
    };
    const { runner } = harness({ probe: { ok: true, status: 'fine' } });
    const r2 = createFlowRunner({
      ops: OPS, genId: () => 'i2',
      callSkill: async (opId) => ({ ok: true, status: 'fine' }),
      flowById: (id) => (id === 'sub' ? sub : undefined),
    });
    const inst = await r2.start(parent, {});
    expect(inst.status).toBe('done');
    expect(inst.steps.s.out.status).toBe('fine');
  });

  it('an OPTIONAL binding degrades to an absent arg; a required one still fails loud', async () => {
    const flow = {
      id: 'f',
      steps: [
        { id: 'a', op: 'probe', next: { ok: 'b' } },
        // 'nothing' does not exist on a's output — optional skips it, the step still runs
        { id: 'b', op: 'probe', bind: { extra: { from: '$steps.a.nothing', optional: true } } },
      ],
    };
    const { runner, calls } = harness({ probe: { ok: true } });
    const inst = await runner.start(flow, {});
    expect(inst.status).toBe('done');
    expect('extra' in calls[1].args).toBe(false);
    // the same binding without `optional` fails the instance (the loud default)
    const strict = structuredClone(flow);
    delete strict.steps[1].bind.extra.optional;
    const { runner: r2 } = harness({ probe: { ok: true } });
    const inst2 = await r2.start(strict, {});
    expect(inst2.status).toBe('failed');
    expect(inst2.reason).toBe('unresolved-binding:extra');
  });

  it('a thrown op becomes outcome "error"; cancel is terminal', async () => {
    const runner = createFlowRunner({
      ops: OPS,
      callSkill: async () => { throw new Error('boom'); },
    });
    const flow = { id: 'f', steps: [{ id: 'a', op: 'probe', next: { ok: null, error: null } }] };
    const inst = await runner.start(flow, {});
    expect(inst.steps.a.outcome).toBe('error');
    expect(inst.status).toBe('done');                            // error was a declared route
    const c = runner.cancel(inst);
    expect(c.status).toBe('cancelled');
  });
});
