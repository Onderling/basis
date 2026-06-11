/**
 * canopy-chat — router tests.  v0.1 sub-slice 1.6.
 *
 * Verifies the tagged-union RouteResult shapes for every routing
 * outcome: ready / needsForm / needsConfirm / unknown / error.
 */
import { describe, it, expect } from 'vitest';

import { mergeManifests }  from '../src/manifestMerge.js';
import { parseInput }      from '../src/parser.js';
import { resolveDispatch, scopeReadyDispatch } from '../src/router.js';
import { itemCircleId }    from '../src/v2/circleScope.js';

/* ───── test manifests ───── */

const householdLite = {
  app:       'household',
  itemTypes: ['chore'],
  operations: [
    // No params + no confirm + no Q28 → ready, default shape 'text'
    {
      id: 'doNow', verb: 'add', params: [],
      surfaces: { slash: { command: '/donow' } },
    },
    // verb:'list' → default reply 'list'
    {
      id: 'listOpen', verb: 'list', params: [],
      surfaces: { slash: { command: '/mine' } },
    },
    // _match positional binding target
    {
      id: 'markComplete', verb: 'complete',
      params: [{ name: 'choreText', kind: 'string', required: true }],
      surfaces: { slash: { command: '/done' }, chat: { reply: 'text' } },
    },
    // Required + optional params — triggers needsForm when required missing
    {
      id: 'addChore', verb: 'add',
      params: [
        { name: 'text', kind: 'string', required: true },
        { name: 'due',  kind: 'string', required: false },
      ],
      surfaces: { slash: { command: '/addchore' } },
    },
    // Q27 warn-gate
    {
      id: 'archiveAll', verb: 'remove', params: [],
      surfaces: {
        slash: { command: '/archiveall' },
        ui:    { confirm: { severity: 'warn', message: 'Archive everything?' } },
      },
    },
    // Q27 danger-gate
    {
      id: 'clearInbox', verb: 'remove', params: [],
      surfaces: {
        slash: { command: '/clearinbox' },
        ui:    { confirm: { severity: 'danger', message: 'This cannot be undone.' } },
      },
    },
    // Q27 info — informational only, NO gate
    {
      id: 'reportStats', verb: 'list', params: [],
      surfaces: {
        slash: { command: '/stats' },
        ui:    { confirm: { severity: 'info', message: 'Just FYI.' } },
      },
    },
  ],
  views: [{ id: 'tasks', title: 'Chores', type: 'chore' }],
};

const catalog = mergeManifests([{ manifest: householdLite }]);

/* ───── tests ───── */

describe('resolveDispatch — ready paths', () => {
  it('returns ready for a no-param op', () => {
    const parse = parseInput('/donow', catalog);
    const r = resolveDispatch(parse, catalog);
    expect(r).toEqual({
      kind: 'ready',
      opId: 'doNow',
      args: {},
      appOrigin: 'household',
      threadId:  null,
      replyShape: 'text',   // verb:'add' default
      verb: 'add',          // 5.3 — verb surfaced for scopeReadyDispatch
    });
  });

  it("uses 'list' default shape for verb:'list' (no Q28)", () => {
    const parse = parseInput('/mine', catalog);
    const r = resolveDispatch(parse, catalog);
    expect(r.kind).toBe('ready');
    expect(r.replyShape).toBe('list');
  });

  it('binds _match positional to the first required string param', () => {
    const parse = parseInput('/done dishwasher', catalog);
    const r = resolveDispatch(parse, catalog);
    expect(r).toMatchObject({
      kind: 'ready',
      opId: 'markComplete',
      args: { choreText: 'dishwasher' },
      replyShape: 'text',   // Q28 declared
    });
  });

  it('explicit --flag wins over _match for the same name', () => {
    // Build a slash with body:'flags' for a manual scenario — use addchore
    // with required + optional params, body defaults to 'match'.  Here we
    // emulate the form-flow where the caller supplies a complete args dict.
    // Direct parseResult shape:
    const parse = {
      kind: 'slash',
      opId: 'markComplete',
      args: { choreText: 'explicit', _match: 'positional' },
      threadId: null,
      command: '/done',
      body: 'explicit',
    };
    const r = resolveDispatch(parse, catalog);
    expect(r.kind).toBe('ready');
    expect(r.args.choreText).toBe('explicit');   // explicit wins
    expect(r.args._match).toBeUndefined();        // dropped after bind
  });

  it("passes threadId through from the parse result", () => {
    const parse = parseInput('/donow', catalog, { threadId: 't-99' });
    expect(resolveDispatch(parse, catalog).threadId).toBe('t-99');
  });
});

describe('resolveDispatch — needsForm', () => {
  it('emits needsForm when required params missing', () => {
    const parse = parseInput('/addchore', catalog);
    const r = resolveDispatch(parse, catalog);
    expect(r.kind).toBe('needsForm');
    expect(r.opId).toBe('addChore');
    expect(r.missing).toEqual(['text']);
    expect(r.prefilledArgs).toEqual({});
    expect(Array.isArray(r.params)).toBe(true);
    expect(r.params[0].name).toBe('text');
  });

  it('emits ready (not needsForm) when required param IS bound via _match', () => {
    const parse = parseInput('/done dishwasher', catalog);
    const r = resolveDispatch(parse, catalog);
    expect(r.kind).toBe('ready');
  });

  it('empty-string required param value counts as missing', () => {
    const parse = {
      kind: 'slash', opId: 'addChore',
      args: { text: '' }, threadId: null, command: '/addchore', body: '',
    };
    const r = resolveDispatch(parse, catalog);
    expect(r.kind).toBe('needsForm');
    expect(r.missing).toContain('text');
  });

  it('optional missing → still ready (no form needed)', () => {
    const parse = {
      kind: 'slash', opId: 'addChore',
      args: { text: 'pick up bread' },
      threadId: null, command: '/addchore', body: 'pick up bread',
    };
    const r = resolveDispatch(parse, catalog);
    expect(r.kind).toBe('ready');
    expect(r.args).toEqual({ text: 'pick up bread' });
  });
});

describe('resolveDispatch — Q27 confirm gates', () => {
  it("emits needsConfirm for severity: 'warn'", () => {
    const parse = parseInput('/archiveall', catalog);
    const r = resolveDispatch(parse, catalog);
    expect(r).toMatchObject({
      kind: 'needsConfirm',
      severity: 'warn',
      message: 'Archive everything?',
      opId: 'archiveAll',
      args: {},
      appOrigin: 'household',
    });
  });

  it("emits needsConfirm for severity: 'danger'", () => {
    const parse = parseInput('/clearinbox', catalog);
    const r = resolveDispatch(parse, catalog);
    expect(r.kind).toBe('needsConfirm');
    expect(r.severity).toBe('danger');
    expect(r.message).toBe('This cannot be undone.');
  });

  it("does NOT gate severity: 'info' — goes straight to ready", () => {
    const parse = parseInput('/stats', catalog);
    const r = resolveDispatch(parse, catalog);
    expect(r.kind).toBe('ready');
    expect(r.opId).toBe('reportStats');
  });

  it("needsForm takes precedence over needsConfirm when both apply", () => {
    // Sanity check: if a confirmable op also has missing required params,
    // the form gate fires first (chat shell asks for input before confirm).
    const m = {
      app: 'a', itemTypes: ['t'],
      operations: [{
        id: 'dangerous', verb: 'remove',
        params: [{ name: 'reason', kind: 'string', required: true }],
        surfaces: {
          slash: { command: '/danger' },
          ui:    { confirm: { severity: 'danger', message: 'Sure?' } },
        },
      }],
      views: [],
    };
    const cat = mergeManifests([{ manifest: m }]);
    const parse = parseInput('/danger', cat);
    const r = resolveDispatch(parse, cat);
    expect(r.kind).toBe('needsForm');
  });
});

describe('scopeReadyDispatch — F1 active-circle binding (5.3)', () => {
  const ready = (verb, args = {}) => ({
    kind: 'ready', opId: 'op', appOrigin: 'app', threadId: null,
    replyShape: 'text', verb, args,
  });

  it("injects the active circle as circleId/crewId/groupId/_scope on an 'add' verb", () => {
    const r = scopeReadyDispatch(ready('add', { text: 'buy milk' }), 'circle-1');
    expect(r.args).toEqual({
      text: 'buy milk',
      circleId: 'circle-1', crewId: 'circle-1', groupId: 'circle-1', _scope: 'circle-1',
    });
  });

  it("scopes a 'post' verb too", () => {
    const r = scopeReadyDispatch(ready('post', { body: 'hi' }), 'c2');
    expect(r.args.groupId).toBe('c2');
    expect(r.args._scope).toBe('c2');
  });

  it('the created item carries the circle tag (itemCircleId reads it back)', () => {
    // The substrate persists the scope arg onto the item; itemCircleId
    // resolves it via circleId/crewId/groupId — so a task created with
    // these args belongs to the active circle.
    const r = scopeReadyDispatch(ready('add', { text: 't' }), 'circle-X');
    expect(itemCircleId(r.args)).toBe('circle-X');
  });

  it('does NOT scope a read verb (list)', () => {
    const input = ready('list', { q: 'x' });
    expect(scopeReadyDispatch(input, 'c1')).toBe(input);     // untouched (same ref)
  });

  it("does NOT scope 'create' (a new container must not inherit the open circle)", () => {
    const input = ready('create', { name: 'New crew' });
    expect(scopeReadyDispatch(input, 'c1')).toBe(input);
  });

  it('DOES scope id-targeted mutations to the active circle (multi-pod crew routing)', () => {
    // canopy-chat is multi-pod: a mutation needs the circle's crew/group to FIND its target item,
    // else the wrong crew reports "item not found" (device-verified on `done <task>`).
    for (const v of ['claim', 'complete', 'submit', 'approve', 'reject', 'remove']) {
      const r = scopeReadyDispatch(ready(v, { id: 'task-9' }), 'c1');
      expect(itemCircleId(r.args)).toBe('c1');     // crewId/circleId/groupId now bound to the active circle
      expect(r.args.id).toBe('task-9');            // the target id is preserved
    }
  });

  it('does NOT scope a non-create/mutate verb (e.g. set)', () => {
    const input = ready('set', { id: 'task-9' });
    expect(scopeReadyDispatch(input, 'c1')).toBe(input);   // untouched (same ref)
  });

  it('is a no-op when no circle is active', () => {
    const input = ready('add', { text: 't' });
    expect(scopeReadyDispatch(input, null)).toBe(input);
    expect(scopeReadyDispatch(input, '')).toBe(input);
  });

  it("respects an explicit scope the caller already chose (doesn't override)", () => {
    const input = ready('add', { text: 't', crewId: 'explicit-crew' });
    const r = scopeReadyDispatch(input, 'active-circle');
    expect(r).toBe(input);                  // untouched wholesale
    expect(r.args.crewId).toBe('explicit-crew');
  });

  it('treats an empty-string scope arg as unset → injects', () => {
    const r = scopeReadyDispatch(ready('add', { text: 't', crewId: '' }), 'c1');
    expect(r.args.crewId).toBe('c1');
  });

  it('only touches ready dispatches (needsForm / null pass through)', () => {
    const nf = { kind: 'needsForm', verb: 'add', args: {} };
    expect(scopeReadyDispatch(nf, 'c1')).toBe(nf);
    expect(scopeReadyDispatch(null, 'c1')).toBe(null);
  });

  it('end-to-end: parse → resolveDispatch → scopeReadyDispatch', () => {
    const listRoute = resolveDispatch(parseInput('/mine', catalog), catalog);  // verb 'list'
    expect(scopeReadyDispatch(listRoute, 'c1')).toBe(listRoute);               // read → not scoped

    const addRoute = resolveDispatch(parseInput('/donow', catalog), catalog);  // verb 'add'
    const scoped = scopeReadyDispatch(addRoute, 'circle-7');
    expect(scoped.args.crewId).toBe('circle-7');
    expect(itemCircleId(scoped.args)).toBe('circle-7');
  });
});

describe('resolveDispatch — pass-through + error paths', () => {
  it('returns unknown for unknown parse', () => {
    const parse = parseInput('hello', catalog, { threadId: 't-1' });
    const r = resolveDispatch(parse, catalog);
    expect(r).toEqual({ kind: 'unknown', text: 'hello', threadId: 't-1' });
  });

  it('emits error for unknown opId in a slash parse', () => {
    const parse = {
      kind: 'slash', opId: 'doesNotExist', args: {},
      threadId: 't-2', command: '/x', body: '',
    };
    const r = resolveDispatch(parse, catalog);
    expect(r.kind).toBe('error');
    expect(r.code).toBe('unknown-op');
    expect(r.threadId).toBe('t-2');
  });

  it('throws on null inputs', () => {
    expect(() => resolveDispatch(null, catalog)).toThrow();
    expect(() => resolveDispatch({ kind: 'unknown', text: '' }, null)).toThrow();
  });
});
