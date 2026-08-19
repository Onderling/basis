/**
 * Objective D — slash-collision policy end-to-end in basis.
 *
 * Two mounted apps declare the SAME bare `/done` command. The merged catalogue
 * (`mergeManifests`) must, via `@onderling/manifest-host`'s `resolveSlash`:
 *   - expose the app-qualified forms (`/tasks:done`, `/stoop:done`) that always
 *     route to the right app;
 *   - surface the bare `/done` as AMBIGUOUS (offer the choices) with NO
 *     override, so the parser hands back kind:'ambiguous' instead of silently
 *     firing the first declarer;
 *   - resolve the bare `/done` to the pinned WINNER when a per-host override is
 *     set (`slashOverrides: { done: 'stoop' }`), while the other app stays
 *     reachable via its qualified form;
 *   - leave a NON-colliding command (`/mine`, `/addtask`) exactly as before.
 */

import { describe, it, expect } from 'vitest';

import { mergeManifests } from '../src/manifestMerge.js';
import { parseInput } from '../src/parser.js';

/* Two apps, each with a DISTINCT op-id but the SAME `/done` command. */
const tasksLite = {
  app:       'tasks',
  itemTypes: ['task'],
  operations: [
    { id: 'completeTask', verb: 'complete', params: [],
      surfaces: { slash: { command: '/done' }, chat: { hint: 'complete a task' } } },
    { id: 'addTask', verb: 'add', params: [],
      surfaces: { slash: { command: '/addtask' }, chat: { hint: 'add a task' } } },
  ],
  views: [{ id: 'open', title: 'Open', type: 'task' }],
};

const stoopLite = {
  app:       'stoop',
  itemTypes: ['request'],
  operations: [
    { id: 'markDone', verb: 'done', params: [],
      surfaces: { slash: { command: '/done' }, chat: { hint: 'mark a request done' } } },
    { id: 'listFeed', verb: 'list', params: [],
      surfaces: { slash: { command: '/mine' }, chat: { hint: 'list my requests' } } },
  ],
  views: [{ id: 'feed', title: 'Feed', type: 'request' }],
};

const sources = [{ manifest: tasksLite }, { manifest: stoopLite }];

describe('mergeManifests — slash-collision policy (prefix-all, no override)', () => {
  it('adds app-qualified forms for every declarer of the colliding command', () => {
    const cat = mergeManifests(sources);
    const byCmd = Object.fromEntries(cat.commandMenu.map((e) => [e.command, e]));
    expect(byCmd['/tasks:done']).toMatchObject({ command: '/tasks:done', opId: 'completeTask', appOrigin: 'tasks' });
    expect(byCmd['/stoop:done']).toMatchObject({ command: '/stoop:done', opId: 'markDone', appOrigin: 'stoop' });
  });

  it('marks the BARE command ambiguous (no silent fire) and carries the choices', () => {
    const cat = mergeManifests(sources);
    const bare = cat.commandMenu.find((e) => e.command === '/done');
    expect(bare.ambiguous).toBe(true);
    expect(bare.opId).toBeUndefined();
    expect(bare.choices).toEqual([
      { command: '/tasks:done', appId: 'tasks' },
      { command: '/stoop:done', appId: 'stoop' },
    ]);
    expect(cat.slashPolicy.ambiguous).toEqual({ '/done': ['tasks', 'stoop'] });
  });

  it('parseInput returns kind:ambiguous for the bare command, preserving the body', () => {
    const cat = mergeManifests(sources);
    const p = parseInput('/done fix the fence', cat);
    expect(p.kind).toBe('ambiguous');
    expect(p.command).toBe('/done');
    expect(p.body).toBe('fix the fence');
    expect(p.choices.map((c) => c.command)).toEqual(['/tasks:done', '/stoop:done']);
  });

  it('the qualified forms parse as normal slash and route to the right app', () => {
    const cat = mergeManifests(sources);
    const a = parseInput('/tasks:done t1', cat);
    expect(a).toMatchObject({ kind: 'slash', opId: 'completeTask', appOrigin: 'tasks' });
    const b = parseInput('/stoop:done r1', cat);
    expect(b).toMatchObject({ kind: 'slash', opId: 'markDone', appOrigin: 'stoop' });
  });

  it('non-colliding commands are unchanged (bare, single owner)', () => {
    const cat = mergeManifests(sources);
    const mine = parseInput('/mine', cat);
    expect(mine).toMatchObject({ kind: 'slash', opId: 'listFeed', appOrigin: 'stoop' });
    const add = parseInput('/addtask paint', cat);
    expect(add).toMatchObject({ kind: 'slash', opId: 'addTask', appOrigin: 'tasks' });
    // No qualified forms were minted for the non-colliding commands.
    expect(cat.commandMenu.some((e) => e.command === '/tasks:mine' || e.command === '/stoop:addtask')).toBe(false);
  });
});

describe('mergeManifests — slash-collision policy (per-host override)', () => {
  it('bare command resolves to the pinned WINNER; others stay qualified', () => {
    const cat = mergeManifests(sources, { slashOverrides: { done: 'stoop' } });
    // Bare /done → stoop (the winner), dispatched (no longer ambiguous).
    const bare = parseInput('/done r1', cat);
    expect(bare).toMatchObject({ kind: 'slash', opId: 'markDone', appOrigin: 'stoop' });
    expect(cat.slashPolicy.winners).toEqual({ '/done': 'stoop' });
    // The loser (tasks) stays reachable via its qualified form.
    const q = parseInput('/tasks:done t1', cat);
    expect(q).toMatchObject({ kind: 'slash', opId: 'completeTask', appOrigin: 'tasks' });
  });

  it('a slash-prefixed override key works the same', () => {
    const cat = mergeManifests(sources, { slashOverrides: { '/done': 'tasks' } });
    const bare = parseInput('/done t1', cat);
    expect(bare).toMatchObject({ kind: 'slash', opId: 'completeTask', appOrigin: 'tasks' });
  });

  it('an override naming a non-declarer falls back to ambiguous', () => {
    const cat = mergeManifests(sources, { slashOverrides: { done: 'folio' } });
    expect(parseInput('/done', cat).kind).toBe('ambiguous');
  });
});
