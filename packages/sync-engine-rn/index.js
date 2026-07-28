/**
 * @onderling/sync-engine-rn — React Native bootstrap helpers for the
 * onderling sync-engine + pod-client.
 *
 * **Layer: SDK foundation (RN sibling).** Cross-platform sync logic
 * lives in `@onderling/sync-engine`; this package is RN-only wiring
 * (background-fetch task bridge, pod-client factory off
 * `OidcSessionRN`, an opinionated `createMobileBootstrap` for apps
 * that want one-call setup).
 *
 * Lifted from `apps/folio-mobile` 2026-05-08 as part of Stoop V3
 * Phase 40.2 (the rule-of-two consumer of the same pattern).
 *
 * See `./README.md` for the cross-platform-substrate-separation
 * rationale and migration path.
 */

export {
  setBgRunOnce,
  clearBgRunOnce,
  bgRunOnce,
  registerBackgroundTask,
} from './src/bgRunOnce.js';

export {
  defaultPodFactory,
} from './src/podFactory.js';

export {
  createMobileBootstrap,
} from './src/createMobileBootstrap.js';

export {
  createSyncEngine,
} from './src/createSyncEngine.js';

export {
  defineBackgroundTask,
  registerBackgroundFetch,
  unregisterBackgroundFetch,
  statusBackgroundFetch,
  DEFAULT_BACKGROUND_FETCH_INTERVAL_S,
} from './src/backgroundTasks.js';
