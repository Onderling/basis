/**
 * React Native — the platform half of the network-change watcher (Nearby step C).
 *
 * Lives in the RN substrate rather than in one shell, so basis-mobile, stoop-mobile and folio-mobile get the
 * same source. It knows which RN signals mean "the network may have changed" and nothing else; the
 * coalescing and the decision to re-announce live in basis's shared `v2/networkChangeWatcher.js`.
 *
 * ── What this covers, and what it does NOT ───────────────────────────────────────────────────────────────
 * It uses `AppState` — a foreground transition. That is the dominant real case by a wide margin: you leave
 * the café, walk home, and open the app again on a different network. The mDNS service registered against
 * the café's interface is dead, and coming back to the foreground is exactly when that matters.
 *
 * **It does not detect a Wi-Fi switch while the app is in the FOREGROUND** — `AppState` structurally cannot
 * see one. That case is covered by the netinfo source in `netinfoSource.js`, kept separate because it
 * statically imports a native module (the repo's pattern for those; see `BleTransport`). Compose them:
 *
 *     import { subscribeToNetworkChange, combineSources } from '@onderling/react-native';
 *     import { subscribeToNetInfo }                        from '@onderling/react-native/netinfo';
 *
 *     const subscribe = combineSources([subscribeToNetworkChange, subscribeToNetInfo]);
 *
 * Both together is the intended wiring, and they overlap harmlessly — the watcher coalesces the burst, so a
 * change both sources notice still re-announces once. → `plans/PLAN-nearby.md`.
 */
import { AppState } from 'react-native';

/**
 * Subscribe to RN signals that the network may have changed.
 *
 * @param {() => void} onEvent   called on each signal — the watcher coalesces the burst
 * @param {object} [opts]
 * @param {object} [opts.appState]  injectable AppState, for tests
 * @returns {() => void} unsubscribe
 */
export function subscribeToNetworkChange(onEvent, { appState = AppState } = {}) {
  if (typeof onEvent !== 'function' || typeof appState?.addEventListener !== 'function') return () => {};

  // Only the transition INTO the foreground counts. Firing on background too would re-announce a device
  // that is on its way to being suspended — multicast traffic nobody is awake to hear.
  let last = appState.currentState ?? 'active';
  const sub = appState.addEventListener('change', (next) => {
    const cameToForeground = next === 'active' && last !== 'active';
    last = next;
    if (cameToForeground) onEvent();
  });

  return () => { try { sub?.remove?.(); } catch { /* best-effort teardown */ } };
}

/**
 * Compose several sources into one `subscribe`.
 *
 * Exists so adding a netinfo source later is additive rather than a rewrite of whoever wired this up.
 *
 * @param {Array<(onEvent: () => void) => (() => void)>} sources
 * @returns {(onEvent: () => void) => (() => void)}
 */
export function combineSources(sources = []) {
  return (onEvent) => {
    const stops = sources.map((s) => {
      try { return s(onEvent) ?? (() => {}); }
      catch { return () => {}; }   // one broken source must not take the others down
    });
    return () => { for (const stop of stops) { try { stop(); } catch { /* best-effort */ } } };
  };
}
