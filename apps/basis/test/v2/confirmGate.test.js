/**
 * confirmGate — the shared confirm gate at the dispatch waist.
 *
 * Guards the invariant the 2026-07 fall-through bug violated: an op
 * declaring `surfaces.ui.confirm` (warn/danger) NEVER executes without
 * an explicit confirmation step.  Web `circleApp.dispatchReady` and
 * mobile `runCircleCommandResolved` used to drop `needsConfirm` into
 * the "unknown" bubble, so the declared red confirm never rendered.
 *
 * Fixtures are the REAL manifest's three danger ops (agents:
 * revokeAgent / purgeAgent / restoreDataVersion), merged through the
 * same `mergeManifests` both shells use:
 *   1. complete args → resolveDispatch emits needsConfirm BEFORE any execute
 *   2. accept → executes EXACTLY once, with the confirmed ready dispatch
 *   3. cancel → never executes; the quiet cancel notice fires instead
 *   4. the request model carries the manifest's message + danger severity
 */
import { describe, it, expect, vi } from 'vitest';

import { agentsManifest } from '../../../agents/manifest.js';
import { tasksManifest } from '../../../tasks-v0/manifest.js';
import { mergeManifests } from '../../src/manifestMerge.js';
import { resolveDispatch } from '../../src/router.js';
import { confirmRequestFromRoute, readyFromConfirm, runConfirmGate } from '../../src/v2/confirmGate.js';

const catalogue = mergeManifests([{ manifest: agentsManifest }]);
const t = (k) => k;

/** The three danger ops with COMPLETE args (so needsForm can't front the gate). */
const DANGER_FIXTURES = [
  { opId: 'revokeAgent',        args: { agentId: 'summary-bot' } },
  { opId: 'purgeAgent',         args: { agentId: 'summary-bot' } },
  { opId: 'restoreDataVersion', args: { circleId: 'c1', uri: 'mem://pod/c1/tasks.json', version: '1751880000000' } },
];

function routeFor({ opId, args }) {
  return resolveDispatch({ kind: 'slash', opId, args, command: '(bot)', body: '' }, catalogue);
}

describe('emission — an op with surfaces.ui.confirm + complete args resolves to needsConfirm', () => {
  for (const fx of DANGER_FIXTURES) {
    it(`${fx.opId} → needsConfirm (severity danger, the manifest's message)`, () => {
      const route = routeFor(fx);
      expect(route.kind).toBe('needsConfirm');
      expect(route.severity).toBe('danger');
      const declared = agentsManifest.operations.find((o) => o.id === fx.opId).surfaces.ui.confirm;
      expect(route.message).toBe(declared.message);
      expect(route.args).toEqual(fx.args);
      expect(route.appOrigin).toBe('agents');
    });
  }
});

// The MANDATE (entrust) op routes through the SAME confirm waist: attachTaskGrant
// now declares surfaces.ui.confirm (severity warn, no manifest message → the
// localised default), so issuing a mandate can never bypass the "weet je het
// zeker?" gate. This is the mechanism the entrust picker relies on (2026-07-18).
describe('mandate — attachTaskGrant routes through the confirm waist', () => {
  const tasksCatalogue = mergeManifests([{ manifest: tasksManifest }]);
  const routeMandate = () => resolveDispatch(
    { kind: 'slash', opId: 'attachTaskGrant', args: { taskId: 't1', member: 'ed25519:bob' }, command: '(bot)', body: '' },
    tasksCatalogue,
  );

  it('resolves attachTaskGrant to needsConfirm (severity warn) before any execute', () => {
    const route = routeMandate();
    expect(route.kind).toBe('needsConfirm');
    expect(route.severity).toBe('warn');
    expect(route.opId).toBe('attachTaskGrant');
    expect(route.args).toEqual({ taskId: 't1', member: 'ed25519:bob' });
  });

  it('has no raw manifest message → the gate uses the localised default (invariant #8)', () => {
    const declared = tasksManifest.operations.find((o) => o.id === 'attachTaskGrant').surfaces.ui.confirm;
    expect(declared.message).toBeUndefined();
    const req = confirmRequestFromRoute(routeMandate(), { t });
    expect(req.message).toBe('circle.confirm.default_message');
    expect(req.severity).toBe('warn');
  });

  it('accept → executes exactly once with the confirmed ready dispatch; cancel → never executes', async () => {
    const acceptExec = vi.fn();
    const accepted = await runConfirmGate({ route: routeMandate(), catalogue: tasksCatalogue, t, present: async () => true, execute: acceptExec, onCancelNotice: vi.fn() });
    expect(accepted.executed).toBe(true);
    expect(acceptExec).toHaveBeenCalledTimes(1);
    expect(acceptExec).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ready', opId: 'attachTaskGrant' }));

    const cancelExec = vi.fn();
    const onCancelNotice = vi.fn();
    const cancelled = await runConfirmGate({ route: routeMandate(), catalogue: tasksCatalogue, t, present: async () => false, execute: cancelExec, onCancelNotice });
    expect(cancelled.executed).toBe(false);
    expect(cancelExec).not.toHaveBeenCalled();
    expect(onCancelNotice).toHaveBeenCalledTimes(1);
  });
});

describe('confirmRequestFromRoute — the presentation model', () => {
  it('carries the manifest message + danger severity + localised chrome keys', () => {
    const route = routeFor(DANGER_FIXTURES[0]);
    const req = confirmRequestFromRoute(route, { t });
    expect(req.severity).toBe('danger');
    expect(req.message).toBe(route.message);
    expect(req.title).toBe('circle.confirm.title');
    expect(req.acceptLabel).toBe('circle.confirm.accept');
    expect(req.cancelLabel).toBe('circle.confirm.cancel');
    expect(req.opId).toBe('revokeAgent');
  });

  it('falls back to the localised default message only when the manifest has none', () => {
    const bare = { kind: 'needsConfirm', severity: 'warn', opId: 'x', args: {} };
    expect(confirmRequestFromRoute(bare, { t }).message).toBe('circle.confirm.default_message');
  });

  it('returns null for a non-needsConfirm route', () => {
    expect(confirmRequestFromRoute({ kind: 'ready' }, { t })).toBeNull();
    expect(confirmRequestFromRoute(null, { t })).toBeNull();
  });
});

describe('readyFromConfirm — the explicit-accept continuation', () => {
  it('re-tags the confirmed route ready, args + appOrigin + replyShape intact, verb from the catalogue', () => {
    const route = routeFor(DANGER_FIXTURES[1]);
    const ready = readyFromConfirm(route, catalogue);
    expect(ready).toEqual({
      kind: 'ready',
      opId: 'purgeAgent',
      args: { agentId: 'summary-bot' },
      appOrigin: 'agents',
      threadId: null,
      replyShape: route.replyShape,
      verb: 'remove',   // looked up so scopeReadyDispatch keeps scoping mutations
    });
  });

  it('rejects a non-needsConfirm route (the gate cannot be skipped by mislabeling)', () => {
    expect(() => readyFromConfirm({ kind: 'ready' }, catalogue)).toThrow(TypeError);
  });
});

describe('runConfirmGate — accept executes exactly once; cancel never executes', () => {
  for (const fx of DANGER_FIXTURES) {
    it(`${fx.opId}: accept → execute exactly once with the confirmed ready dispatch`, async () => {
      const route = routeFor(fx);
      const execute = vi.fn();
      const onCancelNotice = vi.fn();
      const r = await runConfirmGate({ route, catalogue, t, present: async () => true, execute, onCancelNotice });
      expect(r.executed).toBe(true);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ready', opId: fx.opId, args: fx.args }));
      expect(onCancelNotice).not.toHaveBeenCalled();
    });

    it(`${fx.opId}: cancel → never executes; quiet notice fires`, async () => {
      const route = routeFor(fx);
      const execute = vi.fn();
      const onCancelNotice = vi.fn();
      const r = await runConfirmGate({ route, catalogue, t, present: async () => false, execute, onCancelNotice });
      expect(r.executed).toBe(false);
      expect(execute).not.toHaveBeenCalled();
      expect(onCancelNotice).toHaveBeenCalledTimes(1);
    });
  }

  it('a throwing presenter counts as cancel (a broken dialog must never execute)', async () => {
    const route = routeFor(DANGER_FIXTURES[0]);
    const execute = vi.fn();
    const onCancelNotice = vi.fn();
    const r = await runConfirmGate({
      route, catalogue, t, present: async () => { throw new Error('boom'); }, execute, onCancelNotice,
    });
    expect(r.executed).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(onCancelNotice).toHaveBeenCalledTimes(1);
  });

  it('requires a needsConfirm route — a ready route cannot ride the gate', async () => {
    await expect(runConfirmGate({ route: { kind: 'ready' }, present: async () => true, execute: vi.fn() }))
      .rejects.toThrow(TypeError);
  });
});
