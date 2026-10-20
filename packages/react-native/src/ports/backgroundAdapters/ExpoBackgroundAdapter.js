/**
 * ExpoBackgroundAdapter — concrete {@link BackgroundAdapter} that WRAPS today's
 * existing background helpers with zero logic change.  It is a thin forwarder:
 * every method delegates to the same helper calls the apps already make.
 *
 * Because `@onderling/react-native` sits BELOW `@onderling/sync-engine-rn` and
 * `@onderling/online-cadence` in the layering (invariant #5 — no depending up),
 * the helpers are INJECTED rather than imported.  The app's boot passes them
 * in (exactly the modules it already imports):
 *
 *   import { registerBackgroundTask, setBgRunOnce, clearBgRunOnce }
 *     from '@onderling/sync-engine-rn';                       // bgRunOnce
 *   import { registerBackgroundFetch, unregisterBackgroundFetch }
 *     from '@onderling/sync-engine-rn';                       // backgroundTasks
 *   const attachAppStateBridge = …;   // an AppState → cadence bridge (online-cadence's retired 2026-10-20)
 *   import * as TaskManager     from 'expo-task-manager';
 *   import * as BackgroundFetch from 'expo-background-fetch';
 *   import { AppState }         from 'react-native';
 *
 *   const bg = new ExpoBackgroundAdapter({
 *     deps: { registerBackgroundTask, setBgRunOnce, clearBgRunOnce,
 *             registerBackgroundFetch, unregisterBackgroundFetch,
 *             attachAppStateBridge },
 *     config: { taskName, results: BackgroundFetch.BackgroundFetchResult,
 *               TaskManager, BackgroundFetch, AppState, bundle,
 *               getPollIntervalMs, onError, intervalSeconds },
 *   });
 *
 * This wrapper introduces NO new control flow — 's `BackgroundAdapter.ios`
 * / `.android` replace it with native BGTaskScheduler / foreground-service impls
 * that satisfy the same contract.
 */
import { BackgroundAdapter } from '../BackgroundAdapter.js';

export class ExpoBackgroundAdapter extends BackgroundAdapter {
  #deps;
  #config;
  #appStateCleanup = null;

  /**
   * @param {object} [args]
   * @param {object} [args.deps]    today's helper callables (see file header).
   * @param {object} [args.config]  task name, Expo namespaces, bundle, cadence.
   */
  constructor({ deps = {}, config = {} } = {}) {
    super();
    this.#deps   = deps;
    this.#config = config;
  }

  /**
   * Define the OS background task at bundle-load and wire it to `handler`.
   * Forwards to today's `registerBackgroundTask` (defines the task that calls
   * `bgRunOnce()`) + `setBgRunOnce` (points the singleton at the live handler).
   */
  defineColdStartTask(handler) {
    const { registerBackgroundTask, setBgRunOnce } = this.#deps;
    const { taskName, results, TaskManager } = this.#config;
    if (registerBackgroundTask && TaskManager) {
      registerBackgroundTask({ taskName, defineTask: TaskManager.defineTask, results });
    }
    setBgRunOnce?.(handler);
  }

  /** Schedule the periodic background reconnect via today's `registerBackgroundFetch`. */
  async scheduleReconnect(opts = {}) {
    const { registerBackgroundFetch } = this.#deps;
    const { BackgroundFetch, taskName, intervalSeconds } = this.#config;
    if (!registerBackgroundFetch) return undefined;
    return registerBackgroundFetch({ BackgroundFetch, taskName, intervalSeconds, ...opts });
  }

  /** Point the bg-task singleton at `handler`; unsubscribe clears it. */
  onWake(handler) {
    const { setBgRunOnce, clearBgRunOnce } = this.#deps;
    setBgRunOnce?.(handler);
    return () => clearBgRunOnce?.();
  }

  /**
   * Attach the foreground/background cadence via today's `attachAppStateBridge`
   * (bundle-driven).  `handler` is the port's raw fg/bg observer — today's
   * helper is bundle-driven and does not consume it; 's native adapters
   * will.
   */
  // eslint-disable-next-line no-unused-vars
  onAppStateChange(handler) {
    const { attachAppStateBridge } = this.#deps;
    const { AppState, bundle, getPollIntervalMs, onError } = this.#config;
    if (!attachAppStateBridge) return () => {};
    this.#appStateCleanup = attachAppStateBridge({ bundle, getPollIntervalMs, AppState, onError });
    return () => { try { this.#appStateCleanup?.(); } finally { this.#appStateCleanup = null; } };
  }

  /** Tear down: app-state cleanup + clear the singleton + unregister fetch. */
  async teardown() {
    const { unregisterBackgroundFetch, clearBgRunOnce } = this.#deps;
    const { BackgroundFetch, taskName } = this.#config;
    try { this.#appStateCleanup?.(); } catch { /* ignore */ }
    this.#appStateCleanup = null;
    clearBgRunOnce?.();
    if (unregisterBackgroundFetch) {
      try { await unregisterBackgroundFetch({ BackgroundFetch, taskName }); }
      catch { /* idempotent teardown — ignore */ }
    }
  }
}
