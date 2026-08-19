/**
 * basis — manifestMerge tests. v0.1.
 *
 * Verifies the merged catalogue has the right commandMenu entries,
 * opsById map, replyShapeFor lookup, and collision warnings.
 */
import { describe, it, expect } from 'vitest';

import { mergeManifests } from '../src/manifestMerge.js';

const householdLite = {
  app:       'household',
  itemTypes: ['chore'],
  operations: [
    {
      id:       'markComplete', verb: 'complete', params: [],
      surfaces: { slash: { command: '/done' }, chat: { hint: 'mark a chore complete', reply: 'text' } },
    },
    {
      id:       'listOpen', verb: 'list', params: [],
      surfaces: { slash: { command: '/mine' }, chat: { hint: 'list open chores', reply: 'list' } },
    },
  ],
  views: [{ id: 'tasks', title: 'Chores', type: 'chore' }],
};

const tasksLite = {
  app:       'tasks',
  itemTypes: ['task'],
  operations: [
    {
      id:       'addTask', verb: 'add', params: [],
      surfaces: { slash: { command: '/addtask' }, chat: { hint: 'add a task' } },
    },
  ],
  views: [{ id: 'open', title: 'Open', type: 'task' }],
};

describe('mergeManifests — basic shape', () => {
  it('returns a catalogue with commandMenu + opsById + replyShapeFor + appOrigins', () => {
    const cat = mergeManifests([
      { manifest: householdLite },
      { manifest: tasksLite },
    ]);
    expect(cat.appOrigins).toEqual(['household', 'tasks']);
    expect(cat.warnings).toEqual([]);

    // commandMenu carries 3 entries (household × 2 + tasks × 1).
    expect(cat.commandMenu.length).toBe(3);
    const byCmd = Object.fromEntries(cat.commandMenu.map((e) => [e.command, e]));
    expect(byCmd['/done']).toEqual({
      command: '/done', opId: 'markComplete', appOrigin: 'household',
    });
    expect(byCmd['/mine']).toEqual({
      command: '/mine', opId: 'listOpen', appOrigin: 'household',
    });
    expect(byCmd['/addtask']).toEqual({
      command: '/addtask', opId: 'addTask', appOrigin: 'tasks',
    });

    // opsById carries every operation.
    expect(cat.opsById.get('markComplete').appOrigin).toBe('household');
    expect(cat.opsById.get('listOpen').appOrigin).toBe('household');
    expect(cat.opsById.get('addTask').appOrigin).toBe('tasks');
  });

  it('replyShapeFor returns declared Q28 shapes; undefined when absent', () => {
    const cat = mergeManifests([
      { manifest: householdLite },
      { manifest: tasksLite },
    ]);
    expect(cat.replyShapeFor('markComplete')).toBe('text');
    expect(cat.replyShapeFor('listOpen')).toBe('list');
    expect(cat.replyShapeFor('addTask')).toBeUndefined();   // not declared
    expect(cat.replyShapeFor('nonexistent')).toBeUndefined();
  });
});

describe('mergeManifests — empty / minimal cases', () => {
  it('empty source array → empty catalogue', () => {
    const cat = mergeManifests([]);
    expect(cat.commandMenu).toEqual([]);
    expect(cat.opsById.size).toBe(0);
    expect(cat.appOrigins).toEqual([]);
    expect(cat.warnings).toEqual([]);
  });

  it('single-app source → single-app catalogue', () => {
    const cat = mergeManifests([{ manifest: tasksLite }]);
    expect(cat.appOrigins).toEqual(['tasks']);
    expect(cat.commandMenu).toEqual([
      { command: '/addtask', opId: 'addTask', appOrigin: 'tasks' },
    ]);
  });
});

describe('mergeManifests — error handling', () => {
  it('throws on invalid manifests (forward-fail)', () => {
    expect(() => mergeManifests([{ manifest: { /* no app id */ } }]))
      .toThrow(/invalid manifest/);
  });

  it('throws on non-array sources', () => {
    expect(() => mergeManifests('not-an-array')).toThrow(/must be an array/);
  });

  it('warns + skips entries missing the manifest field', () => {
    const cat = mergeManifests([
      { manifest: tasksLite },
      { callSkill: () => null },     // no manifest
    ]);
    expect(cat.appOrigins).toEqual(['tasks']);
    expect(cat.warnings.length).toBe(1);
    expect(cat.warnings[0]).toMatch(/skipping/);
  });
});

describe('mergeManifests — collision handling', () => {
  it('warns on slash collision but keeps the first declarer', () => {
    const competing = {
      app:       'compet',
      itemTypes: ['task'],
      operations: [{
        id:       'doSomething', verb: 'do', params: [],
        surfaces: { slash: { command: '/done' } },   // collides with household
      }],
    };
    const cat = mergeManifests([
      { manifest: householdLite },
      { manifest: competing },
    ]);
    expect(cat.commandMenu.find((e) => e.command === '/done').appOrigin)
      .toBe('household');
    expect(cat.warnings.some((w) => /slash collision.*\/done/.test(w))).toBe(true);
  });

  it('v0.4 op-id collision policy: prefix-on-collision', () => {
    // Two apps declare the same op id; the first keeps the bare key,
    // the second is exposed as '<app>/<id>'.
    const competingOpId = {
      app:       'compet',
      itemTypes: ['task'],
      operations: [{
        id:       'markComplete',   // collides with household's
        verb:     'complete',
        params:   [],
        surfaces: { slash: { command: '/competcomplete' } },
      }],
      views: [{ id: 'v', title: 'V', type: 'task' }],
    };
    const cat = mergeManifests([
      { manifest: householdLite },
      { manifest: competingOpId },
    ]);
    // Bare key → household (first declarer).
    expect(cat.opsById.get('markComplete').appOrigin).toBe('household');
    // Prefixed key → compet (second declarer).
    expect(cat.opsById.get('compet/markComplete').appOrigin).toBe('compet');
    expect(cat.warnings.some((w) => /op-id collision.*markComplete.*compet\/markComplete/.test(w))).toBe(true);
  });

  it("unique op-ids stay BARE (no prefix churn for solo apps)", () => {
    const cat = mergeManifests([
      { manifest: householdLite },
      { manifest: tasksLite },
    ]);
    // No collisions — every key is bare.
    for (const key of cat.opsById.keys()) {
      expect(key).not.toMatch(/\//);
    }
    expect(cat.opsById.has('markComplete')).toBe(true);
    expect(cat.opsById.has('addTask')).toBe(true);
  });
});

describe('mergeManifests — Q32 runtime filter (v0.4)', () => {
  const folioLite = {
    app:       'folio',
    itemTypes: ['note'],
    operations: [
      { id: 'readNote',  verb: 'list', params: [], runtime: 'browser',
        surfaces: { slash: { command: '/readnote' } } },
      { id: 'syncOnce',  verb: 'add',  params: [], runtime: 'node',
        surfaces: { slash: { command: '/sync' } } },
      { id: 'shareNote', verb: 'add',  params: [], runtime: 'both',
        surfaces: { slash: { command: '/share' } } },
      { id: 'unmarked',  verb: 'list', params: [],   // absent → 'both'
        surfaces: { slash: { command: '/x' } } },
    ],
    views: [{ id: 'notes', title: 'Notes', type: 'note' }],
  };

  it("default (no opts) → no filtering (runtime: 'both')", () => {
    const cat = mergeManifests([{ manifest: folioLite }]);
    const ids = [...cat.opsById.keys()].sort();
    expect(ids).toEqual(['readNote', 'shareNote', 'syncOnce', 'unmarked']);
  });

  it("runtime: 'browser' filters out 'node' ops", () => {
    const cat = mergeManifests([{ manifest: folioLite }], { runtime: 'browser' });
    const ids = [...cat.opsById.keys()].sort();
    expect(ids).toEqual(['readNote', 'shareNote', 'unmarked']);
    // syncOnce (node) is gone; also from commandMenu
    expect(cat.commandMenu.find((e) => e.command === '/sync')).toBeUndefined();
  });

  it("runtime: 'node' filters out 'browser' ops", () => {
    const cat = mergeManifests([{ manifest: folioLite }], { runtime: 'node' });
    const ids = [...cat.opsById.keys()].sort();
    expect(ids).toEqual(['shareNote', 'syncOnce', 'unmarked']);
    expect(cat.commandMenu.find((e) => e.command === '/readnote')).toBeUndefined();
  });

  it("absent op.runtime defaults to 'both' (works in either filter)", () => {
    const browser = mergeManifests([{ manifest: folioLite }], { runtime: 'browser' });
    const node    = mergeManifests([{ manifest: folioLite }], { runtime: 'node'    });
    expect(browser.opsById.has('unmarked')).toBe(true);
    expect(node.opsById.has('unmarked')).toBe(true);
  });
});

describe('mergeManifests — Q31 followUpsFor (v0.4)', () => {
  it("exposes per-op follow-ups via the projector", () => {
    const m = {
      app: 'household', itemTypes: ['member'],
      operations: [{
        id: 'addMember', verb: 'add', params: [],
        surfaces: {
          slash: { command: '/addmember' },
          chat:  { followUps: [{ opId: 'shareFolder', prefilledArgs: { for: 'new' } }] },
        },
      }],
      views: [{ id: 'v', title: 'V', type: 'member' }],
    };
    const cat = mergeManifests([{ manifest: m }]);
    expect(cat.followUpsFor('addMember')).toEqual([
      { opId: 'shareFolder', prefilledArgs: { for: 'new' } },
    ]);
    expect(cat.followUpsFor('nonexistent')).toBeUndefined();
  });
});
