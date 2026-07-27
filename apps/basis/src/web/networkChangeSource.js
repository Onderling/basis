/**
 * basis web — the platform half of the network-change watcher (Nearby step C).
 *
 * A thin adapter: it knows which browser events mean "the network may have changed" and nothing else. The
 * coalescing, the guard and the decision to re-announce all live in the shared
 * `v2/networkChangeWatcher.js` (invariant 1).
 *
 * Two sources, because neither is sufficient alone:
 *
 *   • `online` / `offline` on `window` — universally supported, but only fires on the *connected at all*
 *     transition. Switching from one Wi-Fi network to another never goes offline in the browser's view.
 *   • `navigator.connection`'s `change` — fires on the switch itself (type, effective type, downlink). Not
 *     supported in Safari or Firefox, hence feature-detected rather than assumed.
 *
 * Everything is feature-detected, so this is safe to call under SSR, in a worker, or in a test with no DOM.
 */

/**
 * Subscribe to browser signals that the network may have changed.
 *
 * @param {() => void} onEvent  called (possibly several times in a burst) — the watcher coalesces
 * @param {object} [opts]
 * @param {object} [opts.win]   injectable window, for tests
 * @returns {() => void} unsubscribe
 */
export function subscribeToNetworkChange(onEvent, { win = (typeof window !== 'undefined' ? window : null) } = {}) {
  if (!win || typeof onEvent !== 'function') return () => {};

  const cleanups = [];

  if (typeof win.addEventListener === 'function') {
    // `offline` is included deliberately: on its own it is not a re-announce trigger, but it is the first
    // event of the burst that a Wi-Fi switch produces, so counting it keeps the coalescing window open
    // until the reconnect actually lands rather than firing twice.
    for (const evt of ['online', 'offline']) {
      win.addEventListener(evt, onEvent);
      cleanups.push(() => win.removeEventListener(evt, onEvent));
    }
  }

  const conn = win.navigator?.connection;
  if (conn && typeof conn.addEventListener === 'function') {
    conn.addEventListener('change', onEvent);
    cleanups.push(() => conn.removeEventListener('change', onEvent));
  }

  return () => { for (const fn of cleanups) { try { fn(); } catch { /* best-effort teardown */ } } };
}
