/**
 * The netinfo network-change source (Nearby step C).
 *
 * This exists for the one case `AppState` structurally cannot see: the network changing while the app is in
 * the FOREGROUND. Two things need pinning, and both are about NOT firing:
 *
 *   1. the first emission is the CURRENT state, not a change — netinfo delivers it on subscribe, and acting
 *      on it would re-announce on every app start;
 *   2. netinfo emits on updates that change nothing we route on (signal strength, a details refresh).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@react-native-community/netinfo', () => ({ default: { addEventListener: () => () => {} } }));

import { subscribeToNetInfo } from '../src/netinfoSource.js';

/** A controllable NetInfo. */
function fakeNetInfo() {
  let handler = null;
  const unsubscribe = vi.fn();
  return {
    addEventListener: vi.fn((fn) => { handler = fn; return unsubscribe; }),
    emit: (state) => handler?.(state),
    unsubscribe,
  };
}

const wifi = (over = {}) => ({
  type: 'wifi', isConnected: true,
  details: { ipAddress: '192.168.1.20', ssid: 'home', ...over },
});

let netInfo; let onEvent;
beforeEach(() => {
  vi.clearAllMocks();
  netInfo = fakeNetInfo();
  onEvent = vi.fn();
});

describe('what counts as a change', () => {
  it('THE CASE THIS EXISTS FOR: Wi-Fi → Wi-Fi, where `type` never changes', () => {
    // AppState sees nothing here — the app never left the foreground. Only the address moved.
    subscribeToNetInfo(onEvent, { netInfo });
    netInfo.emit(wifi());                                        // priming
    netInfo.emit(wifi({ ipAddress: '10.0.0.9', ssid: 'cafe' })); // walked next door
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('wifi → cellular → wifi', () => {
    subscribeToNetInfo(onEvent, { netInfo });
    netInfo.emit(wifi());
    netInfo.emit({ type: 'cellular', isConnected: true, details: {} });
    netInfo.emit(wifi());
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it('a drop and a restore both count', () => {
    subscribeToNetInfo(onEvent, { netInfo });
    netInfo.emit(wifi());
    netInfo.emit({ type: 'none', isConnected: false, details: {} });
    netInfo.emit(wifi());
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it('catches a switch even when the platform withholds the SSID', () => {
    // Android needs location permission for SSID and often reports null, which is why ipAddress carries
    // the weight rather than being a nice-to-have.
    subscribeToNetInfo(onEvent, { netInfo });
    netInfo.emit(wifi({ ssid: null }));
    netInfo.emit(wifi({ ssid: null, ipAddress: '172.16.0.4' }));
    expect(onEvent).toHaveBeenCalledTimes(1);
  });
});

describe('what does NOT count', () => {
  it('the first emission is the current state, not a change', () => {
    // Otherwise every app start re-announces — "never fire on subscribe", one layer lower.
    subscribeToNetInfo(onEvent, { netInfo });
    netInfo.emit(wifi());
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('an update that changes nothing we route on is ignored', () => {
    subscribeToNetInfo(onEvent, { netInfo });
    netInfo.emit(wifi());
    netInfo.emit(wifi());                                  // identical
    netInfo.emit(wifi({ strength: 3 }));                   // a field we do not care about
    netInfo.emit({ ...wifi(), isInternetReachable: false });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('a repeated switch back and forth fires each way', () => {
    subscribeToNetInfo(onEvent, { netInfo });
    netInfo.emit(wifi({ ipAddress: '1.1.1.1' }));
    netInfo.emit(wifi({ ipAddress: '2.2.2.2' }));
    netInfo.emit(wifi({ ipAddress: '1.1.1.1' }));
    expect(onEvent).toHaveBeenCalledTimes(2);
  });
});

describe('lifecycle', () => {
  it('unsubscribe calls netinfo\'s unsubscribe', () => {
    const stop = subscribeToNetInfo(onEvent, { netInfo });
    stop();
    expect(netInfo.unsubscribe).toHaveBeenCalled();
  });

  it('a NetInfo without addEventListener is a no-op, not a crash', () => {
    const stop = subscribeToNetInfo(onEvent, { netInfo: {} });
    expect(() => stop()).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('a non-function handler is refused', () => {
    const stop = subscribeToNetInfo(null, { netInfo });
    expect(netInfo.addEventListener).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });

  it('a null state does not throw', () => {
    subscribeToNetInfo(onEvent, { netInfo });
    expect(() => { netInfo.emit(null); netInfo.emit(null); }).not.toThrow();
  });
});
