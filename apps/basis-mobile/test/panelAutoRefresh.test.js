/**
 * panelAutoRefresh — E3 mobile record-panel auto-refresh orchestration.
 *
 * After a mutation, every open record/mini-page/embed panel in OTHER
 * threads showing the changed item should re-fetch.  Selection uses the
 * shared `collectStalePanels`; re-running uses `refreshList` (mocked
 * here so the test stays fast + focused on the orchestration).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/core/refreshList.js', () => ({
  refreshList: vi.fn(async ({ sourceDispatch }) => ({
    kind: 'record', messageId: `fresh-${sourceDispatch.opId}`,
    payload: { id: 'task-9', type: 'task', title: 'NEW' },
  })),
}));

import { refreshList } from '../src/core/refreshList.js';
import { autoRefreshStalePanels } from '../src/core/panelAutoRefresh.js';

const catalogue = {
  opsById: new Map([
    ['getTask', { op: { verb: 'get' } }],   // read → refreshable
    ['addTask', { op: { verb: 'add' } }],   // mutation → not refreshable
  ]),
};
const REF = { app: 'tasks', type: 'task', id: 'task-9' };

function recordMsg(id, opId) {
  return {
    id, lifecycleState: 'live',
    rendered: { kind: 'record', messageId: `r-${id}`, payload: { id: 'task-9', type: 'task', title: 'OLD' } },
    sourceDispatch: { kind: 'ready', opId, appOrigin: 'tasks', args: { id: 'task-9' } },
  };
}

function threads() {
  return [
    { id: 'A', messages: [recordMsg('a1', 'getTask')] },               // read panel → refresh
    { id: 'B', messages: [recordMsg('b1', 'addTask')] },               // mutation panel → skip
    { id: 'T', messages: [recordMsg('t1', 'getTask')] },               // dispatching thread → excluded
    { id: 'C', messages: [{ id: 'c1', lifecycleState: 'live', rendered: { kind: 'text', text: 'hi' } }] },
  ];
}

describe('autoRefreshStalePanels', () => {
  it('refreshes only read-sourced matching panels in non-dispatching threads', async () => {
    refreshList.mockClear();
    const applied = [];
    const n = await autoRefreshStalePanels({
      itemRef: REF, threads: threads(), excludeThreadId: 'T',
      catalogue, manifestsByOrigin: {}, callSkill: vi.fn(), t: (k) => k,
      applyRefresh: (tid, mid, fresh) => applied.push({ tid, mid, kind: fresh.kind }),
    });
    expect(n).toBe(1);
    expect(applied).toEqual([{ tid: 'A', mid: 'a1', kind: 'record' }]);
    expect(refreshList).toHaveBeenCalledTimes(1);
    // mutation-sourced panel (B) + dispatching thread (T) never re-ran.
    expect(refreshList.mock.calls[0][0].sourceDispatch.opId).toBe('getTask');
  });

  it('preserves the original messageId on the fresh render', async () => {
    refreshList.mockClear();
    const applied = [];
    await autoRefreshStalePanels({
      itemRef: REF, threads: [{ id: 'A', messages: [recordMsg('a1', 'getTask')] }],
      catalogue, manifestsByOrigin: {}, callSkill: vi.fn(), t: (k) => k,
      applyRefresh: (tid, mid, fresh) => applied.push({ mid, msgId: fresh.messageId }),
    });
    expect(applied[0]).toEqual({ mid: 'a1', msgId: 'r-a1' });
  });

  it('does nothing for a null itemRef or missing applyRefresh', async () => {
    expect(await autoRefreshStalePanels({ itemRef: null, threads: threads(), catalogue, applyRefresh: () => {} })).toBe(0);
    expect(await autoRefreshStalePanels({ itemRef: REF, threads: threads(), catalogue })).toBe(0);
  });

  it('skips a panel whose refreshList re-run fails (returns null)', async () => {
    refreshList.mockClear();
    refreshList.mockResolvedValueOnce(null);
    const applied = [];
    const n = await autoRefreshStalePanels({
      itemRef: REF, threads: [{ id: 'A', messages: [recordMsg('a1', 'getTask')] }],
      catalogue, manifestsByOrigin: {}, callSkill: vi.fn(), t: (k) => k,
      applyRefresh: (tid, mid) => applied.push(mid),
    });
    expect(n).toBe(0);
    expect(applied).toEqual([]);
  });
});
