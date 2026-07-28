/**
 * systemd.js — Linux systemd user service unit.
 *
 * Service file: `~/.config/systemd/user/folio.service`
 * Logs:         `~/.cache/folio/folio.log` (append mode via `StandardOutput`)
 *
 * The unit is a per-user service (NOT system-wide) — no sudo, ever.
 * Wired via:
 *   systemctl --user daemon-reload
 *   systemctl --user enable  folio.service
 *   systemctl --user start   folio.service
 *
 * `Restart=on-failure` means the unit will respawn on crash but won't loop on
 * a permanent config error.  Combined with `WantedBy=default.target`, the
 * service auto-starts on user login.
 */
import { promises as fs } from 'node:fs';
import { homedir }        from 'node:os';
import { dirname, join }  from 'node:path';

import { execAsync } from './_util.js';

export const id = 'folio';                     // unit name (no .service)
export const UNIT_NAME = 'folio.service';

export function unitPath() {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.config');
  return join(base, 'systemd', 'user', UNIT_NAME);
}

export function logPath() {
  const xdg = process.env.XDG_CACHE_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.cache');
  return join(base, 'folio', 'folio.log');
}

/**
 * Build the systemd unit (INI shape).  Keys are ordered to mirror
 * `systemd.unit(5)` examples so an admin reading the file finds what they
 * expect where they expect it.
 */
export function buildUnit({ nodePath, cliPath, workingDir, logPath: lp }) {
  const log = lp ?? logPath();
  return `[Unit]
Description=Folio — markdown notes <-> Solid pod sync agent
Documentation=https://github.com/Onderling
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${nodePath} ${cliPath} serve --watch
WorkingDirectory=${workingDir}
Restart=on-failure
RestartSec=5
StandardOutput=append:${log}
StandardError=append:${log}

[Install]
WantedBy=default.target
`;
}

/**
 * Idempotent install.  Steps:
 *   1. Write the unit file atomically (tmp → rename).
 *   2. Make sure the log directory exists.
 *   3. `systemctl --user daemon-reload`
 *   4. `systemctl --user enable --now folio.service` (enable + start in one)
 */
export async function install({ nodePath, cliPath, workingDir, exec = execAsync }) {
  const path = unitPath();
  const log  = logPath();
  const exists = await fileExists(path);

  const unit = buildUnit({ nodePath, cliPath, workingDir, logPath: log });

  await fs.mkdir(dirname(path), { recursive: true });
  await fs.mkdir(dirname(log),  { recursive: true });

  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, unit, 'utf8');
  await fs.rename(tmp, path);

  // Reload so systemd picks up content changes on re-install.
  await exec('systemctl --user daemon-reload');
  // `enable --now` enables for next boot AND starts now.  Idempotent.
  await exec(`systemctl --user enable --now ${UNIT_NAME}`);

  return { alreadyInstalled: exists, unitPath: path, logPath: log };
}

/**
 * Idempotent uninstall.
 */
export async function uninstall({ exec = execAsync } = {}) {
  const path = unitPath();
  // disable --now stops + disables.  Swallow errors (unit may not exist).
  try { await exec(`systemctl --user disable --now ${UNIT_NAME}`); } catch { /* ignore */ }
  try { await fs.unlink(path); } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  try { await exec('systemctl --user daemon-reload'); } catch { /* ignore */ }
  return { unitPath: path };
}

/**
 * Returns `{ state, detail, lastLogLines }`.
 */
export async function status({ exec = execAsync } = {}) {
  const path = unitPath();
  const installed = await fileExists(path);
  if (!installed) {
    return { state: 'not-installed', detail: `no unit at ${path}`, lastLogLines: [] };
  }
  let detail = '';
  let running = false;
  try {
    // is-active prints "active" / "inactive" / "failed" / etc. and exits
    // 0 only when active.  `|| true` would mask the exit code; we rely on
    // exec rejecting on non-zero AND keeping stdout for us.
    const r = await exec(`systemctl --user is-active ${UNIT_NAME}`);
    detail = String(r?.stdout ?? '').trim();
    running = detail === 'active';
  } catch (err) {
    detail = (err?.stdout ?? err?.stderr ?? err?.message ?? '').toString().trim();
    running = false;
  }
  return {
    state:        running ? 'running' : 'stopped',
    detail,
    lastLogLines: await tailLog(logPath()),
  };
}

/* ── helpers ──────────────────────────────────────────────────────────── */

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function tailLog(path, maxLines = 20) {
  try {
    const text = await fs.readFile(path, 'utf8');
    return text.split('\n').filter(Boolean).slice(-maxLines);
  } catch { return []; }
}
