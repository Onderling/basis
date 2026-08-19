/**
 * Stoop V1 — Phase 4 tests.
 *
 * CachingDataSource: local-first reads + queued writes + flush on
 * online + attachInner mid-flight.
 * SyncCadence: foreground-only ticking.
 * Agent factory: cache wired by default; bundle.cache exposed.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, MemorySource, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { CachingDataSource } from '../src/lib/CachingDataSource.js';
import { SyncCadence }       from '../src/lib/SyncCadence.js';
import { createNeighbourhoodAgent } from '../src/index.js';

const ANNE = 'https://id.example/anne';

// ── CachingDataSource basics ──────────────────────────────────────────────

describe('CachingDataSource — pure local mode (no inner)', () => {
  it('writes + reads locally with no inner attached', async () => {
    const cache = new CachingDataSource();
    expect(cache.hasInner).toBe(false);
    expect(cache.queueLength).toBe(0);
    await cache.write('items/1', 'hello');
    expect(await cache.read('items/1')).toBe('hello');
    expect(cache.queueLength).toBe(0);
  });

  it('list / query work over the local map', async () => {
    const cache = new CachingDataSource();
    await cache.write('items/1', JSON.stringify({ kind: 'ask',  text: 'a' }));
    await cache.write('items/2', JSON.stringify({ kind: 'lend', text: 'b' }));
    await cache.write('audit/1', JSON.stringify({ kind: 'audit', text: 'x' }));

    expect(await cache.list('items/')).toEqual(['items/1', 'items/2']);
    const lends = await cache.query({ kind: 'lend' });
    expect(lends).toHaveLength(1);
    expect(lends[0].text).toBe('b');
  });

  it('delete removes the local entry', async () => {
    const cache = new CachingDataSource();
    await cache.write('items/1', 'x');
    await cache.delete('items/1');
    expect(await cache.read('items/1')).toBeNull();
  });
});

describe('CachingDataSource — with an inner DataSource', () => {
  it('reads from local first, falls through to inner on miss', async () => {
    const inner = new MemorySource();
    await inner.write('items/server-only', 'from-server');
    const cache = new CachingDataSource({ inner });

    await cache.write('items/local-only', 'from-local');
    expect(await cache.read('items/local-only')).toBe('from-local');

    // Pulled from inner on first read; subsequent reads stay local.
    expect(await cache.read('items/server-only')).toBe('from-server');
    expect((await cache.list('items/'))).toContain('items/server-only');
  });

  it('writes go to local immediately and queue for inner; flush replays', async () => {
    const inner = new MemorySource();
    const cache = new CachingDataSource({ inner, online: false });

    await cache.write('items/1', 'a');
    await cache.write('items/2', 'b');
    expect(cache.queueLength).toBe(2);
    expect(await inner.read('items/1')).toBeNull();
    expect(await inner.read('items/2')).toBeNull();

    await cache.setOnline(true);
    expect(cache.queueLength).toBe(0);
    expect(await inner.read('items/1')).toBe('a');
    expect(await inner.read('items/2')).toBe('b');
  });

  it('write while online flushes immediately', async () => {
    const inner = new MemorySource();
    const cache = new CachingDataSource({ inner, online: true });
    await cache.write('items/x', 'instant');
    expect(cache.queueLength).toBe(0);
    expect(await inner.read('items/x')).toBe('instant');
  });

  it('inner write failure flips offline and keeps the entry queued', async () => {
    const failing = new MemorySource();
    failing.write = async () => { throw new Error('net-down'); };
    const cache = new CachingDataSource({ inner: failing, online: true });

    const events = [];
    cache.on('offline', (e) => events.push(['offline', e.reason]));

    await cache.write('items/x', 'q');
    expect(cache.isOnline).toBe(false);
    expect(cache.queueLength).toBe(1);
    expect(events.some(([t]) => t === 'offline')).toBe(true);
  });

  it('attachInner swaps an inner mid-flight + flushes queued writes', async () => {
    const cache = new CachingDataSource();   // pure local at start
    await cache.write('items/1', 'a');
    await cache.write('items/2', 'b');
    expect(cache.queueLength).toBe(0);   // no inner = no queue accumulation

    // Now attach an inner; the local cache is already populated, but the
    // queue is empty — `attachInner` does NOT retroactively replay
    // writes that happened pre-attach. Apps that need that pattern call
    // `pullFromInner` after attach to seed the *opposite* direction
    // (pod → local), not push local → pod.
    const inner = new MemorySource();
    await cache.attachInner(inner);
    expect(cache.hasInner).toBe(true);
    expect(cache.queueLength).toBe(0);
    // Subsequent writes flush to inner.
    await cache.write('items/3', 'c');
    expect(await inner.read('items/3')).toBe('c');
  });

  it('attachInner-to-non-null while previous queue had entries does flush', async () => {
    // Variant: inner exists from the start, goes offline mid-session,
    // queue accumulates, going back online flushes.
    const inner = new MemorySource();
    const cache = new CachingDataSource({ inner, online: true });
    await cache.setOnline(false);
    await cache.write('items/1', 'a');
    await cache.write('items/2', 'b');
    expect(cache.queueLength).toBe(2);

    await cache.setOnline(true);
    expect(cache.queueLength).toBe(0);
    expect(await inner.read('items/1')).toBe('a');
    expect(await inner.read('items/2')).toBe('b');
  });

  it('pullFromInner refreshes local from inner', async () => {
    const inner = new MemorySource();
    await inner.write('items/a', 'x');
    await inner.write('items/b', 'y');
    const cache = new CachingDataSource({ inner });
    const n = await cache.pullFromInner('items/');
    expect(n).toBe(2);
    expect(await cache.read('items/a')).toBe('x');
    expect(await cache.read('items/b')).toBe('y');
  });

  it('pullFromInner failure flips offline + rethrows', async () => {
    const failing = new MemorySource();
    failing.list = async () => { throw new Error('list-down'); };
    const cache = new CachingDataSource({ inner: failing, online: true });

    await expect(cache.pullFromInner('items/')).rejects.toThrow(/list-down/);
    expect(cache.isOnline).toBe(false);
  });

  it('emits queued / flushed / online / offline / pulled events', async () => {
    const inner = new MemorySource();
    const cache = new CachingDataSource({ inner, online: false });
    const events = [];
    cache.on('queued',  (e) => events.push(['q', e.op]));
    cache.on('flushed', (e) => events.push(['f', e.count]));
    cache.on('online',  ()  => events.push(['on']));
    cache.on('offline', ()  => events.push(['off']));
    cache.on('pulled',  (e) => events.push(['p', e.count]));

    await cache.write('items/1', 'a');     // queued (offline)
    await cache.setOnline(true);           // online + flushed
    await inner.write('items/2', 'srv');
    await cache.pullFromInner('items/');   // pulled

    expect(events).toEqual([
      ['q', 'write'],
      ['on'],
      ['f', 1],
      ['p', 2],
    ]);
  });
});

// ── SyncCadence ───────────────────────────────────────────────────────────

describe('SyncCadence — foreground-only ticking', () => {
  function buildCadence() {
    let now = 0;
    const timers = [];
    const setTimeoutFn = (fn, delay) => {
      const id = timers.length;
      timers.push({ fn, fireAt: now + delay, cancelled: false });
      return id;
    };
    const clearTimeoutFn = (id) => { if (timers[id]) timers[id].cancelled = true; };
    /**
     * Advance time stepwise to each maturing timer so handlers that
     * call `setTimeoutFn` during their tick see the correct `now`.
     */
    const advance = async (ms) => {
      const target = now + ms;
      while (true) {
        let next = null;
        for (const t of timers) {
          if (!t.cancelled && t.fireAt <= target && (next == null || t.fireAt < next.fireAt)) {
            next = t;
          }
        }
        if (!next) break;
        if (next.fireAt > now) now = next.fireAt;
        next.cancelled = true;
        await next.fn();
      }
      now = target;
    };
    return { advance, setTimeoutFn, clearTimeoutFn, getNow: () => now };
  }

  it('does not tick when foreground=false', async () => {
    const { advance, setTimeoutFn, clearTimeoutFn, getNow } = buildCadence();
    let ticks = 0;
    const cadence = new SyncCadence({
      onTick: () => { ticks += 1; },
      intervalMs: 100,
      now: getNow,
      setTimeoutFn, clearTimeoutFn,
    });
    await advance(1000);
    expect(ticks).toBe(0);
  });

  it('ticks repeatedly while foreground=true', async () => {
    const { advance, setTimeoutFn, clearTimeoutFn, getNow } = buildCadence();
    let ticks = 0;
    const cadence = new SyncCadence({
      onTick: () => { ticks += 1; },
      intervalMs: 100,
      now: getNow,
      setTimeoutFn, clearTimeoutFn,
    });
    cadence.setForeground(true);
    await advance(350);    // 100, 200, 300 → 3 ticks
    expect(ticks).toBe(3);
  });

  it('setForeground(false) stops further ticks', async () => {
    const { advance, setTimeoutFn, clearTimeoutFn, getNow } = buildCadence();
    let ticks = 0;
    const cadence = new SyncCadence({
      onTick: () => { ticks += 1; },
      intervalMs: 100,
      now: getNow,
      setTimeoutFn, clearTimeoutFn,
    });
    cadence.setForeground(true);
    await advance(150);
    expect(ticks).toBe(1);
    cadence.setForeground(false);
    await advance(500);
    expect(ticks).toBe(1);
  });

  it('tickNow fires immediately regardless of foreground', async () => {
    const { advance, setTimeoutFn, clearTimeoutFn, getNow } = buildCadence();
    let ticks = 0;
    const cadence = new SyncCadence({
      onTick: () => { ticks += 1; },
      intervalMs: 100,
      now: getNow,
      setTimeoutFn, clearTimeoutFn,
    });
    await cadence.tickNow();
    expect(ticks).toBe(1);
  });

  it('emits foreground / background / tick events', async () => {
    const { advance, setTimeoutFn, clearTimeoutFn, getNow } = buildCadence();
    const events = [];
    const cadence = new SyncCadence({
      onTick:     async () => {},
      intervalMs: 100,
      setTimeoutFn, clearTimeoutFn,
    });
    cadence.on('foreground', () => events.push('fg'));
    cadence.on('background', () => events.push('bg'));
    cadence.on('tick',       () => events.push('tk'));

    cadence.setForeground(true);
    await advance(100);
    cadence.setForeground(false);
    expect(events).toEqual(['fg', 'tk', 'bg']);
  });

  it('rejects missing onTick', () => {
    expect(() => new SyncCadence({})).toThrow(/onTick/);
  });
});

// ── Agent factory wiring ──────────────────────────────────────────────────

describe('Stoop V1 — Agent factory exposes bundle.cache', () => {
  async function build({ itemBackend, cache } = {}) {
    const id = await AgentIdentity.generate(new VaultMemory());
    const tx = new InternalTransport(new InternalBus(), id.pubKey);
    const bundle = await createNeighbourhoodAgent({
      identity: id,
      transport: tx,
      offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
      itemBackend,
      cache,
    });
    await bundle.offeringMatch.start();
    return bundle;
  }

  it('default factory wires a CachingDataSource (bundle.cache present)', async () => {
    const bundle = await build();
    expect(bundle.cache).toBeInstanceOf(CachingDataSource);
    expect(bundle.cache.hasInner).toBe(false);
    expect(bundle.cache.queueLength).toBe(0);
  });

  it('cache: false bypasses CachingDataSource (legacy behaviour)', async () => {
    const bundle = await build({ cache: false });
    expect(bundle.cache).toBeNull();
  });

  it('attachInner mid-session enables write-through to a pod-shaped backend', async () => {
    const bundle = await build();
    // Boot without pod, do work locally:
    const post = await bundle.agent.skills.get('postRequest').handler({
      parts: [DataPart({ text: 'paint', kind: 'ask', expectClaims: 0, timeoutMs: 1 })],
      from: ANNE,
      agent: bundle.agent,
      envelope: null,
    });
    expect(post.requestId).toBeTruthy();

    // Now sign in: a pod-shaped backend appears.
    const pod = new MemorySource();
    await bundle.cache.attachInner(pod);
    expect(bundle.cache.hasInner).toBe(true);

    // Future writes flush through to the pod.
    await bundle.itemStore.addItems(
      [{ type: 'offer', text: 'tax help' }],
      { actor: ANNE },
    );
    const podPaths = await pod.list('');     // ItemStore prefixes with rootContainer (mem://neighbourhood/)
    expect(podPaths.some(p => p.includes('items/'))).toBe(true);
  });

  it('factory still works with cache + a pre-built itemBackend (write-through)', async () => {
    const inner = new MemorySource();
    const bundle = await build({ itemBackend: inner });
    expect(bundle.cache.hasInner).toBe(true);

    await bundle.itemStore.addItems(
      [{ type: 'ask', text: 'ladder' }],
      { actor: ANNE },
    );
    const podPaths = await inner.list('');
    expect(podPaths.some(p => p.includes('items/'))).toBe(true);
  });
});
