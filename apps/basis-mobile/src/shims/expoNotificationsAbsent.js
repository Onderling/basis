/**
 * Stub for `expo-notifications` / `expo-device` — native modules this dev APK was not built with.
 *
 * Same treatment as `react-native-webrtc` (see metro.config.js): the consuming code
 * (`src/v2/nativePush.js`) already degrades correctly when the modules are missing — its `loadDeps`
 * is wrapped in try/catch and reports `{ supported: false }`. What it cannot survive is **Metro**,
 * which resolves `require()` statically at bundle time, so an absent module is a build failure long
 * before any try/catch runs. Stubbing keeps the graph resolvable and lets the honest
 * "notifications aren't supported on this build" path run.
 *
 * Found 2026-07-29 by running the app: `expo-notifications` and `expo-device` are named as
 * prerequisites in nativePush.js's own header and were never added to package.json.
 *
 * To actually enable push: add both deps, rebuild the dev client, and delete this shim's resolver
 * entry — the real modules then resolve and `getNativePushState` reports truthfully.
 */

/** `Device.isDevice !== false` is the simulator check; `null` here means "cannot tell". */
export const isDevice = null;

const unsupported = async () => ({ status: 'undetermined', granted: false });

export async function getPermissionsAsync() { return unsupported(); }
export async function requestPermissionsAsync() { return unsupported(); }
export async function getExpoPushTokenAsync() {
  throw new Error('expo-notifications is not part of this build');
}
export function setNotificationHandler() { /* no-op */ }
export default { isDevice, getPermissionsAsync, requestPermissionsAsync, getExpoPushTokenAsync, setNotificationHandler };
