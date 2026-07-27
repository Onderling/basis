/**
 * G15 — push-token registrations survive a relay restart.
 *
 * The failure this closes is the quiet kind. `PushTokenRegistry` was an in-memory `Map`, and a client
 * re-registers its token only after it RECONNECTS — but a sleeping device never reconnects, so it never
 * re-registers, so after a relay restart it is never woken again. Nothing errors. Wakes just stop, for
 * exactly the devices the wake exists to serve.
 *
 * Design points pinned here, because each was a decision:
 *   • the read API stays SYNCHRONOUS (`get`/`markPushed` are on the relay's hot path) — the Map is the
 *     working set and the store is write-through;
 *   • `lastPushedAt` is deliberately NOT persisted — it is a throttle hint, and forgetting it costs at most
 *     one extra wake, where persisting it would cost a write on every push;
 *   • no store ⇒ byte-for-byte V0 behaviour, so nothing existing changes.
 */
import { describe, it, expect } from 'vitest';
import { PushTokenRegistry } from '../../src/push/PushTokenRegistry.js';
import { MemoryPushTokenStore, PushTokenStore } from '../../src/push/PushTokenStore.js';

const CATO = 'cato-addr';
const TOKEN = 'ExponentPushToken[cato]';

describe('a registration outlives the process that took it', () => {
  it('a restarted registry still knows a sleeping device', async () => {
    const store = new MemoryPushTokenStore();

    const before = new PushTokenRegistry({ store });
    before.register(CATO, { token: TOKEN, platform: 'ios' });
    expect(before.get(CATO)?.token).toBe(TOKEN);
    await new Promise((r) => setImmediate(r));            // let the write-through land

    // ── the relay restarts ───────────────────────────────────────────────────
    const after = new PushTokenRegistry({ store });
    expect(after.get(CATO), 'nothing before hydrate — the Map really is empty').toBeNull();
    expect(await after.hydrate()).toBe(1);

    expect(after.get(CATO)?.token).toBe(TOKEN);
    expect(after.get(CATO)?.platform).toBe('ios');
    expect(after.size()).toBe(1);
  });

  it('WITHOUT a store the same restart forgets — the bug this closes', async () => {
    // The control: it must be persistence doing the work, not the harness.
    const before = new PushTokenRegistry();
    before.register(CATO, { token: TOKEN, platform: 'ios' });
    const after = new PushTokenRegistry();
    expect(await after.hydrate()).toBe(0);
    expect(after.get(CATO)).toBeNull();
  });

  it('an UNREGISTER is persisted too — a restart must not resurrect a revoked token', async () => {
    // The dangerous direction: a device that turned notifications off must stay off.
    const store = new MemoryPushTokenStore();
    const before = new PushTokenRegistry({ store });
    before.register(CATO, { token: TOKEN, platform: 'ios' });
    await new Promise((r) => setImmediate(r));
    before.unregister(CATO);
    await new Promise((r) => setImmediate(r));

    const after = new PushTokenRegistry({ store });
    await after.hydrate();
    expect(after.get(CATO)).toBeNull();
  });

  it('re-registering replaces rather than duplicates, across a restart', async () => {
    const store = new MemoryPushTokenStore();
    const before = new PushTokenRegistry({ store });
    before.register(CATO, { token: 'old-token', platform: 'ios' });
    before.register(CATO, { token: 'new-token', platform: 'android' });
    await new Promise((r) => setImmediate(r));

    const after = new PushTokenRegistry({ store });
    expect(await after.hydrate()).toBe(1);
    expect(after.get(CATO)?.token).toBe('new-token');
    expect(after.get(CATO)?.platform).toBe('android');
  });

  it('`lastPushedAt` is NOT restored — the throttle resets, which is the safe direction', async () => {
    const store = new MemoryPushTokenStore();
    const before = new PushTokenRegistry({ store });
    before.register(CATO, { token: TOKEN, platform: 'ios' });
    before.markPushed(CATO, 1_700_000_000_000);
    expect(before.get(CATO).lastPushedAt).toBe(1_700_000_000_000);
    await new Promise((r) => setImmediate(r));

    const after = new PushTokenRegistry({ store });
    await after.hydrate();
    // Forgotten on purpose: worst case one extra wake, versus a disk write on every push.
    expect(after.get(CATO).lastPushedAt).toBe(0);
    expect(after.get(CATO).token).toBe(TOKEN);            // …while the durable fact survived
  });
});

describe('the store never takes the relay down with it', () => {
  it('a store that throws on write leaves the live registration intact', async () => {
    class Broken extends PushTokenStore {
      async put() { throw new Error('disk full'); }
      async remove() { throw new Error('disk full'); }
      async list() { return []; }
      async clear() {}
    }
    const reg = new PushTokenRegistry({ store: new Broken() });
    expect(() => reg.register(CATO, { token: TOKEN, platform: 'ios' })).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(reg.get(CATO)?.token).toBe(TOKEN);             // the wake still works this run
  });

  it('a store returning junk degrades to fewer registrations, never to a crash', async () => {
    for (const rows of [null, undefined, 'not an array', [{ address: 'x' }], [{ token: 'y' }], [{}]]) {
      class Junk extends PushTokenStore {
        async list() { return rows; }
        async put() {} async remove() {} async clear() {}
      }
      const reg = new PushTokenRegistry({ store: new Junk() });
      await expect(reg.hydrate()).resolves.toBeTypeOf('number');
      expect(reg.size(), `rows=${JSON.stringify(rows)}`).toBe(0);
    }
  });
});

describe('the SQLite store round-trips', () => {
  it('put / list / remove / clear behave like the memory one', async () => {
    // `better-sqlite3` is a real dependency of this package, but the constructor is injected so the store
    // can be unit-tested (and so a host without native bindings can still run the relay memory-only).
    const { default: Database } = await import('better-sqlite3');
    const { SqlitePushTokenStore } = await import('../../src/push/PushTokenStore.js');
    const store = new SqlitePushTokenStore({ path: ':memory:', Database });

    await store.put({ address: CATO, token: TOKEN, platform: 'ios', registeredAt: 42 });
    expect(await store.list()).toEqual([{ address: CATO, token: TOKEN, platform: 'ios', registeredAt: 42 }]);

    // upsert, not duplicate
    await store.put({ address: CATO, token: 'second', platform: 'android', registeredAt: 43 });
    const rows = await store.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].token).toBe('second');

    await store.remove(CATO);
    expect(await store.list()).toEqual([]);
    store.close();
  });

  it('drives a real registry end to end across a restart', async () => {
    const { default: Database } = await import('better-sqlite3');
    const { SqlitePushTokenStore } = await import('../../src/push/PushTokenStore.js');
    const store = new SqlitePushTokenStore({ path: ':memory:', Database });

    const before = new PushTokenRegistry({ store });
    before.register(CATO, { token: TOKEN, platform: 'ios' });
    await new Promise((r) => setImmediate(r));

    const after = new PushTokenRegistry({ store });
    expect(await after.hydrate()).toBe(1);
    expect(after.get(CATO)?.token).toBe(TOKEN);
    store.close();
  });
});
