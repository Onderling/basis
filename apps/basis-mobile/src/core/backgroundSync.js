/**
 * Background-fetch sync wiring (salvaged from tasks-mobile at its retirement).
 *
 * The OS-scheduled half lives in `index.js` (`defineBackgroundTask` at bundle load —
 * Expo requires it there); THIS half runs once the agent bundle is up: it points the
 * substrate's `bgRunOnce` singleton at the app's real catch-up work (the pod chat
 * read-back + the frontier replays the chat shell already builds) and registers the
 * OS background-fetch schedule.
 *
 * `registerBackgroundFetch` needs the native `expo-background-fetch` module, which
 * exists on a device build but not under vitest/node — imported lazily and swallowed,
 * so headless environments wire the runOnce (testable) and skip the OS registration.
 * A fresh dev-client build is required before the native module exists on device
 * (see docs/agent-notes-known-gotchas.md).
 */
import { setBgRunOnce, registerBackgroundFetch } from '@onderling/sync-engine-rn';

export const BASIS_BG_TASK_NAME = 'basis-mobile-sync-background';

/**
 * @param {object} a
 * @param {() => Promise<any>} a.runOnce  the catch-up closure (built by the chat shell
 *        over the live rail: pod chat catch-up + frontier replay requests)
 * @returns {Promise<{wired: true, registered: boolean}>}
 */
export async function wireBackgroundSync({ runOnce } = {}) {
  if (typeof runOnce !== 'function') throw new Error('wireBackgroundSync: runOnce function required');
  setBgRunOnce(runOnce);
  try {
    // Probe before importing. `expo-background-fetch` pulls in the native TaskManager, and a MISSING
    // native module is reported by the NATIVE layer — so the catch below swallows the throw while the
    // dev client still shows a full-screen redbox on every launch (2026-08-29, on the first device run
    // after the peer-wiring fix let this line be reached at all). A null probe is silent, which is what
    // "swallowed, not fatal" was always meant to mean. Under vitest/node the probe import itself throws
    // and the catch answers the same `registered: false`.
    const { requireOptionalNativeModule } = await import('expo-modules-core');
    if (!requireOptionalNativeModule('ExpoTaskManager')) return { wired: true, registered: false };
    const BackgroundFetch = await import('expo-background-fetch');
    await registerBackgroundFetch({ BackgroundFetch, taskName: BASIS_BG_TASK_NAME });
    return { wired: true, registered: true };
  } catch {
    // No native module (vitest/node, or a dev client built before this dep) — the
    // foreground wiring still stands; the OS schedule waits for a device build.
    return { wired: true, registered: false };
  }
}
