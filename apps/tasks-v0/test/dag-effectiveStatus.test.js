/**
 * effectiveStatus — lifecycle ∪ DAG status for the listOpen skill.
 *
 * Phase 41.18 follow-up (2026-05-10).
 *
 * Repro: a claimed task (item.assignee set) was being rendered as
 * 'ready' on mobile because the listOpen skill replaced the
 * substrate's lifecycle status with the DAG-only `computeStatus`
 * (which only emits 'ready' / 'waiting' / 'blocked'). The web app
 * patched it client-side in `apps/tasks-v0/web/app.js`'s
 * `effectiveStatus`; mobile didn't, so claimed tasks kept showing
 * up under the 'ready' filter.
 *
 * Fix: lift the same logic into `dag.js` and use it in the skill.
 * The skill now returns the right status for both desktop + mobile.
 */

import { describe, it, expect } from 'vitest';
import { effectiveStatus, computeStatus, unmetDeps } from '../src/dag.js';

const ANNE = 'webid://anne';

describe('dag.effectiveStatus', () => {
  it('falls back to DAG status when item has no assignee / reviewLog / completedAt', () => {
    const task = { id: 't1' };
    expect(effectiveStatus(task, [task], [])).toBe('ready');

    const dep = { id: 'dep' };
    const dependent = { id: 't2', dependencies: ['dep'] };
    expect(effectiveStatus(dependent, [dep, dependent], [])).toBe('waiting');
  });

  it('returns "claimed" when assignee is set', () => {
    const task = { id: 't1', assignee: ANNE };
    expect(effectiveStatus(task, [task], [])).toBe('claimed');
  });

  it('an EXPLICIT-confirm task with an unratified claim reads as "pending-confirmation"', () => {
    const pending = { id: 't1', assignee: ANNE, claimConfirmation: 'explicit' };
    expect(effectiveStatus(pending, [pending], [])).toBe('pending-confirmation');
    // once confirmed it is a normal claim; an AUTO task is claimed the moment it has an assignee.
    const confirmed = { id: 't2', assignee: ANNE, claimConfirmation: 'explicit', confirmedAssignee: ANNE };
    expect(effectiveStatus(confirmed, [confirmed], [])).toBe('claimed');
    const auto = { id: 't3', assignee: ANNE };  // default = auto
    expect(effectiveStatus(auto, [auto], [])).toBe('claimed');
  });

  it('a PROVISIONAL subtask reads as "provisional"', () => {
    const prov = { id: 't1', assignee: ANNE, provisional: true };
    expect(effectiveStatus(prov, [prov], [])).toBe('provisional');
  });

  it('returns "submitted" when last reviewLog entry is submit', () => {
    const task = {
      id: 't1', assignee: ANNE,
      reviewLog: [{ decision: 'submit', at: 1 }],
    };
    expect(effectiveStatus(task, [task], [])).toBe('submitted');
  });

  it('returns "rejected" when last reviewLog entry is reject', () => {
    const task = {
      id: 't1', assignee: ANNE,
      reviewLog: [{ decision: 'submit', at: 1 }, { decision: 'reject', at: 2 }],
    };
    expect(effectiveStatus(task, [task], [])).toBe('rejected');
  });

  it('returns "submitted" again on resubmit (latest entry wins)', () => {
    const task = {
      id: 't1', assignee: ANNE,
      reviewLog: [
        { decision: 'submit', at: 1 },
        { decision: 'reject', at: 2 },
        { decision: 'submit', at: 3 },
      ],
    };
    expect(effectiveStatus(task, [task], [])).toBe('submitted');
  });

  it('completedAt wins over everything', () => {
    const task = {
      id: 't1', assignee: ANNE,
      reviewLog: [{ decision: 'submit', at: 1 }, { decision: 'approve', at: 2 }],
      completedAt: 3,
    };
    expect(effectiveStatus(task, [task], [])).toBe('complete');
  });

  it('after revoke (assignee cleared) falls through to DAG status', () => {
    // Substrate clears assignee on revoke; reviewLog keeps the entry
    // but effectiveStatus only acts on submit/reject. Revoked items
    // become 'ready' again so somebody else can claim them.
    const task = {
      id: 't1', assignee: null,
      reviewLog: [{ decision: 'revoke', at: 1, note: 'gone' }],
    };
    expect(effectiveStatus(task, [task], [])).toBe('ready');
  });

  it('does not break computeStatus back-compat', () => {
    const task = { id: 't1', dependencies: ['missing'] };
    // No open / closed contains 'missing' → blocked.
    expect(computeStatus(task, [task], [])).toBe('blocked');
    expect(effectiveStatus(task, [task], [])).toBe('blocked');
  });
});

describe('dag.unmetDeps', () => {
  it('returns [] for a task with no dependencies', () => {
    expect(unmetDeps({ id: 't1' }, [], [])).toEqual([]);
    expect(unmetDeps({ id: 't1', dependencies: [] }, [], [])).toEqual([]);
  });

  it('returns dep ids that are NOT in closedItems', () => {
    const dep1 = { id: 'd1' };  // open
    const dep2 = { id: 'd2' };  // closed (in closed list)
    const task = { id: 't1', dependencies: ['d1', 'd2', 'd3'] };
    // 'd3' isn't in either list → still unmet (not closed).
    expect(unmetDeps(task, [dep1, task], [dep2])).toEqual(['d1', 'd3']);
  });

  it('returns empty when all deps are closed', () => {
    const dep1 = { id: 'd1' };
    const dep2 = { id: 'd2' };
    const task = { id: 't1', dependencies: ['d1', 'd2'] };
    expect(unmetDeps(task, [task], [dep1, dep2])).toEqual([]);
  });

  it('matches the V2.7 hard-deps gate — claimed-but-deps-open still has openDeps', () => {
    // The lifecycle status wins over DAG (effectiveStatus → 'claimed'),
    // but unmetDeps still surfaces the open IDs for the UI to gate on.
    const dep = { id: 'd1' };
    const task = {
      id: 't1', assignee: 'webid://anne', dependencies: ['d1'],
    };
    expect(effectiveStatus(task, [dep, task], [])).toBe('claimed');
    expect(unmetDeps(task, [dep, task], [])).toEqual(['d1']);
  });
});
