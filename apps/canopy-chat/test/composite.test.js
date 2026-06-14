/**
 * canopy-chat — composite-op runner + verifier tests (P1, feedback-extension).
 *
 * Covers DESIGN §2.2 (P1) acceptance + §2.3 (the verifier):
 *   - a composite `/demo = [opA, opB]` runs end-to-end with arg-passing;
 *   - `argRef` threading (step-2 consumes step-1's output);
 *   - the verifier REJECTS an unknown-opId composite;
 *   - `onError: 'stop'` vs 'continue';
 *   - end-to-end through parse → router → runCompositeDispatch.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  runCompositeOp, verifyComposite, resolvePath,
} from '../src/composite.js';
import { runCompositeDispatch } from '../src/dispatch.js';
import { mergeManifests } from '../src/manifestMerge.js';
import { resolveDispatch } from '../src/router.js';
import { parseInput } from '../src/parser.js';
import { validateManifest } from '@canopy/app-manifest';

// ── helpers ──────────────────────────────────────────────────────────

/** A composite op: /demo runs opA then opB. */
const demoOp = {
  id: 'demo', verb: 'list',
  steps: [
    { appOrigin: 'a', opId: 'opA', args: { x: 1 } },
    { appOrigin: 'b', opId: 'opB', args: { y: 2 } },
  ],
  surfaces: { slash: { command: '/demo' }, chat: { reply: 'text' } },
};

// ── resolvePath ──────────────────────────────────────────────────────

describe('resolvePath', () => {
  it('reads a nested dot-path', () => {
    expect(resolvePath({ item: { id: 'i-7' } }, 'item.id')).toBe('i-7');
  });
  it('returns undefined for a missing link (no throw)', () => {
    expect(resolvePath({ item: null }, 'item.id')).toBeUndefined();
    expect(resolvePath(undefined, 'a.b')).toBeUndefined();
    expect(resolvePath({}, '')).toBeUndefined();
  });
  it('indexes into arrays', () => {
    expect(resolvePath({ items: [{ id: 'first' }] }, 'items.0.id')).toBe('first');
  });
});

// ── runCompositeOp: end-to-end ───────────────────────────────────────

describe('runCompositeOp — /demo = [opA, opB] end-to-end', () => {
  it('runs steps in order with their literal args', async () => {
    const calls = [];
    const callSkill = vi.fn(async (appOrigin, opId, args) => {
      calls.push({ appOrigin, opId, args });
      return { ok: true, from: opId };
    });

    const result = await runCompositeOp(demoOp, callSkill);

    expect(result.ok).toBe(true);
    expect(result.stats).toEqual({ total: 2, ran: 2, ok: 2, failed: 0 });
    expect(calls).toEqual([
      { appOrigin: 'a', opId: 'opA', args: { x: 1 } },
      { appOrigin: 'b', opId: 'opB', args: { y: 2 } },
    ]);
    // aggregate payload = last successful step's payload
    expect(result.payload).toEqual({ ok: true, from: 'opB' });
  });

  it('threads dispatch-level ctx under each step (step args win)', async () => {
    const calls = [];
    const callSkill = async (appOrigin, opId, args) => {
      calls.push(args);
      return { ok: true };
    };
    await runCompositeOp(
      { ...demoOp, steps: [{ appOrigin: 'a', opId: 'opA', args: { x: 1 } }] },
      callSkill,
      { threadId: 't-9', x: 99 },     // ctx; step's own x:1 wins
    );
    expect(calls[0]).toEqual({ threadId: 't-9', x: 1 });
  });
});

// ── runCompositeOp: argRef threading ─────────────────────────────────

describe('runCompositeOp — argRef threads step-1 output into step-2', () => {
  it('binds a prior step result via dot-path under the last segment', async () => {
    const calls = [];
    const callSkill = async (appOrigin, opId, args) => {
      calls.push({ opId, args });
      if (opId === 'create') return { item: { id: 'i-42' } };
      return { ok: true };
    };

    const op = {
      id: 'createThenComplete', verb: 'complete',
      steps: [
        { appOrigin: 'a', opId: 'create', args: { text: 'milk' } },
        { appOrigin: 'a', opId: 'complete', argRef: { from: 0, path: 'item.id' } },
      ],
    };

    const result = await runCompositeOp(op, callSkill);
    expect(result.ok).toBe(true);
    expect(calls[1]).toEqual({ opId: 'complete', args: { id: 'i-42' } });
  });

  it('binds under `as` when given (overrides the last segment)', async () => {
    const calls = [];
    const callSkill = async (appOrigin, opId, args) => {
      calls.push({ opId, args });
      if (opId === 'create') return { item: { id: 'i-7' } };
      return { ok: true };
    };
    const op = {
      id: 'chain', verb: 'list',
      steps: [
        { appOrigin: 'a', opId: 'create' },
        { appOrigin: 'a', opId: 'use', args: { mode: 'x' }, argRef: { from: 0, path: 'item.id', as: 'targetId' } },
      ],
    };
    await runCompositeOp(op, callSkill);
    expect(calls[1]).toEqual({ opId: 'use', args: { mode: 'x', targetId: 'i-7' } });
  });

  it('omits the threaded arg when the prior path is absent', async () => {
    const calls = [];
    const callSkill = async (appOrigin, opId, args) => {
      calls.push(args);
      return { ok: true };           // step-0 has no item.id
    };
    const op = {
      id: 'chain', verb: 'list',
      steps: [
        { appOrigin: 'a', opId: 'noop' },
        { appOrigin: 'a', opId: 'use', argRef: { from: 0, path: 'item.id' } },
      ],
    };
    await runCompositeOp(op, callSkill);
    expect(calls[1]).toEqual({});   // nothing threaded
  });
});

// ── runCompositeOp: onError ──────────────────────────────────────────

describe('runCompositeOp — onError', () => {
  const failingOp = (onError) => ({
    id: 'maybeFail', verb: 'list', onError,
    steps: [
      { appOrigin: 'a', opId: 'opA' },
      { appOrigin: 'a', opId: 'boom' },     // fails
      { appOrigin: 'a', opId: 'opC' },
    ],
  });

  const callSkill = async (appOrigin, opId) => {
    if (opId === 'boom') return { ok: false, error: 'kaboom' };
    return { ok: true, from: opId };
  };

  it("'stop' (default) halts at the first failing step — opC never runs", async () => {
    const seen = [];
    const cs = async (a, opId) => { seen.push(opId); return callSkill(a, opId); };
    const result = await runCompositeOp(failingOp(undefined), cs);

    expect(seen).toEqual(['opA', 'boom']);        // opC NOT run
    expect(result.ok).toBe(false);
    expect(result.stats).toEqual({ total: 3, ran: 2, ok: 1, failed: 1 });
    expect(result.error.message).toBe('kaboom');
  });

  it("'continue' runs every step best-effort; records the failure", async () => {
    const seen = [];
    const cs = async (a, opId) => { seen.push(opId); return callSkill(a, opId); };
    const result = await runCompositeOp(failingOp('continue'), cs);

    expect(seen).toEqual(['opA', 'boom', 'opC']);  // all ran
    expect(result.ok).toBe(false);
    expect(result.stats).toEqual({ total: 3, ran: 3, ok: 2, failed: 1 });
    // aggregate payload = last SUCCESSFUL step
    expect(result.payload).toEqual({ ok: true, from: 'opC' });
  });

  it('a thrown step is a failure too (envelope-or-throw)', async () => {
    const cs = async (a, opId) => {
      if (opId === 'boom') throw new Error('exploded');
      return { ok: true };
    };
    const result = await runCompositeOp(failingOp('stop'), cs);
    expect(result.ok).toBe(false);
    expect(result.error.message).toBe('exploded');
  });
});

// ── verifyComposite (the sandbox-by-construction fitness fn) ──────────

describe('verifyComposite — sandbox-by-construction', () => {
  const catalog = mergeManifests([
    {
      manifest: {
        app: 'a', itemTypes: ['x'],
        operations: [
          { id: 'opA', verb: 'list' },
          { id: 'opB', verb: 'list' },
        ],
      },
    },
  ]);

  it('accepts a composite whose every step resolves', () => {
    const ok = verifyComposite(demoOp.steps[1] ? {
      ...demoOp,
      steps: [
        { appOrigin: 'a', opId: 'opA' },
        { appOrigin: 'a', opId: 'opB' },
      ],
    } : demoOp, catalog);
    expect(ok).toEqual({ ok: true, missing: [] });
  });

  it('REJECTS a composite referencing an unknown opId', () => {
    const bad = {
      id: 'bad', verb: 'list',
      steps: [
        { appOrigin: 'a', opId: 'opA' },
        { appOrigin: 'a', opId: 'doesNotExist' },
      ],
    };
    const res = verifyComposite(bad, catalog);
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual(['a/doesNotExist']);
  });

  it('treats a non-composite op as trivially ok', () => {
    expect(verifyComposite({ id: 'plain', verb: 'list' }, catalog))
      .toEqual({ ok: true, missing: [] });
  });

  it('resolves the app-qualified key under prefix-on-collision', () => {
    // Two apps both declare `dup`; the 2nd is exposed as 'b/dup'.
    const cat = mergeManifests([
      { manifest: { app: 'a', itemTypes: ['x'], operations: [{ id: 'dup', verb: 'list' }] } },
      { manifest: { app: 'b', itemTypes: ['x'], operations: [{ id: 'dup', verb: 'list' }] } },
    ]);
    const op = { id: 'c', verb: 'list', steps: [{ appOrigin: 'b', opId: 'dup' }] };
    expect(verifyComposite(op, cat)).toEqual({ ok: true, missing: [] });
  });
});

// ── schema validation of Operation.steps / onError ───────────────────

describe('validateManifest — composite Operation.steps / onError', () => {
  const wrap = (op) => validateManifest({
    app: 'a', itemTypes: ['x'], operations: [op],
  });

  it('accepts a well-formed composite op', () => {
    const { ok } = wrap({
      id: 'demo', verb: 'list', onError: 'continue',
      steps: [
        { appOrigin: 'a', opId: 'opA', args: { x: 1 } },
        { appOrigin: 'a', opId: 'opB', argRef: { from: 0, path: 'item.id' } },
      ],
    });
    expect(ok).toBe(true);
  });

  it('rejects empty steps + bad onError + forward argRef', () => {
    expect(wrap({ id: 'a', verb: 'list', steps: [] }).ok).toBe(false);
    expect(wrap({ id: 'a', verb: 'list', steps: [{ appOrigin: 'a', opId: 'x' }], onError: 'rollback' }).ok)
      .toBe(false);
    // argRef.from must point at a PRIOR step (here from:1 on step 0 → invalid)
    expect(wrap({
      id: 'a', verb: 'list',
      steps: [{ appOrigin: 'a', opId: 'x', argRef: { from: 1, path: 'a' } }],
    }).ok).toBe(false);
  });

  it('rejects onError on a non-composite op', () => {
    expect(wrap({ id: 'a', verb: 'list', onError: 'stop' }).ok).toBe(false);
  });
});

// ── runCompositeDispatch + router integration ────────────────────────

describe('runCompositeDispatch — via parse → router', () => {
  it('router emits a composite dispatch; runner fires the chain', async () => {
    const catalog = mergeManifests([
      { manifest: { app: 'demoApp', itemTypes: ['x'], operations: [demoOp] } },
    ]);

    const parse = parseInput('/demo', catalog, { threadId: 't-1' });
    const dispatch = resolveDispatch(parse, catalog);
    expect(dispatch.kind).toBe('composite');

    const calls = [];
    const callSkill = async (appOrigin, opId, args) => {
      calls.push({ appOrigin, opId, args });
      return { ok: true, from: opId };
    };

    const reply = await runCompositeDispatch(dispatch, callSkill);
    expect(reply.error).toBeUndefined();
    expect(reply.shape).toBe('text');
    expect(reply.threadId).toBe('t-1');
    expect(reply.payload).toEqual({ ok: true, from: 'opB' });
    expect(calls.map((c) => c.opId)).toEqual(['opA', 'opB']);
    expect(reply.composite.stats.ok).toBe(2);
  });

  it('surfaces a failing composite as reply.error (stop default)', async () => {
    const catalog = mergeManifests([
      { manifest: { app: 'demoApp', itemTypes: ['x'], operations: [
        { ...demoOp, steps: [
          { appOrigin: 'a', opId: 'opA' },
          { appOrigin: 'b', opId: 'opB' },
        ] },
      ] } },
    ]);
    const parse = parseInput('/demo', catalog, { threadId: 't-2' });
    const dispatch = resolveDispatch(parse, catalog);

    const callSkill = async (appOrigin, opId) =>
      opId === 'opB' ? { ok: false, error: 'nope' } : { ok: true };

    const reply = await runCompositeDispatch(dispatch, callSkill);
    expect(reply.error).toEqual({ code: 'composite-step-error', message: 'nope' });
    expect(reply.payload).toBeNull();
    expect(reply.composite.ok).toBe(false);
  });

  it('rejects a non-composite dispatch', async () => {
    await expect(runCompositeDispatch({ kind: 'ready' }, async () => {}))
      .rejects.toThrow(/expected composite dispatch/);
  });
});
