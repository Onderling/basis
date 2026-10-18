import { describe, it, expect } from 'vitest';
import {
  REFRESHABLE_VERBS, panelMatchesItemRef, itemRefFromReply, collectStalePanels,
} from '../src/panelRefresh.js';

const REF = { app: 'tasks', type: 'task', id: 'task-9' };

describe('panelRefresh · REFRESHABLE_VERBS', () => {
  it('includes the read verbs, excludes mutations', () => {
    for (const v of ['list', 'get', 'view', 'record', 'find', 'brief']) {
      expect(REFRESHABLE_VERBS.has(v)).toBe(true);
    }
    for (const v of ['add', 'create', 'update', 'delete', 'claim', 'do']) {
      expect(REFRESHABLE_VERBS.has(v)).toBe(false);
    }
  });
});

describe('panelRefresh · panelMatchesItemRef', () => {
  it('matches a record / mini-page panel by payload id + type', () => {
    expect(panelMatchesItemRef({ kind: 'record', payload: { id: 'task-9', type: 'task' } }, REF)).toBe(true);
    expect(panelMatchesItemRef({ kind: 'mini-page', payload: { id: 'task-9', type: 'task' } }, REF)).toBe(true);
  });
  it('matches an embed-card panel by embed.itemRef', () => {
    expect(panelMatchesItemRef({ kind: 'embed-card', embed: { itemRef: { app: 'tasks', type: 'task', id: 'task-9' } } }, REF)).toBe(true);
  });
  it('rejects a different id / type / kind', () => {
    expect(panelMatchesItemRef({ kind: 'record', payload: { id: 'other', type: 'task' } }, REF)).toBe(false);
    expect(panelMatchesItemRef({ kind: 'record', payload: { id: 'task-9', type: 'note' } }, REF)).toBe(false);
    expect(panelMatchesItemRef({ kind: 'list', items: [] }, REF)).toBe(false);
    expect(panelMatchesItemRef(null, REF)).toBe(false);
    expect(panelMatchesItemRef({ kind: 'record', payload: { id: 'x' } }, null)).toBe(false);
  });
});

describe('panelRefresh · itemRefFromReply', () => {
  it('derives {app,type,id} from a mutation reply payload', () => {
    expect(itemRefFromReply({ payload: { id: 'task-9', type: 'task' } }, 'tasks'))
      .toEqual({ app: 'tasks', type: 'task', id: 'task-9' });
  });
  it('reads itemId + payload.app aliases', () => {
    expect(itemRefFromReply({ payload: { itemId: 'p-2', app: 'pinboard' } }))
      .toEqual({ app: 'pinboard', type: null, id: 'p-2' });
  });
  it('returns null for item-less / non-object / array payloads', () => {
    expect(itemRefFromReply({ payload: { ok: true } })).toBeNull();
    expect(itemRefFromReply({ payload: 'text' })).toBeNull();
    expect(itemRefFromReply({ payload: [1, 2] })).toBeNull();
    expect(itemRefFromReply(null)).toBeNull();
  });
});

describe('panelRefresh · collectStalePanels', () => {
  const threads = () => [
    { id: 'A', messages: [
      { messageId: 'a1', lifecycleState: 'live', rendered: { kind: 'record', payload: { id: 'task-9', type: 'task' } }, sourceDispatch: { opId: 'getTask' } },
    ] },
    { id: 'B', messages: [
      { messageId: 'b1', lifecycleState: 'live', rendered: { kind: 'record', payload: { id: 'task-9', type: 'task' } }, sourceDispatch: { opId: 'addTask' } },  // mutation source
      { messageId: 'b2', lifecycleState: 'live', rendered: { kind: 'text', text: 'hi' } },
    ] },
    { id: 'T', messages: [   // the dispatching thread — excluded
      { messageId: 't1', lifecycleState: 'live', rendered: { kind: 'record', payload: { id: 'task-9', type: 'task' } }, sourceDispatch: { opId: 'getTask' } },
    ] },
  ];
  const isRefreshable = (opId) => REFRESHABLE_VERBS.has({ getTask: 'get', addTask: 'add' }[opId]);

  it('collects matching read-sourced panels across threads, excluding the dispatching one', () => {
    const got = collectStalePanels(threads(), { itemRef: REF, excludeThreadId: 'T', isRefreshable });
    expect(got.map((g) => `${g.threadId}/${g.message.messageId}`)).toEqual(['A/a1']);
  });

  it('without an isRefreshable gate, includes mutation-sourced panels too', () => {
    const got = collectStalePanels(threads(), { itemRef: REF, excludeThreadId: 'T' });
    expect(got.map((g) => g.message.messageId).sort()).toEqual(['a1', 'b1']);
  });

  it('skips non-live panels + panels with no source', () => {
    const got = collectStalePanels([
      { id: 'A', messages: [
        { messageId: 'closed', lifecycleState: 'disabled', rendered: { kind: 'record', payload: { id: 'task-9', type: 'task' } }, sourceDispatch: { opId: 'getTask' } },
        { messageId: 'nosrc', lifecycleState: 'live', rendered: { kind: 'record', payload: { id: 'task-9', type: 'task' } } },
      ] },
    ], { itemRef: REF });
    expect(got).toEqual([]);
  });

  it('returns [] for a null itemRef or non-array threads', () => {
    expect(collectStalePanels(threads(), { itemRef: null })).toEqual([]);
    expect(collectStalePanels(null, { itemRef: REF })).toEqual([]);
  });
});
