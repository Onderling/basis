/**
 * basis v2 — the network-change watcher (Nearby step C, shell half).
 *
 * `reannounce()` fixes the state; this decides WHEN to call it. Detecting a network change is inherently
 * platform work (`online` events on web, `AppState` on React Native), so the detection is injected and
 * everything else — coalescing, the guard, the error handling — lives here, once, for both shells
 * (invariants 1/2).
 *
 * ── Why coalescing is the whole job ──────────────────────────────────────────────────────────────────────
 * A single real-world Wi-Fi switch is not one event. It is a burst: offline, then online, then a
 * connection-type change, sometimes twice, sometimes with a DHCP pause in the middle. Re-announcing on each
 * one would tear down and re-register the mDNS service several times in a second — multicast traffic on a
 * network that is still settling, and each restart drops the discovery listener that was about to find
 * someone. So the watcher waits for the burst to go quiet and fires ONCE.
 *
 * It also never fires on subscribe. Starting the app is not a network change; the transport was just brought
 * up and announcing again immediately would be pure noise.
 */

/**
 * @param {object} deps
 * @param {(onEvent: () => void) => (() => void)} deps.subscribe
 *   platform hook: call `onEvent` whenever the network may have changed; return an unsubscribe.
 * @param {() => any} deps.onChange           what to do — in practice `adapter.onNetworkChange()`
 * @param {number} [deps.coalesceMs=1500]     how long the burst must be quiet before firing
 * @param {(fn: Function, ms: number) => any} [deps.setTimer]    injectable for tests
 * @param {(handle: any) => void}             [deps.clearTimer]
 * @param {(err: Error, phase: string) => void} [deps.onError]
 * @returns {{start, stop, isWatching, pendingCount}}
 */
export function createNetworkChangeWatcher({
  subscribe,
  onChange,
  coalesceMs = 1_500,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
  onError = null,
} = {}) {
  let unsubscribe = null;
  let timer = null;
  let pending = 0;

  const report = (err, phase) => { try { onError?.(err, phase); } catch { /* diagnostics only */ } };

  const fire = () => {
    timer = null;
    pending = 0;
    try { onChange?.(); }
    catch (err) { report(err, 'onChange'); }   // a throwing handler must not kill the watcher
  };

  const bump = () => {
    // Only while started. A platform source that keeps calling after unsubscribe (they do) must not
    // resurrect a stopped watcher — that is how a "Nearby closed" state starts re-announcing again.
    if (!unsubscribe) return;
    pending += 1;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(fire, coalesceMs);
  };

  return {
    /** Begin watching. Idempotent — a second `start()` does not double-subscribe. */
    start() {
      if (unsubscribe) return;
      if (typeof subscribe !== 'function') return;   // no platform source (server render, test) — fine
      try {
        unsubscribe = subscribe(bump) ?? (() => {});
      } catch (err) {
        unsubscribe = null;
        report(err, 'subscribe');
      }
    },

    /** Stop watching and drop any burst still being coalesced. */
    stop() {
      if (timer !== null) { clearTimer(timer); timer = null; }
      pending = 0;
      if (unsubscribe) {
        try { unsubscribe(); } catch (err) { report(err, 'unsubscribe'); }
        unsubscribe = null;
      }
    },

    isWatching: () => unsubscribe !== null,
    /** How many events the current burst has absorbed — 0 when idle. Diagnostics. */
    pendingCount: () => pending,
  };
}
