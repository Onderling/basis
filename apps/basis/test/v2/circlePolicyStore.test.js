import { describe, it, expect } from 'vitest';
import { groupKeyStrategy } from '@onderling/pod-client';
import { setShellContentSeal } from '../../src/v2/localStoreSeal.js';
import {
  createCirclePolicyStore, localStoragePolicyIo,
  createMemberOverrideStore, localStorageOverrideIo,
} from '../../src/v2/circlePolicyStore.js';
import { DEFAULT_CIRCLE_POLICY, DEFAULT_MEMBER_OVERRIDE } from '../../src/v2/circlePolicy.js';

describe('createCirclePolicyStore', () => {
  it('get() returns normalised defaults when nothing is stored', async () => {
    const store = createCirclePolicyStore({ load: async () => null });
    expect(await store.get('c1')).toEqual(DEFAULT_CIRCLE_POLICY);
  });

  it('update() deep-merges onto current and persists the normalised result', async () => {
    const mem = {};
    const store = createCirclePolicyStore({
      load: async (id) => mem[id] ?? null,
      save: async (id, p) => { mem[id] = p; },
    });
    await store.update('c1', { features: { tasks: true }, pod: 'shared' });
    const after = await store.update('c1', { features: { notes: true }, llmTool: 'local' });
    expect(after.features.tasks).toBe(true);  // preserved across edits
    expect(after.features.notes).toBe(true);
    expect(after.pod).toBe('shared');
    expect(after.llmTool).toBe('local');
    expect(mem.c1).toEqual(after);             // persisted
  });

  it('tolerates a throwing load (falls back to defaults)', async () => {
    const store = createCirclePolicyStore({ load: async () => { throw new Error('x'); } });
    expect(await store.get('c1')).toEqual(DEFAULT_CIRCLE_POLICY);
  });
});

describe('localStoragePolicyIo', () => {
  it('round-trips through a Storage-like backend', async () => {
    const map = new Map();
    const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) };
    const io = localStoragePolicyIo(storage);
    await io.save('c1', { pod: 'shared' });
    expect(await io.load('c1')).toEqual({ pod: 'shared' });
    expect(map.has('cc.circlePolicy.c1')).toBe(true);
  });

  it('load returns null for missing / corrupt entries', async () => {
    const storage = { getItem: () => 'not json{', setItem: () => {} };
    expect(await localStoragePolicyIo(storage).load('c1')).toBeNull();
  });
});

describe('createMemberOverrideStore', () => {
  it('get() returns normalised defaults when nothing is stored', async () => {
    const store = createMemberOverrideStore({ load: async () => null });
    expect(await store.get('c1')).toEqual(DEFAULT_MEMBER_OVERRIDE);
  });

  it('update() deep-merges flowThrough and persists', async () => {
    const mem = {};
    const store = createMemberOverrideStore({
      load: async (id) => mem[id] ?? null,
      save: async (id, o) => { mem[id] = o; },
    });
    await store.update('c1', { chatOff: true, flowThrough: { tasksToPersonal: true } });
    const after = await store.update('c1', { flowThrough: { calendarToPersonal: true } });
    expect(after.chatOff).toBe(true);
    expect(after.flowThrough).toEqual({ tasksToPersonal: true, calendarToPersonal: true });
    expect(mem.c1).toEqual(after);
  });

  it('localStorageOverrideIo round-trips under its own key (sealed: a content key is published, as after a boot)', async () => {
    setShellContentSeal(groupKeyStrategy({ groupKey: Buffer.from(new Uint8Array(32).fill(7)).toString('base64url') }));
    const map = new Map();
    const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) };
    const io = localStorageOverrideIo(storage);
    await io.save('c1', { chatOff: true });
    expect(await io.load('c1')).toEqual({ chatOff: true });
    expect(map.has('cc.circleOverride.c1')).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* γ.2 — optional `versions` adapter (additive)                       */
/* ─────────────────────────────────────────────────────────────────── */

describe('createCirclePolicyStore × versions (γ.2)', () => {
  it('omitting `versions` keeps the pre-γ.2 behaviour (backwards compat)', async () => {
    const mem = {};
    const store = createCirclePolicyStore({
      load: async (id) => mem[id] ?? null,
      save: async (id, p) => { mem[id] = p; },
    });
    await store.update('c1', { llmTool: 'local' });
    expect(mem.c1.llmTool).toBe('local');
    // listVersions exists but returns [].
    expect(await store.listVersions('c1')).toEqual([]);
  });

  it('calls versions.capture BEFORE save, on every update', async () => {
    const order = [];
    const captures = [];
    const versions = {
      capture: async (id, value) => {
        order.push('capture');
        captures.push({ id, value });
      },
      list: async () => [],
    };
    const store = createCirclePolicyStore({
      load: async () => null,
      save: async () => { order.push('save'); },
      versions,
    });
    await store.update('c1', { llmTool: 'local' });
    expect(order).toEqual(['capture', 'save']);
    expect(captures).toHaveLength(1);
    expect(captures[0].id).toBe('c1');
    expect(captures[0].value.llmTool).toBe('local');
  });

  it('listVersions delegates to the adapter', async () => {
    const versions = {
      capture: async () => {},
      list: async (id) => [{ ts: 1, sha256: 'x', value: { id } }],
    };
    const store = createCirclePolicyStore({ versions });
    const list = await store.listVersions('c1');
    expect(list).toEqual([{ ts: 1, sha256: 'x', value: { id: 'c1' } }]);
  });

  it('a throwing versions.capture does not break save', async () => {
    let saved = null;
    const versions = {
      capture: async () => { throw new Error('history disk gone'); },
      list: async () => [],
    };
    const store = createCirclePolicyStore({
      load: async () => null,
      save: async (id, p) => { saved = p; },
      versions,
    });
    await store.update('c1', { llmTool: 'local' });
    expect(saved.llmTool).toBe('local');
  });

  it('a throwing versions.list returns [] (callers see no exception)', async () => {
    const versions = {
      capture: async () => {},
      list: async () => { throw new Error('x'); },
    };
    const store = createCirclePolicyStore({ versions });
    expect(await store.listVersions('c1')).toEqual([]);
  });

  it('restoreVersion persists the restored snapshot via capture + save (wholesale, normalised)', async () => {
    const order = [];
    let saved = null;
    const versions = {
      capture: async () => { order.push('capture'); },
      list: async () => [],
      restore: async (id, ts) => (id === 'c1' && ts === 7 ? { llmTool: 'local' } : null),
    };
    const store = createCirclePolicyStore({
      load: async () => ({ llmTool: 'shared' }),   // current live value ≠ snapshot
      save: async (id, p) => { order.push('save'); saved = p; },
      versions,
    });
    const result = await store.restoreVersion('c1', 7);
    expect(order).toEqual(['capture', 'save']);    // restore re-enters history, then lands live
    expect(result.llmTool).toBe('local');
    expect(saved.llmTool).toBe('local');
  });

  it('restoreVersion returns null for an unknown ts and when no adapter/restore is wired', async () => {
    let saveCalls = 0;
    const versions = {
      capture: async () => {},
      list: async () => [],
      restore: async () => null,
    };
    const store = createCirclePolicyStore({
      load: async () => null,
      save: async () => { saveCalls += 1; },
      versions,
    });
    expect(await store.restoreVersion('c1', 999)).toBeNull();
    expect(saveCalls).toBe(0);                     // nothing persisted on a miss

    const bare = createCirclePolicyStore({ load: async () => null, save: async () => {} });
    expect(await bare.restoreVersion('c1', 1)).toBeNull();
  });
});
