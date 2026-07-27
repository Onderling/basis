/**
 * The RN network-change source (Nearby step C, mobile half).
 *
 * `AppState` is the signal available without a new native dependency, so what needs pinning is that it fires
 * on the transition INTO the foreground and on nothing else — a device on its way to being suspended must
 * not re-announce.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ appState: { currentState: 'active', addEventListener: null } }));
vi.mock('react-native', () => ({ AppState: h.appState }));

import { subscribeToNetworkChange, combineSources } from '../src/networkChangeSource.js';

/** A controllable AppState. */
function fakeAppState(initial = 'active') {
  let handler = null;
  const remove = vi.fn();
  return {
    currentState: initial,
    addEventListener: vi.fn((_evt, fn) => { handler = fn; return { remove }; }),
    go: (state) => handler?.(state),
    remove,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('AppState as a network-change signal', () => {
  it('fires when the app comes BACK to the foreground', () => {
    // The dominant real case: you left the café, walked home, and reopened the app on a new network.
    const appState = fakeAppState('active');
    const onEvent = vi.fn();
    subscribeToNetworkChange(onEvent, { appState });

    appState.go('background');
    expect(onEvent).not.toHaveBeenCalled();     // going away is not a trigger

    appState.go('active');
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire on backgrounding — nobody is awake to hear the announcement', () => {
    const appState = fakeAppState('active');
    const onEvent = vi.fn();
    subscribeToNetworkChange(onEvent, { appState });
    appState.go('inactive');
    appState.go('background');
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('does not fire on active → active (a repeated event is not a return)', () => {
    const appState = fakeAppState('active');
    const onEvent = vi.fn();
    subscribeToNetworkChange(onEvent, { appState });
    appState.go('active');
    appState.go('active');
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('handles iOS inactive → active → background → active', () => {
    const appState = fakeAppState('active');
    const onEvent = vi.fn();
    subscribeToNetworkChange(onEvent, { appState });
    appState.go('inactive');
    appState.go('active');            // 1 — came back
    appState.go('background');
    appState.go('active');            // 2 — came back again
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it('starting from background counts the first foreground as a return', () => {
    const appState = fakeAppState('background');
    const onEvent = vi.fn();
    subscribeToNetworkChange(onEvent, { appState });
    appState.go('active');
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe removes the listener', () => {
    const appState = fakeAppState();
    const stop = subscribeToNetworkChange(vi.fn(), { appState });
    stop();
    expect(appState.remove).toHaveBeenCalled();
  });

  it('an AppState without addEventListener is a no-op, not a crash', () => {
    const stop = subscribeToNetworkChange(vi.fn(), { appState: {} });
    expect(() => stop()).not.toThrow();
  });
});

describe('combineSources — the seam for adding netinfo later', () => {
  it('fans one handler out to every source and unsubscribes them all', () => {
    const stopA = vi.fn(); const stopB = vi.fn();
    let emitA; let emitB;
    const subscribe = combineSources([
      (fn) => { emitA = fn; return stopA; },
      (fn) => { emitB = fn; return stopB; },
    ]);
    const onEvent = vi.fn();
    const stop = subscribe(onEvent);

    emitA(); emitB();
    expect(onEvent).toHaveBeenCalledTimes(2);

    stop();
    expect(stopA).toHaveBeenCalled();
    expect(stopB).toHaveBeenCalled();
  });

  it('one broken source does not take the others down', () => {
    const stopB = vi.fn();
    let emitB;
    const subscribe = combineSources([
      () => { throw new Error('netinfo not installed'); },
      (fn) => { emitB = fn; return stopB; },
    ]);
    const onEvent = vi.fn();
    const stop = subscribe(onEvent);
    emitB();
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(() => stop()).not.toThrow();
  });
});
