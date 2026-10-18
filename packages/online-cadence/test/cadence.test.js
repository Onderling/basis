/**
 * cadence — substrate-level coverage. The same scenarios live in
 * apps/pinboard-mobile/test/activeCadence.test.js, which now reaches
 * this code through the re-export shim — running both proves the
 * lift is back-compat.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createActiveCadence, _internal } from '../src/cadence.js';

function makeAppStateStub(initialState = 'active') {
  const listeners = new Set();
  return {
    currentState: initialState,
    addEventListener(evt, cb) {
      if (evt !== 'change') throw new Error('only "change" supported in stub');
      listeners.add(cb);
      return { remove: () => listeners.delete(cb) };
    },
    fire(next) {
      this.currentState = next;
      for (const cb of listeners) cb(next);
    },
    listenerCount: () => listeners.size,
  };
}

describe('createActiveCadence — input validation', () => {
  it('throws if runOnce is missing', () => {
    expect(() => createActiveCadence({ AppState: makeAppStateStub() })).toThrow(/runOnce/);
  });
  it('throws if AppState is missing', () => {
    expect(() => createActiveCadence({ runOnce: async () => {} })).toThrow(/AppState/);
  });
});

describe('createActiveCadence — ticking on foreground', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(()  => { vi.useRealTimers(); });

  it('starts ticking immediately when AppState is active', () => {
    const runOnce = vi.fn(async () => ({}));
    const App = makeAppStateStub('active');
    const c = createActiveCadence({ runOnce, AppState: App, getPollIntervalMs: () => 5000 });
    c.start();
    expect(c.isActive()).toBe(true);
    expect(c._state().ticking).toBe(true);
    vi.advanceTimersByTime(15_000);
    expect(runOnce).toHaveBeenCalledTimes(3);
    c.stop();
  });

  it('does not tick when started in background', () => {
    const runOnce = vi.fn(async () => ({}));
    const App = makeAppStateStub('background');
    const c = createActiveCadence({ runOnce, AppState: App });
    c.start();
    vi.advanceTimersByTime(20_000);
    expect(runOnce).not.toHaveBeenCalled();
    c.stop();
  });

  it('starts/stops ticking on AppState transitions', () => {
    const runOnce = vi.fn(async () => ({}));
    const App = makeAppStateStub('background');
    const c = createActiveCadence({ runOnce, AppState: App, getPollIntervalMs: () => 5000 });
    c.start();
    App.fire('active');
    expect(c._state().ticking).toBe(true);
    App.fire('background');
    expect(c._state().ticking).toBe(false);
    c.stop();
  });
});

describe('createActiveCadence — refresh', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(()  => { vi.useRealTimers(); });

  it('changes ticking interval after refresh()', () => {
    const runOnce = vi.fn(async () => ({}));
    const App = makeAppStateStub('active');
    let interval = 5000;
    const c = createActiveCadence({
      runOnce, AppState: App, getPollIntervalMs: () => interval,
    });
    c.start();
    vi.advanceTimersByTime(10_000);
    expect(runOnce).toHaveBeenCalledTimes(2);
    interval = 1000;
    c.refresh();
    runOnce.mockClear();
    vi.advanceTimersByTime(3_000);
    expect(runOnce).toHaveBeenCalledTimes(3);
    c.stop();
  });
});

describe('createActiveCadence — error handling + teardown', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(()  => { vi.useRealTimers(); });

  it('keeps ticking after a runOnce rejection', async () => {
    let calls = 0;
    const runOnce = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error('boom');
      return {};
    });
    const errors = [];
    const App = makeAppStateStub('active');
    const c = createActiveCadence({
      runOnce, AppState: App, getPollIntervalMs: () => 5000,
      onError: (e) => errors.push(e),
    });
    c.start();
    vi.advanceTimersByTime(15_000);
    await Promise.resolve(); await Promise.resolve();
    expect(runOnce.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(errors[0].message).toBe('boom');
    c.stop();
  });

  it('stop() removes the AppState subscription', () => {
    const App = makeAppStateStub('active');
    const c = createActiveCadence({ runOnce: async () => {}, AppState: App });
    c.start();
    expect(App.listenerCount()).toBe(1);
    c.stop();
    expect(App.listenerCount()).toBe(0);
  });

  it('start()/stop() are idempotent', () => {
    const App = makeAppStateStub('active');
    const c = createActiveCadence({ runOnce: async () => {}, AppState: App });
    c.start(); c.start();
    expect(App.listenerCount()).toBe(1);
    c.stop(); c.stop();
    expect(App.listenerCount()).toBe(0);
  });
});

describe('_internal._resolveInterval', () => {
  it('clamps below the minimum', () => {
    expect(_internal._resolveInterval(() => 50)).toBe(_internal.MIN_POLL_INTERVAL_MS);
  });
  it('falls back on non-numbers / errors', () => {
    expect(_internal._resolveInterval(() => 'fast')).toBe(_internal.DEFAULT_POLL_INTERVAL_MS);
    expect(_internal._resolveInterval(() => null)).toBe(_internal.DEFAULT_POLL_INTERVAL_MS);
    expect(_internal._resolveInterval(() => NaN)).toBe(_internal.DEFAULT_POLL_INTERVAL_MS);
    expect(_internal._resolveInterval(() => { throw new Error('x'); }))
      .toBe(_internal.DEFAULT_POLL_INTERVAL_MS);
  });
});
