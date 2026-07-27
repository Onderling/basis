/**
 * The network-change watcher + the web platform source (Nearby step C, shell half).
 *
 * The behaviour that matters is COALESCING: a real Wi-Fi switch is a burst of events, and re-announcing on
 * each would restart the mDNS service several times on a network that is still settling. Everything else
 * here is about not firing when we should not — on subscribe, after stop, or into a throwing handler.
 */
import { describe, it, expect, vi } from 'vitest';
import { createNetworkChangeWatcher }  from '../../src/v2/networkChangeWatcher.js';
import { subscribeToNetworkChange }    from '../../src/web/networkChangeSource.js';

/** A controllable timer, so the coalescing window is exact rather than slept through. */
function fakeTimers() {
  let next = 1;
  const scheduled = new Map();
  return {
    setTimer: (fn, ms) => { const id = next++; scheduled.set(id, { fn, ms }); return id; },
    clearTimer: (id) => scheduled.delete(id),
    /** Run every timer currently scheduled (the coalescing window elapsing). */
    tick() { const due = [...scheduled.values()]; scheduled.clear(); for (const t of due) t.fn(); },
    count: () => scheduled.size,
  };
}

function wire({ onChange = vi.fn(), onError } = {}) {
  const t = fakeTimers();
  let emit = null;
  const unsub = vi.fn();
  const watcher = createNetworkChangeWatcher({
    subscribe: (fn) => { emit = fn; return unsub; },
    onChange, onError, coalesceMs: 1_000,
    setTimer: t.setTimer, clearTimer: t.clearTimer,
  });
  return { watcher, timers: t, onChange, unsub, emit: (...a) => emit?.(...a) };
}

describe('coalescing a burst', () => {
  it('THE POINT: five events in one burst re-announce ONCE', async () => {
    const { watcher, timers, emit, onChange } = wire();
    watcher.start();

    for (let i = 0; i < 5; i += 1) emit();      // offline → online → change → change → change
    expect(onChange).not.toHaveBeenCalled();    // nothing yet — the network is still settling
    expect(watcher.pendingCount()).toBe(5);

    timers.tick();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(watcher.pendingCount()).toBe(0);
  });

  it('two bursts separated by quiet fire twice', async () => {
    const { watcher, timers, emit, onChange } = wire();
    watcher.start();

    emit(); emit(); timers.tick();
    emit();          timers.tick();

    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('does NOT fire on subscribe — starting the app is not a network change', () => {
    const { watcher, timers, onChange } = wire();
    watcher.start();
    timers.tick();
    expect(onChange).not.toHaveBeenCalled();
    expect(timers.count()).toBe(0);   // nothing was even scheduled
  });
});

describe('not firing when it should not', () => {
  it('a source that keeps emitting after stop cannot resurrect the watcher', () => {
    // Platform sources really do this — a removed listener can still be mid-dispatch.
    const { watcher, timers, emit, onChange } = wire();
    watcher.start();
    watcher.stop();

    emit(); emit();
    timers.tick();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('stop() drops a burst that was still being coalesced', () => {
    const { watcher, timers, emit, onChange } = wire();
    watcher.start();
    emit();
    watcher.stop();
    timers.tick();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('start() is idempotent — no double subscription', () => {
    const subscribe = vi.fn(() => () => {});
    const w = createNetworkChangeWatcher({ subscribe, onChange: vi.fn() });
    w.start(); w.start(); w.start();
    expect(subscribe).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it('stop() unsubscribes, and is safe without a start', () => {
    const { watcher, unsub } = wire();
    watcher.stop();                      // no start yet
    expect(unsub).not.toHaveBeenCalled();
    watcher.start();
    watcher.stop();
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(watcher.isWatching()).toBe(false);
  });
});

describe('failures stay contained', () => {
  it('a throwing onChange does not kill the watcher', () => {
    const onError = vi.fn();
    const onChange = vi.fn(() => { throw new Error('reannounce blew up'); });
    const { watcher, timers, emit } = wire({ onChange, onError });
    watcher.start();

    emit(); timers.tick();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'onChange');

    emit(); timers.tick();               // still watching
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('a throwing subscribe leaves the watcher stopped rather than half-wired', () => {
    const onError = vi.fn();
    const w = createNetworkChangeWatcher({
      subscribe: () => { throw new Error('no window'); }, onChange: vi.fn(), onError,
    });
    w.start();
    expect(w.isWatching()).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'subscribe');
  });

  it('no platform source at all is a no-op, not a crash (SSR, tests)', () => {
    const w = createNetworkChangeWatcher({ onChange: vi.fn() });
    expect(() => { w.start(); w.stop(); }).not.toThrow();
    expect(w.isWatching()).toBe(false);
  });
});

describe('the web source', () => {
  const fakeWin = () => {
    const handlers = new Map();
    const conn = {
      addEventListener: (e, fn) => handlers.set(`conn:${e}`, fn),
      removeEventListener: (e) => handlers.delete(`conn:${e}`),
    };
    return {
      handlers,
      win: {
        addEventListener: (e, fn) => handlers.set(e, fn),
        removeEventListener: (e) => handlers.delete(e),
        navigator: { connection: conn },
      },
    };
  };

  it('listens to online, offline AND the connection change', () => {
    const { win, handlers } = fakeWin();
    const stop = subscribeToNetworkChange(vi.fn(), { win });
    expect([...handlers.keys()].sort()).toEqual(['conn:change', 'offline', 'online']);
    stop();
    expect(handlers.size).toBe(0);
  });

  it('a Wi-Fi SWITCH is caught by connection-change, which never goes offline', () => {
    // The case `online`/`offline` alone misses: browser stays "online" the whole time.
    const { win, handlers } = fakeWin();
    const onEvent = vi.fn();
    subscribeToNetworkChange(onEvent, { win });
    handlers.get('conn:change')();
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('works without the Network Information API (Safari, Firefox)', () => {
    const { win, handlers } = fakeWin();
    delete win.navigator.connection;
    const onEvent = vi.fn();
    const stop = subscribeToNetworkChange(onEvent, { win });
    expect([...handlers.keys()].sort()).toEqual(['offline', 'online']);
    handlers.get('online')();
    expect(onEvent).toHaveBeenCalledTimes(1);
    stop();
  });

  it('no window at all returns a usable no-op', () => {
    const stop = subscribeToNetworkChange(vi.fn(), { win: null });
    expect(() => stop()).not.toThrow();
  });
});

describe('end to end: a Wi-Fi switch re-announces once', () => {
  it('browser burst → one onNetworkChange', () => {
    const { win, handlers } = (() => {
      const handlers = new Map();
      const conn = { addEventListener: (e, fn) => handlers.set(`conn:${e}`, fn), removeEventListener: () => {} };
      return { handlers, win: { addEventListener: (e, fn) => handlers.set(e, fn), removeEventListener: () => {}, navigator: { connection: conn } } };
    })();

    const timers = fakeTimers();
    const onNetworkChange = vi.fn();
    const watcher = createNetworkChangeWatcher({
      subscribe: (fn) => subscribeToNetworkChange(fn, { win }),
      onChange: onNetworkChange,
      coalesceMs: 1_000,
      setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    });
    watcher.start();

    // What actually happens when you walk out of a café and onto home Wi-Fi.
    handlers.get('offline')();
    handlers.get('online')();
    handlers.get('conn:change')();

    expect(onNetworkChange).not.toHaveBeenCalled();
    timers.tick();
    expect(onNetworkChange).toHaveBeenCalledTimes(1);
  });
});
