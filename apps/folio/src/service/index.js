/**
 * service/index.js — OS dispatch for `folio install-service`.
 *
 * Each platform exports the same shape:
 *
 *   {
 *     id:                   string,                  // service identifier
 *     unitPath:             () => string,            // where the unit file lives
 *     logPath:              () => string,            // where logs go
 *     buildUnit:            ({ nodePath, cliPath, workingDir, logPath }) => string,
 *     install:   async ({ nodePath, cliPath, workingDir, exec }) => void,
 *     uninstall: async ({ exec }) => void,
 *     status:    async ({ exec }) => { state: 'running'|'stopped'|'not-installed', detail?, lastLogLines? }
 *   }
 *
 * The platform-specific modules use `child_process.exec` (passed in via `deps.exec`
 * during tests) to call `launchctl` / `systemctl --user` / `schtasks`.  No new
 * top-level dependencies.
 *
 * Folio service identifier (stable): `org.onderling.folio`.
 */
import { platform } from 'node:os';

import { SERVICE_ID } from './_util.js';
import * as launchd from './launchd.js';
import * as systemd from './systemd.js';
import * as windows from './windows.js';

export { SERVICE_ID };

/**
 * @returns {object} The platform module for the current OS.
 * @throws if the platform is unsupported.
 */
export function platformService(plat = platform()) {
  switch (plat) {
    case 'darwin': return launchd;
    case 'linux':  return systemd;
    case 'win32':  return windows;
    default:
      throw new Error(`folio install-service: unsupported platform "${plat}"`);
  }
}

export { launchd, systemd, windows };
