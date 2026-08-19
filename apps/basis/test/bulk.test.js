/**
 * basis — E2 bulk fan-out (`/done all`) wiring tests.
 *
 * Covers the three pieces the slice connects:
 *   - isBulkKeyword (the keyword set)
 *   - resolveDispatch → `bulk` route (parser/router hook, the missing link)
 *   - Thread.lastListing (candidate-item resolution)
 *   - executeBulkDispatch (fan-out + summary + cross-thread event emit)
 */
import { describe, it, expect, vi } from 'vitest';

import { mergeManifests }   from '../src/manifestMerge.js';
import { parseInput }       from '../src/parser.js';
import { resolveDispatch }  from '../src/router.js';
import { Thread }           from '../src/thread.js';
import { isBulkKeyword, executeBulkDispatch, lastListingItems } from '../src/bulkOps.js';

/* ── a manifest with a mutation target op + a read op with a target ── */
const manifest = {
  app:       'household',
  itemTypes: ['chore'],
  operations: [
    {
      id: 'markComplete', verb: 'complete',
      params: [{ name: 'choreId', kind: 'string', required: true }],
      surfaces: { slash: { command: '/done' }, chat: { reply: 'text' } },
    },
    {
      id: 'inspect', verb: 'get',   // read verb → must NOT bulk
      params: [{ name: 'choreId', kind: 'string', required: true }],
      surfaces: { slash: { command: '/inspect' } },
    },
  ],
};
const catalogue = mergeManifests([{ manifest }]);

const route = (text) =>
  resolveDispatch(parseInput(text, catalogue, { threadId: 'main' }), catalogue);

describe('isBulkKeyword', () => {
  it('matches the en + nl keyword set, case/space-insensitively', () => {
    for (const w of ['all', 'All', ' ALL ', 'everything', 'alle', 'allemaal', 'alles']) {
      expect(isBulkKeyword(w)).toBe(true);
    }
  });
  it('rejects ordinary ids and non-strings', () => {
    for (const w of ['dishes', 'c-1', '', null, undefined, 42, 'allium']) {
      expect(isBulkKeyword(w)).toBe(false);
    }
  });
});

describe('resolveDispatch — bulk keyword hook', () => {
  it('routes `/done all` to a bulk dispatch (not a literal id)', () => {
    const r = route('/done all');
    expect(r.kind).toBe('bulk');
    expect(r).toMatchObject({ opId: 'markComplete', appOrigin: 'household', argName: 'choreId' });
    expect(r.baseArgs).toEqual({});         // _match stripped
  });

  it('binds a normal body as a literal id (ready, no bulk)', () => {
    const r = route('/done c-7');
    expect(r.kind).toBe('ready');
    expect(r.args).toMatchObject({ choreId: 'c-7' });
  });

  it('does NOT bulk a read verb (`/inspect all` binds literally)', () => {
    const r = route('/inspect all');
    expect(r.kind).not.toBe('bulk');
    expect(r.kind).toBe('ready');
    expect(r.args).toMatchObject({ choreId: 'all' });
  });
});

describe('Thread.lastListing', () => {
  it('returns the freshest listing, preferring a given app', () => {
    let clock = 1_000;
    const t = new Thread({ now: () => (clock += 10) });
    t.addShellMessage({ kind: 'list', items: [{ id: 'a1' }, { id: 'a2' }] }, { opId: 'listA', appOrigin: 'appA' });
    t.addShellMessage({ kind: 'list', items: [{ id: 'b1' }] },               { opId: 'listB', appOrigin: 'appB' });

    // Freshest overall is appB.
    expect(t.lastListing().items.map((i) => i.id)).toEqual(['b1']);
    // Same-app preference returns appA's listing even though it is older.
    expect(t.lastListing({ appOrigin: 'appA' }).items.map((i) => i.id)).toEqual(['a1', 'a2']);
    // Unknown app → null (caller falls back).
    expect(t.lastListing({ appOrigin: 'nope' })).toBeNull();
  });

  it('returns null when no listing has been captured', () => {
    expect(new Thread().lastListing()).toBeNull();
  });
});

describe('lastListingItems (mobile message-array variant)', () => {
  const L = (ids, app) => ({
    rendered: { kind: 'list', items: ids.map((id) => ({ id })) },
    sourceDispatch: { appOrigin: app },
  });
  const text = { rendered: { kind: 'text', text: 'hi' } };

  it('returns the freshest list ids, preferring the requested app', () => {
    const msgs = [L(['a1', 'a2'], 'appA'), text, L(['b1'], 'appB')];
    expect(lastListingItems(msgs)).toEqual(['b1']);                       // freshest overall
    expect(lastListingItems(msgs, { appOrigin: 'appA' })).toEqual(['a1', 'a2']);
    expect(lastListingItems(msgs, { appOrigin: 'appB' })).toEqual(['b1']);
  });

  it('falls back to the freshest other-app list when none matches', () => {
    const msgs = [L(['a1'], 'appA')];
    expect(lastListingItems(msgs, { appOrigin: 'appZ' })).toEqual(['a1']);
  });

  it('returns [] for no list / empty / bad input', () => {
    expect(lastListingItems([text])).toEqual([]);
    expect(lastListingItems([{ rendered: { kind: 'list', items: [] } }])).toEqual([]);
    expect(lastListingItems(null)).toEqual([]);
  });
});

describe('executeBulkDispatch', () => {
  const bulk = { opId: 'markComplete', appOrigin: 'household', argName: 'choreId', baseArgs: {} };

  it('fans out one call per item, summarises, and emits cross-thread events', async () => {
    const callSkill = vi.fn(async () => ({ ok: true }));
    const emitEvent = vi.fn();
    const { message, ok, result } = await executeBulkDispatch({
      bulk, itemIds: ['c-1', 'c-2', 'c-3'], callSkill, emitEvent, opLabel: 'Done',
    });
    expect(ok).toBe(true);
    expect(result.stats).toEqual({ total: 3, ok: 3, failed: 0 });
    expect(callSkill).toHaveBeenCalledTimes(3);
    expect(callSkill).toHaveBeenCalledWith('household', 'markComplete', { choreId: 'c-1' });
    expect(emitEvent).toHaveBeenCalledTimes(3);   // OQ-4 fan-out
    expect(emitEvent.mock.calls[0][0]).toMatchObject({ app: 'household', type: 'item-changed' });
    expect(message).toContain('Done');
  });

  it('reports partial failure', async () => {
    const callSkill = vi.fn(async (_a, _o, args) =>
      args.choreId === 'c-2' ? { ok: false, error: 'locked' } : { ok: true });
    const { ok, result } = await executeBulkDispatch({
      bulk, itemIds: ['c-1', 'c-2'], callSkill,
    });
    expect(ok).toBe(false);
    expect(result.stats).toEqual({ total: 2, ok: 1, failed: 1 });
  });
});
