/**
 * Objective D — `resolveSlash` unit tests (prefix-all + per-host override).
 *
 * Feeds the resolver the SAME shape `ManifestHost.compose()` emits as
 * `collisions` (`[{command, appIds}]`) plus a per-host `overrides` map, and
 * asserts the policy:
 *   - colliding command → app-qualified forms always available; bare token is
 *     AMBIGUOUS (offer the choices) with no override;
 *   - with an override → bare resolves to the winner, the others stay qualified;
 *   - non-colliding commands produce NOTHING (the resolver only speaks to the
 *     commands present in `collisions`).
 */

import { describe, it, expect } from 'vitest';

import { resolveSlash } from '../src/resolveSlash.js';

describe('resolveSlash — prefix-all (no override)', () => {
  const collisions = [{ command: '/done', appIds: ['tasks', 'pinboard'] }];

  it('exposes an app-qualified form for EVERY declarer, in mount order', () => {
    const r = resolveSlash(collisions);
    expect(r.qualified).toEqual([
      { command: '/tasks:done', appId: 'tasks', base: 'done' },
      { command: '/pinboard:done', appId: 'pinboard', base: 'done' },
    ]);
  });

  it('the bare token is AMBIGUOUS (choices offered), never silently fired', () => {
    const r = resolveSlash(collisions);
    expect(r.ambiguous).toEqual({ '/done': ['tasks', 'pinboard'] });
    expect(r.winners).toEqual({});
    expect(r.bareFor('/done')).toEqual({ status: 'ambiguous', choices: ['tasks', 'pinboard'] });
  });

  it('entries carry the qualified forms + bare resolution together', () => {
    const r = resolveSlash(collisions);
    expect(r.entries).toEqual([
      {
        command: '/done',
        appIds: ['tasks', 'pinboard'],
        qualified: [
          { command: '/tasks:done', appId: 'tasks', base: 'done' },
          { command: '/pinboard:done', appId: 'pinboard', base: 'done' },
        ],
        bare: { status: 'ambiguous', choices: ['tasks', 'pinboard'] },
      },
    ]);
  });

  it('isCollision / bareFor accept bare OR slash-prefixed command forms', () => {
    const r = resolveSlash(collisions);
    expect(r.isCollision('/done')).toBe(true);
    expect(r.isCollision('done')).toBe(true);
    expect(r.isCollision('/nope')).toBe(false);
    expect(r.bareFor('done')).toEqual({ status: 'ambiguous', choices: ['tasks', 'pinboard'] });
    expect(r.bareFor('/nope')).toBeNull();
  });
});

describe('resolveSlash — per-host override', () => {
  const collisions = [{ command: '/done', appIds: ['tasks', 'pinboard'] }];

  it('bare token resolves to the pinned winner; others stay qualified', () => {
    const r = resolveSlash(collisions, { done: 'pinboard' });
    expect(r.winners).toEqual({ '/done': 'pinboard' });
    expect(r.ambiguous).toEqual({});
    expect(r.bareFor('/done')).toEqual({ status: 'winner', appId: 'pinboard' });
    // Qualified forms are UNCHANGED — every app stays reachable.
    expect(r.qualified).toEqual([
      { command: '/tasks:done', appId: 'tasks', base: 'done' },
      { command: '/pinboard:done', appId: 'pinboard', base: 'done' },
    ]);
  });

  it('accepts a slash-prefixed override key (/done) equivalently', () => {
    const r = resolveSlash(collisions, { '/done': 'tasks' });
    expect(r.bareFor('/done')).toEqual({ status: 'winner', appId: 'tasks' });
  });

  it('an override naming a NON-declarer is ignored → falls back to ambiguous', () => {
    const r = resolveSlash(collisions, { done: 'folio' });   // folio doesn't declare /done
    expect(r.winners).toEqual({});
    expect(r.bareFor('/done')).toEqual({ status: 'ambiguous', choices: ['tasks', 'pinboard'] });
  });

  it('an override for a NON-colliding command is inert (no phantom entries)', () => {
    const r = resolveSlash(collisions, { unshared: 'tasks' });
    expect(r.isCollision('/unshared')).toBe(false);
    expect(r.entries).toHaveLength(1);   // only /done
  });
});

describe('resolveSlash — multiple + degenerate inputs', () => {
  it('resolves several colliding commands independently (override one, not the other)', () => {
    const collisions = [
      { command: '/done', appIds: ['tasks', 'pinboard'] },
      { command: '/list', appIds: ['pinboard', 'folio', 'tasks'] },
    ];
    const r = resolveSlash(collisions, { list: 'folio' });
    expect(r.bareFor('/done')).toEqual({ status: 'ambiguous', choices: ['tasks', 'pinboard'] });
    expect(r.bareFor('/list')).toEqual({ status: 'winner', appId: 'folio' });
    expect(r.qualified.map((q) => q.command)).toEqual([
      '/tasks:done', '/pinboard:done',
      '/pinboard:list', '/folio:list', '/tasks:list',
    ]);
  });

  it('no collisions → empty resolution', () => {
    const r = resolveSlash([]);
    expect(r.entries).toEqual([]);
    expect(r.qualified).toEqual([]);
    expect(r.winners).toEqual({});
    expect(r.ambiguous).toEqual({});
    expect(r.isCollision('/done')).toBe(false);
  });

  it('tolerates a malformed / single-declarer entry (skips it)', () => {
    const r = resolveSlash([
      { command: '/solo', appIds: ['tasks'] },   // single declarer → not a collision
      { command: '/x' },                          // no appIds
      null,
    ]);
    expect(r.entries).toEqual([]);
  });
});
