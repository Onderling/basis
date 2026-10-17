/**
 * backgroundTasks — Expo TaskManager + BackgroundFetch helpers.
 *
 * The handlers are peer-injected (the caller passes `TaskManager`
 * and `BackgroundFetch` namespaces from `expo-task-manager` and
 * `expo-background-fetch`).  This keeps the substrate free of
 * expo-* import-time deps; tests and non-RN consumers can use it
 * without installing them.
 *
 * Lifted from `apps/folio/src/rn/backgroundTasks.js` 2026-05-08
 * (Pinboard V3 mobile = rule-of-two consumer).
 *
 * The platform realities:
 *   - iOS schedules background-fetch opportunistically; the cadence
 *     is a *floor* the OS may exceed.
 *   - Android Doze applies similar rate-limiting.
 *
 * Document this for users; both platforms treat background-fetch as
 * "best effort" rather than guaranteed.
 */

/** Default fetch cadence (30 min in seconds). */
export const DEFAULT_BACKGROUND_FETCH_INTERVAL_S = 30 * 60;

/**
 * Define the background task.  Must be called ONCE at app startup,
 * BEFORE `registerBackgroundFetch`.  Expo requires
 * `TaskManager.defineTask(name, fn)` at JS-bundle load time so the
 * registration survives a cold-wake.
 *
 * @param {object} args
 * @param {object} args.TaskManager  `import * as TaskManager from 'expo-task-manager'`
 * @param {string} args.taskName     unique identifier (e.g. 'folio-sync-background')
 * @param {() => Promise<unknown>} args.runOnce
 *   A bound callable that performs ONE sync pass and resolves with
 *   the result.  When the result has truthy `uploads + downloads +
 *   deletes`, the task returns `'newData'`; otherwise `'noData'`.
 *   On exception the task returns `'failed'`.  Apps that want
 *   different result-mapping should call `TaskManager.defineTask`
 *   directly.
 */
export function defineBackgroundTask({ TaskManager, taskName, runOnce }) {
  if (!TaskManager) throw new Error('defineBackgroundTask: TaskManager namespace required');
  if (!taskName)    throw new Error('defineBackgroundTask: taskName required');
  if (typeof runOnce !== 'function') {
    throw new Error('defineBackgroundTask: runOnce(): Promise required');
  }
  TaskManager.defineTask(taskName, async () => {
    try {
      const r = await runOnce();
      const changed = (r?.uploads ?? 0) + (r?.downloads ?? 0) + (r?.deletes ?? 0);
      return changed > 0 ? 'newData' : 'noData';
    } catch {
      return 'failed';
    }
  });
}

/**
 * Register the periodic background fetch.  Call AFTER
 * `defineBackgroundTask` and AFTER the user is signed in.
 *
 * @param {object} args
 * @param {object} args.BackgroundFetch  `import * as BackgroundFetch from 'expo-background-fetch'`
 * @param {string} args.taskName
 * @param {number} [args.intervalSeconds=1800]
 * @param {boolean} [args.startOnBoot=true]
 * @param {boolean} [args.stopOnTerminate=false]
 */
export async function registerBackgroundFetch({
  BackgroundFetch, taskName,
  intervalSeconds = DEFAULT_BACKGROUND_FETCH_INTERVAL_S,
  startOnBoot = true, stopOnTerminate = false,
}) {
  if (!BackgroundFetch) throw new Error('registerBackgroundFetch: BackgroundFetch namespace required');
  if (!taskName)        throw new Error('registerBackgroundFetch: taskName required');
  return BackgroundFetch.registerTaskAsync(taskName, {
    minimumInterval: intervalSeconds,
    startOnBoot,
    stopOnTerminate,
  });
}

/**
 * Tear down the registration (on sign-out).
 */
export async function unregisterBackgroundFetch({ BackgroundFetch, taskName }) {
  if (!BackgroundFetch) throw new Error('unregisterBackgroundFetch: BackgroundFetch namespace required');
  if (!taskName)        throw new Error('unregisterBackgroundFetch: taskName required');
  return BackgroundFetch.unregisterTaskAsync(taskName);
}

/**
 * Read the current registration status.
 */
export async function statusBackgroundFetch({ BackgroundFetch }) {
  if (!BackgroundFetch) throw new Error('statusBackgroundFetch: BackgroundFetch namespace required');
  const status = await BackgroundFetch.getStatusAsync();
  return {
    status,
    async isRegistered(taskName) {
      return typeof BackgroundFetch.getRegisteredTasksAsync === 'function'
        ? !!(await BackgroundFetch.getRegisteredTasksAsync()).find((t) => t === taskName)
        : true;
    },
  };
}
