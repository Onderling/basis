/**
 * @onderling/online-cadence — foreground/background cadence helpers
 * for React Native agents.
 *
 * Three modules:
 *   - `./src/cadence.js`         — pure ticker (createActiveCadence)
 *   - `./src/appStateBridge.js`  — RN AppState → bundle.cache.setOnline + ticker
 *   - `./src/bgTask.js`          — re-exports the bg-fetch helpers from
 *                                   `@onderling/sync-engine-rn` for ergonomic
 *                                   colocation
 *
 * Lifted from `apps/pinboard-mobile/src/lib/{activeCadence,appStateBridge,bgRunOnce}.js`
 * 2026-05-09 (Phase 41.0 L2; Tasks-mobile is the second consumer).
 */

export {
  createActiveCadence,
  _internal as _cadenceInternal,
} from './src/cadence.js';

export {
  attachAppStateBridge,
} from './src/appStateBridge.js';

export {
  setBgRunOnce,
  clearBgRunOnce,
  bgRunOnce,
  registerBackgroundTask,
  defineBackgroundTask,
  registerBackgroundFetch,
  unregisterBackgroundFetch,
  statusBackgroundFetch,
  DEFAULT_BACKGROUND_FETCH_INTERVAL_S,
} from './src/bgTask.js';
