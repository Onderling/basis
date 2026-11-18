/**
 * The lend rows gate the lend ops (ledger L1040).
 *
 * @guard every op is gated by exactly one capability row, and every row gates at least one op
 *
 * Found (2026-11-18): a loan is an `offer` of kind `lend`; `markReturned` (complete) and `assignLend` (reassign)
 * declare `appliesTo { type: 'offer', kind: 'lend' }`, and the pinboard manifest declares the noun `lend` with
 * complete / reassign / remove. The gate resolved the two ops to `offer`, whose rows have no complete or reassign,
 * so a typed "returned" was refused in every circle, while the lend rows (the switches a circle sees) gated
 * nothing. A kind is an op's noun when its manifest DECLARES that noun, decided by the declaration, never by which
 * keys happen to be on.
 */
import { describe, it, expect } from 'vitest';
import { effectiveCapabilities, checkCapability, capabilityKey } from '../../src/v2/capabilityGate.js';
import { capabilitiesOf } from '@onderling/app-manifest';
import { pinboardManifest } from '../../../pinboard/manifest.js';
import { tasksManifest } from '../../../tasks-v0/manifest.js';

const sources = [{ manifest: pinboardManifest, appOrigin: 'pinboard' }];
const op = (m, id) => m.operations.find((o) => o.id === id);

describe('the lend rows gate the lend ops', () => {
  it('by default, markReturned and assignLend pass, each through its own lend row', () => {
    const eff = effectiveCapabilities(sources, { apps: null });
    expect(checkCapability({ op: op(pinboardManifest, 'markReturned'), appOrigin: 'pinboard', args: {} }, eff))
      .toEqual({ allow: true, capability: 'pinboard complete lend' });
    expect(checkCapability({ op: op(pinboardManifest, 'assignLend'), appOrigin: 'pinboard', args: {} }, eff))
      .toEqual({ allow: true, capability: 'pinboard reassign lend' });
  });

  it('a circle that switches off complete on lend refuses markReturned (and not assignLend)', () => {
    const eff = effectiveCapabilities(sources, { apps: null, capabilities: { [capabilityKey('pinboard', 'complete', 'lend')]: { enabled: false } } });
    expect(checkCapability({ op: op(pinboardManifest, 'markReturned'), appOrigin: 'pinboard', args: {} }, eff).allow).toBe(false);
    expect(checkCapability({ op: op(pinboardManifest, 'assignLend'), appOrigin: 'pinboard', args: {} }, eff).allow).toBe(true);
  });

  it('the lend rows name the ops that serve them: no row is a switch that switches nothing', () => {
    const lend = capabilitiesOf(pinboardManifest).filter((c) => c.noun === 'lend');
    expect(lend.find((c) => c.atom === 'complete')?.opId).toBe('markReturned');
    expect(lend.find((c) => c.atom === 'reassign')?.opId).toBe('assignLend');
  });

  it('a kind no manifest declares as a noun leaves the op on its type (tasks\' inbox items)', () => {
    const tasksSources = [{ manifest: tasksManifest, appOrigin: 'tasks' }];
    const eff = effectiveCapabilities(tasksSources, { apps: null });
    const r = checkCapability({ op: op(tasksManifest, 'approveSubtaskRequest'), appOrigin: 'tasks', args: {} }, eff);
    expect(r.capability ?? '').not.toMatch(/subtask-request/);
  });
});
