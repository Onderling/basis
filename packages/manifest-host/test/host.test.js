/**
 * V0 — `@onderling/manifest-host` unit tests.
 *
 * Synthetic manifests inline (no cross-app coupling) — by design, V0 must
 * not depend on any app being checked in.  Coverage:
 *
 *   - mount validation (appId hygiene, manifest validation, dup detection)
 *   - list / unmount
 *   - compose: namespaced tool ids, namespaced toolHandlers, commandMenu
 *     with appId, collision detection, inlineKeyboardFor re-prefixing,
 *     perAppSystemPrompts keyed per app
 *   - runtime mount → compose → unmount → compose cycle (no stale cache)
 *   - dispatch via namespaced toolHandler reaches the right skill
 */

import { describe, it, expect } from 'vitest';

import { createManifestHost } from '../src/ManifestHost.js';

/* ─── synthetic manifests ────────────────────────────────────────────── */

const householdLike = {
  app: 'household',
  systemPrompt: 'You are the household assistant.',
  itemTypes: ['task'],
  operations: [
    {
      id:     'addItem',
      verb:   'add',
      params: [{ name: 'text', kind: 'string', required: true }],
      surfaces: {
        chat:  { hint: 'Add an item' },
        slash: { command: '/add', body: { kind: 'text-only' } },
      },
    },
    {
      id:        'doneItem',
      verb:      'done',  // non-canonical (F-SP1-e)
      appliesTo: { type: 'task', state: 'open' },
      params:    [{ name: 'itemId', kind: 'string', required: true }],
      surfaces:  {
        chat: { hint: 'Mark item done' },
        ui:   { control: 'button', label: 'Done' },
      },
    },
  ],
};

const tasksLike = {
  app: 'tasks',
  systemPrompt: 'You are the tasks-v0 assistant.',
  itemTypes: ['task'],
  operations: [
    {
      id:     'addTask',
      verb:   'add',
      params: [{ name: 'text', kind: 'string', required: true }],
      surfaces: {
        chat:  { hint: 'Add a task' },
        slash: { command: '/add', body: { kind: 'text-only' } },  // collides with household
      },
    },
    {
      id:        'claim',
      verb:      'claim',
      appliesTo: { type: 'task', state: 'open' },
      params:    [{ name: 'taskId', kind: 'string', required: true }],
      surfaces:  {
        chat: { hint: 'Claim a task' },
        ui:   { control: 'button', label: 'Claim' },
      },
    },
    {
      id:        'approve',
      verb:      'approve',
      appliesTo: { type: 'task', state: ['submitted'] },  // F-SP3-a array
      params:    [{ name: 'taskId', kind: 'string', required: true }],
      surfaces:  {
        chat: { hint: 'Approve a task' },
        ui:   { control: 'button', label: 'Approve' },
      },
    },
  ],
};

/** Build a per-op stub skill registry that echoes back its op id. */
function stubRegistry(manifest) {
  const out = {};
  for (const op of manifest.operations) {
    out[op.id] = async (args /*, ctx */) => ({
      replies:      [{ kind: 'text', text: `${op.id}:${args?.text ?? args?.taskId ?? args?.itemId ?? ''}` }],
      stateUpdates: [],
    });
  }
  return out;
}

/* ─── tests ──────────────────────────────────────────────────────────── */

describe('createManifestHost', () => {
  it('list() is empty on a fresh host', () => {
    const host = createManifestHost();
    expect(host.list()).toEqual([]);
  });

  describe('mount validation', () => {
    it('rejects appId containing "."', () => {
      const host = createManifestHost();
      expect(() => host.mount('foo.bar', householdLike, {
        skillRegistry: stubRegistry(householdLike),
        toSkillCtx:    (c) => c,
      })).toThrow(/must not contain "\." or ":"/);
    });

    it('rejects appId containing ":"', () => {
      const host = createManifestHost();
      expect(() => host.mount('foo:bar', householdLike, {
        skillRegistry: stubRegistry(householdLike),
        toSkillCtx:    (c) => c,
      })).toThrow(/must not contain "\." or ":"/);
    });

    it('rejects empty appId', () => {
      const host = createManifestHost();
      expect(() => host.mount('', householdLike, {
        skillRegistry: stubRegistry(householdLike),
        toSkillCtx:    (c) => c,
      })).toThrow(/non-empty string/);
    });

    it('rejects an invalid manifest', () => {
      const host = createManifestHost();
      expect(() => host.mount('bad', { app: 'bad' /* no itemTypes / operations */ }, {
        skillRegistry: {},
        toSkillCtx:    (c) => c,
      })).toThrow(/invalid manifest for "bad"/);
    });

    it('rejects duplicate mount on the same appId', () => {
      const host = createManifestHost();
      host.mount('household', householdLike, {
        skillRegistry: stubRegistry(householdLike),
        toSkillCtx:    (c) => c,
      });
      expect(() => host.mount('household', householdLike, {
        skillRegistry: stubRegistry(householdLike),
        toSkillCtx:    (c) => c,
      })).toThrow(/already mounted/);
    });

    it('rejects missing opts', () => {
      const host = createManifestHost();
      expect(() => host.mount('x', householdLike)).toThrow(/opts required/);
    });
  });

  describe('list / unmount', () => {
    it('list reflects mount order; unmount removes', () => {
      const host = createManifestHost();
      host.mount('household', householdLike, {
        skillRegistry: stubRegistry(householdLike), toSkillCtx: (c) => c,
      });
      host.mount('tasks', tasksLike, {
        skillRegistry: stubRegistry(tasksLike), toSkillCtx: (c) => c,
      });
      expect(host.list()).toEqual(['household', 'tasks']);

      host.unmount('household');
      expect(host.list()).toEqual(['tasks']);
    });

    it('unmount of an unknown appId is a no-op', () => {
      const host = createManifestHost();
      expect(() => host.unmount('nope')).not.toThrow();
    });
  });

  describe('compose', () => {
    function makeHost() {
      const host = createManifestHost();
      host.mount('household', householdLike, {
        skillRegistry: stubRegistry(householdLike), toSkillCtx: (c) => c,
      });
      host.mount('tasks', tasksLike, {
        skillRegistry: stubRegistry(tasksLike), toSkillCtx: (c) => c,
      });
      return host;
    }

    it('toolCatalogue ids are namespaced appId.opId, in mount-insertion order', () => {
      const composed = makeHost().compose();
      const ids = composed.toolCatalogue.map((t) => t.id);
      expect(ids).toEqual([
        'household.addItem',
        'household.doneItem',
        'tasks.addTask',
        'tasks.claim',
        'tasks.approve',
      ]);
    });

    it('toolCatalogue entries preserve description + schema', () => {
      const composed = makeHost().compose();
      const addItem = composed.toolCatalogue.find((t) => t.id === 'household.addItem');
      expect(addItem.description).toBe('Add an item');
      expect(addItem.schema.type).toBe('object');
      expect(addItem.schema.properties.text).toEqual({ type: 'string' });
      expect(addItem.schema.required).toEqual(['text']);
    });

    it('toolHandlers keys are namespaced; dispatch routes to the right skill', async () => {
      const composed = makeHost().compose();
      const keys = Object.keys(composed.toolHandlers).sort();
      expect(keys).toEqual([
        'household.addItem',
        'household.doneItem',
        'tasks.addTask',
        'tasks.approve',
        'tasks.claim',
      ]);

      const r1 = await composed.toolHandlers['household.addItem'](
        { text: 'buy milk' }, {},
      );
      expect(r1.replies[0].text).toBe('addItem:buy milk');

      const r2 = await composed.toolHandlers['tasks.addTask'](
        { text: 'paint hallway' }, {},
      );
      expect(r2.replies[0].text).toBe('addTask:paint hallway');
    });

    it('commandMenu carries appId per entry', () => {
      const composed = makeHost().compose();
      expect(composed.commandMenu).toEqual([
        { command: '/add', description: 'Add an item', appId: 'household' },
        { command: '/add', description: 'Add a task',  appId: 'tasks' },
      ]);
    });

    it('collisions detects shared commands (both apps register /add)', () => {
      const composed = makeHost().compose();
      expect(composed.collisions).toEqual([
        { command: '/add', appIds: ['household', 'tasks'] },
      ]);
    });

    it('no collisions when only one app registers a command', () => {
      const host = createManifestHost();
      host.mount('household', householdLike, {
        skillRegistry: stubRegistry(householdLike), toSkillCtx: (c) => c,
      });
      expect(host.compose().collisions).toEqual([]);
    });

    it('perAppSystemPrompts is keyed per app, not concatenated', () => {
      const composed = makeHost().compose();
      expect(composed.perAppSystemPrompts).toEqual({
        household: 'You are the household assistant.',
        tasks:     'You are the tasks-v0 assistant.',
      });
    });

    it('inlineKeyboardFor re-prefixes callbackData to appId.opId:itemId', () => {
      const composed = makeHost().compose();
      // An open task — household.doneItem applies (state=open) AND
      // tasks.claim applies (state=open).
      const open = composed.inlineKeyboardFor({ id: 'i1', type: 'task', state: 'open' });
      const callbackDatas = open.map((b) => b.callbackData);
      expect(callbackDatas).toEqual([
        'household.doneItem:i1',
        'tasks.claim:i1',
      ]);
    });

    it('inlineKeyboardFor honours F-SP3-a array states across mounts', () => {
      const composed = makeHost().compose();
      // A submitted task — only tasks.approve applies (array state).
      const submitted = composed.inlineKeyboardFor({ id: 'i2', type: 'task', state: 'submitted' });
      expect(submitted.map((b) => b.callbackData)).toEqual(['tasks.approve:i2']);
    });
  });

  describe('runtime cycles', () => {
    it('compose() reflects the current mount set with no stale cache', () => {
      const host = createManifestHost();
      host.mount('household', householdLike, {
        skillRegistry: stubRegistry(householdLike), toSkillCtx: (c) => c,
      });

      const first = host.compose();
      expect(first.toolCatalogue.map((t) => t.id)).toEqual([
        'household.addItem',
        'household.doneItem',
      ]);
      expect(first.collisions).toEqual([]);

      host.mount('tasks', tasksLike, {
        skillRegistry: stubRegistry(tasksLike), toSkillCtx: (c) => c,
      });
      const second = host.compose();
      expect(second.toolCatalogue.map((t) => t.id)).toEqual([
        'household.addItem',
        'household.doneItem',
        'tasks.addTask',
        'tasks.claim',
        'tasks.approve',
      ]);
      expect(second.collisions).toEqual([
        { command: '/add', appIds: ['household', 'tasks'] },
      ]);

      host.unmount('household');
      const third = host.compose();
      expect(third.toolCatalogue.map((t) => t.id)).toEqual([
        'tasks.addTask',
        'tasks.claim',
        'tasks.approve',
      ]);
      expect(third.collisions).toEqual([]);
      expect(third.commandMenu).toEqual([
        { command: '/add', description: 'Add a task', appId: 'tasks' },
      ]);
    });

    it('remounting an app after unmount works', () => {
      const host = createManifestHost();
      host.mount('household', householdLike, {
        skillRegistry: stubRegistry(householdLike), toSkillCtx: (c) => c,
      });
      host.unmount('household');
      expect(() => host.mount('household', householdLike, {
        skillRegistry: stubRegistry(householdLike), toSkillCtx: (c) => c,
      })).not.toThrow();
      expect(host.list()).toEqual(['household']);
    });
  });
});
