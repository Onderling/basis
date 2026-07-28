/**
 * launchd.js — macOS LaunchAgents service unit.
 *
 * Plist lives at `~/Library/LaunchAgents/org.onderling.folio.plist`.
 * Logs at      `~/Library/Logs/folio/folio.log`.
 *
 * The plist is loaded via:
 *   launchctl load   ~/Library/LaunchAgents/org.onderling.folio.plist
 *   launchctl unload ~/Library/LaunchAgents/org.onderling.folio.plist
 *
 * `KeepAlive = true` + `RunAtLoad = true` make the service auto-start on
 * login and respawn on crash.  This is per-user only — LaunchAgents (NOT
 * LaunchDaemons) → no `sudo` is ever required.
 *
 * The unit uses absolute paths for both the node binary and the cli.js
 * entry point so the plist is portable across the user's shell sessions
 * (which may have different `PATH` values).
 */
import { promises as fs } from 'node:fs';
import { homedir }        from 'node:os';
import { dirname, join }  from 'node:path';

import { execAsync, escapeXml, SERVICE_ID } from './_util.js';

export const id = SERVICE_ID;

export function unitPath() {
  return join(homedir(), 'Library', 'LaunchAgents', `${SERVICE_ID}.plist`);
}

export function logPath() {
  return join(homedir(), 'Library', 'Logs', 'folio', 'folio.log');
}

/**
 * Build a syntactically valid launchd plist.  Order of keys matches Apple's
 * conventions so `plutil -lint` is happy.
 *
 * @param {{
 *   nodePath: string, cliPath: string, workingDir: string, logPath?: string
 * }} args
 */
export function buildUnit({ nodePath, cliPath, workingDir, logPath: lp }) {
  const log = lp ?? logPath();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${escapeXml(SERVICE_ID)}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${escapeXml(nodePath)}</string>
        <string>${escapeXml(cliPath)}</string>
        <string>serve</string>
        <string>--watch</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${escapeXml(workingDir)}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${escapeXml(log)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(log)}</string>
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
`;
}

/**
 * Idempotently install + load the plist.  Returns `{ alreadyInstalled }`.
 *
 * Steps:
 *   1. If the plist already exists, just reload it (so a content change still
 *      takes effect on a re-install).
 *   2. Write the plist atomically (tmp → rename).
 *   3. Make sure the log directory exists.
 *   4. `launchctl load <path>`.
 */
export async function install({ nodePath, cliPath, workingDir, exec = execAsync }) {
  const path  = unitPath();
  const log   = logPath();
  const exists = await fileExists(path);

  const unit = buildUnit({ nodePath, cliPath, workingDir, logPath: log });

  await fs.mkdir(dirname(path), { recursive: true });
  await fs.mkdir(dirname(log),  { recursive: true });

  // Atomic write.
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, unit, 'utf8');
  await fs.rename(tmp, path);

  // If we're re-installing, unload first so the new plist takes effect.
  if (exists) {
    try { await exec(`launchctl unload ${shellQuote(path)}`); } catch { /* ignore */ }
  }
  await exec(`launchctl load ${shellQuote(path)}`);

  return { alreadyInstalled: exists, unitPath: path, logPath: log };
}

/**
 * Idempotently unload + remove.  Safe to call when not installed.
 */
export async function uninstall({ exec = execAsync } = {}) {
  const path = unitPath();
  try { await exec(`launchctl unload ${shellQuote(path)}`); } catch { /* ignore */ }
  try { await fs.unlink(path); } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return { unitPath: path };
}

/**
 * Returns `{ state, detail, lastLogLines }`.
 */
export async function status({ exec = execAsync } = {}) {
  const path = unitPath();
  const installed = await fileExists(path);
  if (!installed) {
    return { state: 'not-installed', detail: `no plist at ${path}`, lastLogLines: [] };
  }
  // `launchctl list <label>` exits non-zero if not loaded.
  let running = false;
  let detail  = '';
  try {
    const out = await exec(`launchctl list ${shellQuote(SERVICE_ID)}`);
    detail = String(out?.stdout ?? '').trim();
    // The dict contains "PID" = <n>; if PID > 0 it's running.
    running = /"PID"\s*=\s*\d+/.test(detail);
  } catch (err) {
    detail = err?.stderr ?? err?.message ?? '';
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

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
