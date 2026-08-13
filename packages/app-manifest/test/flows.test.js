// The flow declaration + load-time verifier (L7, ratified 2026-08-12). The RESTORE flow is the
// worked example throughout — it exercises branching (probe → three outcomes), a destructive
// branch, and the secrets rule (the phrase never travels by value).
import { describe, it, expect } from 'vitest';
import { verifyFlow, verifyFlows } from '../src/flows.js';

const OPS = new Map([
  ['probe-settings', { id: 'probe-settings', params: [] }],
  ['apply-merge', { id: 'apply-merge', params: [{ name: 'choices', kind: 'object' }] }],
  ['overwrite-pod-settings', { id: 'overwrite-pod-settings', params: [] }],
  ['unlock', { id: 'unlock', params: [{ name: 'phrase', kind: 'secret', required: true }] }],
]);

const RESTORE = {
  id: 'restore',
  scope: 'device',
  needs: [{ name: 'phrase', kind: 'secret', required: true }],
  produces: [{ name: 'outcome', kind: 'string' }],
  effects: [{ kind: 'write', target: 'settings' }, { kind: 'overwrite', target: 'pod-settings' }],
  steps: [
    { id: 'unlock', op: 'unlock', bind: { phrase: { ref: '$flow.needs.phrase' } }, next: { ok: 'probe' } },
    { id: 'probe', op: 'probe-settings', next: { openable: 'merge', undecryptable: 'choose', transport: null } },
    { id: 'merge', op: 'apply-merge', bind: { choices: { from: '$steps.probe.conflicts' } } },
    { id: 'choose', op: 'overwrite-pod-settings' },
  ],
};

describe('verifyFlow — the restore flow is a valid DAG', () => {
  it('accepts the worked example', () => {
    const r = verifyFlow(RESTORE, { ops: OPS });
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('THE SECRETS RULE: a secret need bound by value is refused; by ref passes', () => {
    const bad = structuredClone(RESTORE);
    bad.steps[0].bind.phrase = { from: '$flow.needs.phrase' };            // by value — forbidden twice over
    const r = verifyFlow(bad, { ops: OPS });
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch(/secret/);
  });

  it('a flow may not PRODUCE a secret by value', () => {
    const bad = { ...RESTORE, produces: [{ name: 'leak', kind: 'secret' }] };
    const r = verifyFlow(bad, { ops: OPS });
    expect(r.problems.join('\n')).toMatch(/may not produce a secret/);
  });

  it('cycles are refused (flows are DAGs)', () => {
    const bad = structuredClone(RESTORE);
    bad.steps[2].next = { again: 'probe' };                               // merge → probe → merge …
    const r = verifyFlow(bad, { ops: OPS });
    expect(r.problems.join('\n')).toMatch(/cycle/);
  });

  it('unknown ops, unknown next targets, unreachable steps, bad paths — all named', () => {
    const bad = {
      id: 'broken',
      steps: [
        { id: 'a', op: 'nope', next: { ok: 'ghost' } },
        { id: 'orphan', op: 'probe-settings', bind: { x: { from: '$typo' } } },
      ],
    };
    const r = verifyFlow(bad, { ops: OPS });
    const text = r.problems.join('\n');
    expect(text).toMatch(/unknown op "nope"/);
    expect(text).toMatch(/unknown step "ghost"/);
    expect(text).toMatch(/unreachable/);
    expect(text).toMatch(/bad path/);
  });

  it('a step must reference exactly one of op|flow; bindings exactly one mode', () => {
    const r = verifyFlow({
      id: 'x',
      steps: [{ id: 'a', op: 'probe-settings', flow: 'restore' },
              { id: 'b', op: 'apply-merge', bind: { choices: { from: '$flow.needs.z', value: 1 } } }],
    }, { ops: OPS });
    const text = r.problems.join('\n');
    expect(text).toMatch(/exactly one of op\|flow/);
    expect(text).toMatch(/exactly one of from\|ref\|value/);
  });
});

describe('verifyFlows — the manifest block', () => {
  it('flow-refs resolve within the block; ONE nesting level is the cap', () => {
    const inner = { id: 'inner', steps: [{ id: 'p', op: 'probe-settings' }] };
    const mid = { id: 'mid', steps: [{ id: 's', flow: 'inner' }] };
    const outer = { id: 'outer', steps: [{ id: 's', flow: 'mid' }] };
    const manifest = { operations: [...OPS.values()], flows: [inner, mid, outer] };
    const r = verifyFlows(manifest);
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch(/one nesting level/);
    // without the deep chain it verifies clean
    expect(verifyFlows({ operations: [...OPS.values()], flows: [inner, mid] }).ok).toBe(true);
  });

  it('duplicate flow ids are refused; an empty block is fine', () => {
    const f = { id: 'dup', steps: [{ id: 'p', op: 'probe-settings' }] };
    expect(verifyFlows({ operations: [...OPS.values()], flows: [f, { ...f }] }).problems.join('\n')).toMatch(/duplicate flow id/);
    expect(verifyFlows({ operations: [] }).ok).toBe(true);
  });
});
