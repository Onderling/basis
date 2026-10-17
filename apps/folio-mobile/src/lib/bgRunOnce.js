/**
 * bgRunOnce — module-level bridge between the OS-driven background
 * task (defined at app-load via TaskManager.defineTask, see index.js)
 * and the live Folio sync engine (built inside ServiceContext after
 * sign-in).
 *
 * **2026-05-08:** the underlying `setBgRunOnce` / `clearBgRunOnce` /
 * `bgRunOnce` helpers were lifted into the
 * `@onderling/sync-engine-rn` substrate (Pinboard V3 Phase 40.2,
 * rule-of-two satisfied). This file re-exports them and keeps the
 * folio-specific `BG_TASK_NAME` constant.
 *
 * Why a module-level singleton (still applies):
 * - `TaskManager.defineTask` MUST be called at JS-bundle load time —
 *   the OS needs the registration whether or not a user has signed in.
 *   At that moment the engine doesn't exist yet.
 * - When ServiceContext later boots the engine, it calls
 *   `setBgRunOnce(() => engine.runOnce())` so subsequent task firings
 *   reach the live engine.
 * - On sign-out / engine teardown, `clearBgRunOnce()` blanks it again.
 *
 * If the OS fires the task while the engine isn't ready (cold wake,
 * during boot, after sign-out), `bgRunOnce()` resolves with `null` and
 * the task returns `noData` to the OS.
 */

export {
  setBgRunOnce,
  clearBgRunOnce,
  bgRunOnce,
} from '@onderling/sync-engine-rn';

/**
 * Stable task name used by both `defineBackgroundTask` (at index.js
 * load) and `registerBackgroundFetch` / `unregisterBackgroundFetch`
 * (in ServiceContext).  Keep them in sync via this constant.
 *
 * Folio-specific (Pinboard V3 will pick its own task name).
 */
export const BG_TASK_NAME = 'folio-mobile-sync-background';
