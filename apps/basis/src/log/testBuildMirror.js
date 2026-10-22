/**
 * The test-build log mirror: in a build made with `EXPO_PUBLIC_TEST_BUILD=1`, every logger record is also
 * written to the console (on Android that is logcat), so a tester's phone says what the app is doing.
 *
 * What it writes is `formatLogs([record])` — the logger's own PII-safe line (codes + scalar fields), never a
 * raw error or payload, so the privacy property stays the logger's and not this sink's. Any other value of
 * the flag, or none, attaches nothing: a release build keeps filling only the on-device ring buffer.
 * The flag lives in no committed env or config; whoever builds a test APK sets it in their shell.
 */
import { configureLog, formatLogs } from '@onderling/logger';

/** The prefix every mirrored line carries, so `adb logcat | grep` finds ours among React Native's. */
export const TEST_BUILD_LOG_PREFIX = '[onderling]';

/**
 * Attach the console mirror when `flag` is exactly '1'; otherwise leave the logger's sink untouched.
 * @param {string|undefined} flag  the build's `EXPO_PUBLIC_TEST_BUILD`
 * @param {{ write?: (line:string) => void }} [io]  where a line goes (the console by default; tests inject)
 * @returns {boolean} whether the mirror was attached
 */
export function attachTestBuildLogMirror(flag, { write = (line) => console.info(line) } = {}) {
  if (flag !== '1') return false;
  configureLog({ sink: (rec) => write(`${TEST_BUILD_LOG_PREFIX} ${formatLogs([rec])}`) });
  return true;
}
