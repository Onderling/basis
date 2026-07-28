/**
 * @onderling/react-native/hub-discovery — Android Hub install detection.
 *
 * V0 (Phase 51.6):
 *   - `createHubDiscovery({ nativeModule, intentAction? })` returns
 *     a discovery instance with `check()` + `watch(cb)` + `invalidate()`.
 *   - Native module supplies `queryHubService(intentAction)` (via
 *     `PackageManager.queryIntentServices`) + `subscribePackageEvents(cb)`
 *     (via `BroadcastReceiver` on `ACTION_PACKAGE_ADDED` /
 *     `ACTION_PACKAGE_REMOVED`).
 *
 * Real production bridge: `NativeModules.HubDiscovery` (Kotlin
 * module under `android/.../HubDiscoveryModule.kt`). Tests pass a
 * mock object directly.
 *
 * Standardisation Phase 51.6.
 */

import { createDiscoveryCache } from './cache.js';
import { check as runCheck, DEFAULT_INTENT_ACTION } from './check.js';
import { watch as runWatch }    from './watch.js';

/**
 * @param {object} opts
 * @param {object}   opts.nativeModule         — required
 * @param {string}   [opts.intentAction]       — overrides the default 'org.onderling.hub.BIND'
 * @param {() => string} [opts.now]
 */
export function createHubDiscovery({
  nativeModule,
  intentAction = DEFAULT_INTENT_ACTION,
  now,
} = {}) {
  if (!nativeModule || typeof nativeModule.queryHubService !== 'function') {
    throw Object.assign(
      new Error('createHubDiscovery: nativeModule.queryHubService is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  const cache = createDiscoveryCache();

  return {
    async check() {
      return runCheck({ nativeModule, cache, intentAction, now });
    },

    watch(callback) {
      return runWatch({ nativeModule, cache, callback, now });
    },

    invalidate() { cache.invalidate(); },

    // Introspection
    get intentAction() { return intentAction; },
    get _cache()       { return cache; },
  };
}

export { DEFAULT_INTENT_ACTION } from './check.js';
export { createDiscoveryCache }  from './cache.js';
