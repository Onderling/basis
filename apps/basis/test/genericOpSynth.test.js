/**
 * basis — §1b: catalogue synthesis of GENERIC (op-less) capabilities.
 *
 * "Declare a noun → get CRUD free": a manifest can declare a noun with CRUD atoms and NO implementing op.
 * `synthesizeGenericOps` + `mergeManifests` turn each such op-less capability into a SYNTHETIC catalogue op
 * so the EXISTING projectors carry it unchanged:
 *   - it lands in `catalogue.opsById` under `__generic__:<app>:<atom>:<noun>` with `verb` + `appliesTo.type`
 *     (so the op-keyed gate authorises it by (atom × noun) with no gate change),
 *   - `renderSlash` matches its slash form (`/add-note` → `{ body }`),
 *   - `buildToolDescriptors` mints an LLM tool for it,
 *   - a real op is NEVER shadowed, and a manifest with no op-less caps adds nothing.
 */
import { describe, it, expect } from 'vitest';

import { mergeManifests }        from '../src/manifestMerge.js';
import { synthesizeGenericOps }  from '../src/genericOpSynth.js';
import { buildToolDescriptors }  from '../src/v2/interpretCommand.js';
import { renderSlash, encodeGenericOpId } from '@onderling/app-manifest';

// A manifest mirroring household's `note`: an op-less noun (declare a noun → get CRUD free) declaring the
// four CRUD atoms with NO implementing op, PLUS a `task` noun that DOES have a bespoke `addTask` op.
const notesApp = {
  app:       'notes',
  itemTypes: ['note', 'task'],
  nouns: {
    note: { atoms: ['add', 'list', 'get', 'remove'] },   // op-less → synthesized
    task: { atoms: ['add'] },                              // implemented by addTask → NOT synthesized
  },
  operations: [
    {
      id: 'addTask', verb: 'add', appliesTo: { type: 'task' },
      params: [{ name: 'text', kind: 'string', required: true }],
      surfaces: { slash: { command: '/addtask', match: { verbs: ['add'], body: 'text-only' } },
                  chat: { hint: 'add a task' } },
    },
  ],
  views: [{ id: 'v', title: 'V', type: 'note' }],
};

// A manifest with NO op-less capabilities (every declared atom is implemented) — synthesis must add nothing.
const plainApp = {
  app:       'plain',
  itemTypes: ['chore'],
  operations: [
    { id: 'markComplete', verb: 'complete', appliesTo: { type: 'chore' }, params: [],
      surfaces: { slash: { command: '/done' }, chat: { hint: 'mark a chore complete' } } },
  ],
  views: [{ id: 'v', title: 'V', type: 'chore' }],
};

describe('synthesizeGenericOps — the pure helper', () => {
  it('emits one synthetic op per op-less capability, none for implemented ones', () => {
    const ops = synthesizeGenericOps(notesApp);
    const ids = ops.map((o) => o.id).sort();
    expect(ids).toEqual([
      '__generic__:notes:add:note',
      '__generic__:notes:get:note',
      '__generic__:notes:list:note',
      '__generic__:notes:remove:note',
    ]);
    // The implemented (task × add) capability is NOT synthesized.
    expect(ids).not.toContain('__generic__:notes:add:task');
  });

  it('the add op carries verb + appliesTo.type + slash + chat hint + a body param', () => {
    const add = synthesizeGenericOps(notesApp).find((o) => o.id === '__generic__:notes:add:note');
    expect(add.verb).toBe('add');
    expect(add.appliesTo).toEqual({ type: 'note' });
    expect(add.__generic).toEqual({ app: 'notes', atom: 'add', noun: 'note' });
    expect(add.surfaces.slash.command).toBe('/add-note');
    expect(add.surfaces.slash.match).toEqual({ verbs: ['add'], body: 'text-only', arg: 'body' });
    expect(add.surfaces.chat.hint).toBe('add a note');
    expect(add.params).toEqual([{ name: 'body', kind: 'string', required: true }]);
  });

  it('binds reference atoms (get/remove) to `id`, and list to no positional', () => {
    const ops = synthesizeGenericOps(notesApp);
    const get    = ops.find((o) => o.id === '__generic__:notes:get:note');
    const remove = ops.find((o) => o.id === '__generic__:notes:remove:note');
    const list   = ops.find((o) => o.id === '__generic__:notes:list:note');
    expect(get.surfaces.slash.match).toEqual({ verbs: ['get'], body: 'text-only', arg: 'id' });
    expect(remove.surfaces.slash.match).toEqual({ verbs: ['remove'], body: 'text-only', arg: 'id' });
    expect(list.surfaces.slash.match).toEqual({ verbs: ['list'], body: 'none' });
    expect(list.params).toEqual([]);
  });

  it('is inert for a manifest with no op-less capabilities', () => {
    expect(synthesizeGenericOps(plainApp)).toEqual([]);
  });
});

describe('mergeManifests — synthetic generic ops in the catalogue', () => {
  it('adds each op-less capability to opsById under its generic id', () => {
    const cat = mergeManifests([{ manifest: notesApp }]);
    const entry = cat.opsById.get(encodeGenericOpId('notes', 'add', 'note'));
    expect(entry).toBeDefined();
    expect(entry.appOrigin).toBe('notes');
    expect(entry.op.verb).toBe('add');
    expect(entry.op.appliesTo).toEqual({ type: 'note' });
    expect(entry.op.surfaces.chat.hint).toBe('add a note');
    // all four note atoms present.
    for (const atom of ['add', 'list', 'get', 'remove']) {
      expect(cat.opsById.has(encodeGenericOpId('notes', atom, 'note'))).toBe(true);
    }
  });

  it('surfaces the synthetic slash command in commandMenu', () => {
    const cat = mergeManifests([{ manifest: notesApp }]);
    const byCmd = Object.fromEntries(cat.commandMenu.map((e) => [e.command, e]));
    expect(byCmd['/add-note']).toEqual({
      command: '/add-note', opId: '__generic__:notes:add:note', appOrigin: 'notes',
    });
  });

  it('NEVER shadows a real op — the implemented (task × add) keeps addTask, no generic twin', () => {
    const cat = mergeManifests([{ manifest: notesApp }]);
    expect(cat.opsById.has('addTask')).toBe(true);
    expect(cat.opsById.has(encodeGenericOpId('notes', 'add', 'task'))).toBe(false);
  });

  it('a manifest with no op-less caps adds nothing (no __generic__ keys)', () => {
    const cat = mergeManifests([{ manifest: plainApp }]);
    const keys = [...cat.opsById.keys()];
    expect(keys).toEqual(['markComplete']);
    expect(keys.some((k) => k.startsWith('__generic__'))).toBe(false);
    expect(cat.commandMenu.some((e) => e.opId.startsWith('__generic__'))).toBe(false);
    // byte-identical to merging the SAME manifest and stripping any synthetic ops (there are none).
    expect(cat.warnings).toEqual([]);
  });
});

describe('projectors surface the synthetic op', () => {
  it('renderSlash parses /add-note into the synthetic op-id + body arg', () => {
    // Project the synthetic ops as a manifest surface and parse free text.
    const parser = renderSlash({ operations: synthesizeGenericOps(notesApp) });
    expect(parser.parse('add buy milk')).toEqual({
      skillId: '__generic__:notes:add:note', args: { body: 'buy milk' },
    });
    // reference atom binds to id.
    expect(parser.parse('remove abc123')).toEqual({
      skillId: '__generic__:notes:remove:note', args: { id: 'abc123' },
    });
  });

  it('buildToolDescriptors mints an LLM tool for the synthetic op', () => {
    const cat   = mergeManifests([{ manifest: notesApp }]);
    const tools = buildToolDescriptors(cat);
    const byId  = Object.fromEntries(tools.map((t) => [t.id, t]));
    const add   = byId['__generic__:notes:add:note'];
    expect(add).toBeDefined();
    expect(add.description).toBe('add a note');
    expect(add.schema.properties.body).toEqual({ type: 'string' });
    expect(add.schema.required).toEqual(['body']);
    // the real op is a tool too; no generic twin for the implemented capability.
    expect(byId['addTask']).toBeDefined();
    expect(byId['__generic__:notes:add:task']).toBeUndefined();
  });
});
