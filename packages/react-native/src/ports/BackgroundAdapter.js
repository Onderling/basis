/**
 * BackgroundAdapter — port for OS-driven background lifecycle: cold-start task
 * registration, periodic reconnect scheduling, wake + app-state subscriptions.
 * @abstract
 *
 * ── Why this port exists ────────────────────────────────────────────────────
 * Today the background bits are scattered across three modules that each take
 * injected Expo namespaces:
 *   - `@onderling/sync-engine-rn/bgRunOnce`      — `registerBackgroundTask` +
 *     the `setBgRunOnce`/`clearBgRunOnce` singleton (defineTask MUST run at
 *     JS-bundle load, before the engine exists).
 *   - `@onderling/sync-engine-rn/backgroundTasks` — `registerBackgroundFetch` /
 *     `unregisterBackgroundFetch` (periodic wake).
 *   - an `attachAppStateBridge`-shaped dep — foreground/background cadence + AppState listener (its online-cadence
 *     implementation was retired 2026-10-20 with no consumer; background sync is a design still to come).
 * This port NAMES that surface so the future iOS work (BGTaskScheduler +
 * NSE-driven reconnect-and-drain + App-Group) and the Android counterpart
 * (foreground-service / WorkManager) each drop in as a `BackgroundAdapter`
 * concrete without touching shared dispatch code.
 *
 * Contract:
 *   - `defineColdStartTask(handler)` — register the OS background task at
 *     bundle-load and wire it to `handler` (a `() => Promise<result>` that runs
 *     one sync pass).  MUST be safe to call before the engine is built.
 *   - `scheduleReconnect(opts)` — schedule the periodic background reconnect.
 *   - `onWake(handler)` — subscribe to OS wake events; returns an unsubscribe.
 *   - `onAppStateChange(handler)` — subscribe to foreground/background
 *     transitions; returns an unsubscribe.
 *   - `teardown()` — tear everything down (sign-out); idempotent.
 */
export class BackgroundAdapter {
  /**
   * Register the OS background task and wire it to `handler`.
   * @param {() => Promise<unknown>} handler  runs one sync pass.
   * @returns {void|Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  defineColdStartTask(handler) {
    throw new Error('BackgroundAdapter.defineColdStartTask() not implemented');
  }

  /**
   * Schedule the periodic background reconnect/fetch.
   * @param {object} [opts]
   * @returns {Promise<unknown>}
   */
  // eslint-disable-next-line no-unused-vars
  async scheduleReconnect(opts) {
    throw new Error('BackgroundAdapter.scheduleReconnect() not implemented');
  }

  /**
   * Subscribe to OS wake events.
   * @param {() => void} handler
   * @returns {() => void} unsubscribe
   */
  // eslint-disable-next-line no-unused-vars
  onWake(handler) {
    throw new Error('BackgroundAdapter.onWake() not implemented');
  }

  /**
   * Subscribe to foreground/background transitions.
   * @param {(state: string) => void} handler
   * @returns {() => void} unsubscribe
   */
  // eslint-disable-next-line no-unused-vars
  onAppStateChange(handler) {
    throw new Error('BackgroundAdapter.onAppStateChange() not implemented');
  }

  /** Tear down all registrations; idempotent. */
  async teardown() {
    throw new Error('BackgroundAdapter.teardown() not implemented');
  }
}
