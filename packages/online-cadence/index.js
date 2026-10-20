/**
 * @onderling/online-cadence — the foreground cadence
 * for React Native agents (and the web, page visibility as the app state).
 *
 * One module: `./src/cadence.js` — the pure foreground ticker (createActiveCadence), the timer behind the
 * host's one clock (`apps/basis/src/v2/hostTick.js` `foregroundTimers`). The AppState bridge and the bg-task
 * re-exports were retired 2026-10-20 (no consumer; background sync is a design still to come, not inherited).
 *
 * Lifted from `apps/pinboard-mobile/src/lib/{activeCadence,appStateBridge,bgRunOnce}.js`
 * 2026-05-09.
 */

export {
  createActiveCadence,
  _internal as _cadenceInternal,
} from './src/cadence.js';
