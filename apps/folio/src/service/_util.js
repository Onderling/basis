/**
 * _util.js — small helpers and shared constants for the platform service
 * modules.
 *
 *   execAsync(cmd) → Promise<{ stdout, stderr }>
 *     Promise wrapper around `child_process.exec`.  Tests inject a stub via
 *     the `exec` parameter on each platform module's `install/uninstall/
 *     status` so we never actually shell out to launchctl/systemctl/schtasks
 *     under vitest.
 *
 *   escapeXml(s) → string
 *     Tiny XML escaper for plist content.  No deps.
 */
import { exec } from 'node:child_process';

/** Stable service identifier used across all platforms. */
// Naming migration 2026-07-29 (pre-launch): the service re-installs under the new label. A machine
// that installed before the rename may still have ~/Library/LaunchAgents/ag.canopy.folio.plist —
// `launchctl unload` + delete it once; `service install` writes the new one.
export const SERVICE_ID = 'org.onderling.folio';

export function execAsync(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, opts, (err, stdout, stderr) => {
      if (err) {
        // Pass stdout/stderr along so callers can inspect non-zero results.
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

export function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
