/**
 * appStateBridge — connect React Native's AppState to a live agent
 * bundle's online cadence.
 *
 * Lifted from apps/pinboard-mobile/src/lib/appStateBridge.js 2026-05-09
 * (Phase 41.0 L2; Tasks-mobile is the second consumer).
 *
 * Foreground: agent stays connected; ticker drives `bundle.offeringMatch.tick`.
 * Background: agent disconnects from relay, drains, sleeps. The OS-driven
 * background-fetch task brings it back periodically (see `./bgTask.js`).
 *
 * The pure cadence helper lives in `./cadence.js`; this module wires
 * it to a live bundle.
 */

import { createActiveCadence } from './cadence.js';

/**
 * Attach an AppState listener that drives the bundle's cache online
 * state. Returns a cleanup function.
 *
 * @param {object} args
 * @param {object} args.bundle           the active agent bundle
 * @param {() => number} [args.getPollIntervalMs]
 *   Reads the current `pollIntervalMs` from settings; defaults to 5000.
 * @param {(err: unknown) => void} [args.onError]
 * @param {object} args.AppState
 *   RN's `AppState` namespace, passed in by the consumer (tests inject
 *   a stub; apps pass `import { AppState } from 'react-native'`).
 *
 * @returns {() => void}   cleanup
 */
export function attachAppStateBridge({
  bundle,
  getPollIntervalMs,
  onError,
  AppState,
} = {}) {
  if (!AppState) {
    if (onError) onError(new Error('attachAppStateBridge: AppState namespace required'));
    return () => {};
  }
  if (!bundle?.agent) {
    if (onError) onError(new Error('attachAppStateBridge: bundle.agent required'));
    return () => {};
  }
  const runOnce = async () => {
    try {
      if (typeof bundle.offeringMatch?.tick === 'function') {
        await bundle.offeringMatch.tick();
      }
    } catch (err) {
      if (onError) onError(err);
    }
  };

  const cadence = createActiveCadence({
    runOnce,
    getPollIntervalMs,
    AppState,
    onError,
  });

  const sub = AppState.addEventListener('change', (next) => {
    const isForeground = next === 'active';
    try {
      if (typeof bundle.cache?.setOnline === 'function') {
        bundle.cache.setOnline(isForeground);
      }
    } catch (err) {
      if (onError) onError(err);
    }
  });

  cadence.start();

  return () => {
    cadence.stop();
    sub?.remove?.();
  };
}
