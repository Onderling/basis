/**
 * The enroll-device flow's first step keeps an add-device OFFER handed in (Me → Scan read another device's code) — a
 * declared op, `stashEnrollOffer`, not a shell callback (2026-10-09). Without an offer the flow goes straight to the
 * phrase, as it always has; the ceremony step's id is unchanged (every shell reads `steps.ceremony`).
 */
import { describe, it, expect, vi } from 'vitest';
import { createFlowRunner, verifyFlow } from '@onderling/app-manifest';
import householdManifest from '../../household/manifest.js';

const FLOW = householdManifest.flows.find((f) => f.id === 'enroll-device');
const OPS = new Map(householdManifest.operations.map((o) => [o.id, o]));

function runnerWith(stashReply) {
  const callSkill = vi.fn(async (opId) => (opId === 'stashEnrollOffer' ? stashReply : { ok: true, outcome: 'ok' }));
  return { callSkill, runner: createFlowRunner({ ops: OPS, callSkill }) };
}

describe('enroll-device: an offer is stashed first, by a declared op', () => {
  it('the declaration still verifies', () => {
    expect(verifyFlow(FLOW, { ops: OPS }).problems ?? []).toEqual([]);
  });
  it('with an offer: stash → then the phrase (the ceremony awaits its input)', async () => {
    const { callSkill, runner } = runnerWith({ ok: true, outcome: 'stashed' });
    const inst = await runner.start(FLOW, { needs: { offer: 'onderling-enroll://abc' } });
    expect(callSkill).toHaveBeenCalledWith('stashEnrollOffer', { offer: 'onderling-enroll://abc' });
    expect(inst.status).toBe('awaiting-input');
    expect(inst.awaiting.step).toBe('ceremony');
  });
  it('without an offer: no-offer → the phrase, as before', async () => {
    const { callSkill, runner } = runnerWith({ ok: true, outcome: 'no-offer' });
    const inst = await runner.start(FLOW, {});
    expect(callSkill).toHaveBeenCalledWith('stashEnrollOffer', {});
    expect(inst.awaiting?.step).toBe('ceremony');
  });
  it('an unreadable offer ends the flow there — no ceremony on a code that did not parse', async () => {
    const { runner } = runnerWith({ ok: false, outcome: 'bad-offer' });
    const inst = await runner.start(FLOW, { needs: { offer: 'garbage' } });
    expect(inst.awaiting).toBeUndefined();
    expect(inst.steps?.ceremony).toBeUndefined();
  });
  it('the op is never delegable (withheld beside its siblings)', async () => {
    const { NEVER_DELEGABLE } = await import('../../../packages/app-manifest/src/renderA2A.js');
    expect(NEVER_DELEGABLE.has('household.stashEnrollOffer')).toBe(true);
  });
});
