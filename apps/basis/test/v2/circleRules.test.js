import { describe, it, expect } from 'vitest';
import {
  RULES_FIELDS, RULES_QUESTIONS, DEFAULT_RULES_DOC,
  normalizeRulesDoc, buildRulesDoc, isRulesComplete, isRulesEmpty,
  // γ.2 — newly-introduced store factory + localStorage io.
  createCircleRulesStore, localStorageRulesIo,
} from '../../src/v2/circleRules.js';

describe('circleRules model', () => {
  it('has 7 fields, 6 questions, with purpose + agreements required', () => {
    expect(RULES_FIELDS).toHaveLength(7);
    expect(RULES_FIELDS).toContain('responsibility');
    expect(RULES_QUESTIONS).toHaveLength(6);
    expect(RULES_QUESTIONS.find((q) => q.key === 'responsibility')).toBeUndefined(); // folded in
    expect(RULES_QUESTIONS.filter((q) => q.required).map((q) => q.key)).toEqual(['purpose', 'agreements']);
  });

  it('DEFAULT_RULES_DOC is every field blank', () => {
    expect(Object.keys(DEFAULT_RULES_DOC).sort()).toEqual([...RULES_FIELDS].sort());
    expect(Object.values(DEFAULT_RULES_DOC).every((v) => v === '')).toBe(true);
  });

  it('normalizeRulesDoc coerces partials + drops unknown keys + non-strings', () => {
    const d = normalizeRulesDoc({ purpose: 'Garden', bogus: 'x', admins: 42 });
    expect(d.purpose).toBe('Garden');
    expect(d.admins).toBe('');     // non-string → ''
    expect(d.bogus).toBeUndefined();
    expect(Object.keys(d)).toHaveLength(7);
    expect(normalizeRulesDoc(null)).toEqual(DEFAULT_RULES_DOC);
  });

  it('buildRulesDoc assembles a doc from field-keyed answers', () => {
    const doc = buildRulesDoc({ purpose: 'P', agreements: 'A', leaving: 'L' });
    expect(doc).toMatchObject({ purpose: 'P', agreements: 'A', leaving: 'L', admins: '', responsibility: '' });
  });

  it('isRulesComplete requires non-blank purpose + agreements', () => {
    expect(isRulesComplete({ purpose: 'P', agreements: 'A' })).toBe(true);
    expect(isRulesComplete({ purpose: 'P', agreements: '   ' })).toBe(false);
    expect(isRulesComplete({ purpose: 'P' })).toBe(false);
    expect(isRulesComplete({})).toBe(false);
  });

  it('isRulesEmpty is true only when every field is blank', () => {
    expect(isRulesEmpty({})).toBe(true);
    expect(isRulesEmpty({ purpose: '  ' })).toBe(true);
    expect(isRulesEmpty({ leaving: 'x' })).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* γ.2 — createCircleRulesStore + localStorageRulesIo                 */
/* ─────────────────────────────────────────────────────────────────── */

describe('createCircleRulesStore', () => {
  it('get() returns normalised defaults when nothing is stored', async () => {
    const store = createCircleRulesStore({ load: async () => null });
    expect(await store.get('c1')).toEqual(DEFAULT_RULES_DOC);
  });

  it('set() persists a normalised doc', async () => {
    let stored = null;
    const store = createCircleRulesStore({
      load: async () => stored,
      save: async (_id, d) => { stored = d; },
    });
    await store.set('c1', { purpose: 'Garden', bogus: 'drop me' });
    expect(stored).toMatchObject({ purpose: 'Garden', agreements: '' });
    expect(stored.bogus).toBeUndefined();
  });

  it('update() shallow-merges a field patch onto current', async () => {
    let stored = null;
    const store = createCircleRulesStore({
      load: async () => stored,
      save: async (_id, d) => { stored = d; },
    });
    await store.update('c1', { purpose: 'P' });
    const after = await store.update('c1', { agreements: 'A' });
    expect(after.purpose).toBe('P');
    expect(after.agreements).toBe('A');
    expect(stored.purpose).toBe('P');
    expect(stored.agreements).toBe('A');
  });

  it('omitting `versions` keeps the pre-γ.2 behaviour', async () => {
    let stored = null;
    const store = createCircleRulesStore({
      load: async () => stored,
      save: async (_id, d) => { stored = d; },
    });
    await store.update('c1', { purpose: 'P' });
    expect(await store.listVersions('c1')).toEqual([]);
    expect(stored.purpose).toBe('P');
  });

  it('captures BEFORE save with a versions adapter', async () => {
    const order = [];
    const captured = [];
    const versions = {
      capture: async (id, value) => { order.push('capture'); captured.push({ id, value }); },
      list: async () => [],
    };
    const store = createCircleRulesStore({
      load: async () => null,
      save: async () => { order.push('save'); },
      versions,
    });
    await store.update('c1', { purpose: 'P' });
    await store.set('c1', { agreements: 'A' });
    expect(order).toEqual(['capture', 'save', 'capture', 'save']);
    expect(captured[0].value.purpose).toBe('P');
    expect(captured[1].value.agreements).toBe('A');
  });

  it('listVersions delegates to the adapter', async () => {
    const versions = {
      capture: async () => {},
      list: async (id) => [{ ts: 1, sha256: 'x', value: { id } }],
    };
    const store = createCircleRulesStore({ versions });
    expect(await store.listVersions('c1')).toEqual([{ ts: 1, sha256: 'x', value: { id: 'c1' } }]);
  });

  it('throwing capture does not break save', async () => {
    let stored = null;
    const store = createCircleRulesStore({
      load: async () => stored,
      save: async (_id, d) => { stored = d; },
      versions: {
        capture: async () => { throw new Error('history disk gone'); },
        list: async () => [],
      },
    });
    await store.update('c1', { purpose: 'P' });
    expect(stored.purpose).toBe('P');
  });

  it('restoreVersion persists the restored snapshot via the set path (capture + save)', async () => {
    const order = [];
    let stored = { purpose: 'current', agreements: 'current' };
    const store = createCircleRulesStore({
      load: async () => stored,
      save: async (_id, d) => { order.push('save'); stored = d; },
      versions: {
        capture: async () => { order.push('capture'); },
        list: async () => [],
        restore: async (_id, ts) => (ts === 7 ? { purpose: 'old P' } : null),
      },
    });
    const doc = await store.restoreVersion('c1', 7);
    expect(order).toEqual(['capture', 'save']);
    expect(doc.purpose).toBe('old P');
    expect(doc.agreements).toBe('');          // wholesale replace, normalised — not merged
    expect(stored.purpose).toBe('old P');
  });

  it('restoreVersion returns null on a miss or when no adapter/restore is wired', async () => {
    let saveCalls = 0;
    const store = createCircleRulesStore({
      load: async () => null,
      save: async () => { saveCalls += 1; },
      versions: { capture: async () => {}, list: async () => [], restore: async () => null },
    });
    expect(await store.restoreVersion('c1', 999)).toBeNull();
    expect(saveCalls).toBe(0);

    const bare = createCircleRulesStore({ load: async () => null, save: async () => {} });
    expect(await bare.restoreVersion('c1', 1)).toBeNull();
  });
});

describe('localStorageRulesIo', () => {
  it('round-trips through a Storage-like backend', async () => {
    const map = new Map();
    const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) };
    const io = localStorageRulesIo(storage);
    await io.save('c1', { purpose: 'Garden' });
    expect(await io.load('c1')).toEqual({ purpose: 'Garden' });
    expect(map.has('basis.circleRules.c1')).toBe(true);
  });

  it('load returns null for missing / corrupt entries', async () => {
    const storage = { getItem: () => 'not json{', setItem: () => {} };
    expect(await localStorageRulesIo(storage).load('c1')).toBeNull();
  });

  it('save tolerates a throwing storage (quota / disabled)', async () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    await expect(localStorageRulesIo(storage).save('c1', { purpose: 'P' })).resolves.toBeUndefined();
  });
});
