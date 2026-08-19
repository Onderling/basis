/**
 * _config.js — XDG-style config helpers for the Folio CLI.
 *
 * Config lives at `~/.config/folio/config.json` by default.  Override the
 * directory with `FOLIO_CONFIG_DIR` (used by tests).  `XDG_CONFIG_HOME`
 * is honoured when set.
 *
 * Shape (all keys optional unless marked):
 *   {
 *     "localRoot":   string  (required for non-init commands)
 *     "podRoot":     string  (required for non-init commands)
 *     "webId":       string
 *     "vaultPath":   string  // path to a VaultNodeFs file holding the BIP-39 phrase
 *     "intervalMs":  number
 *   }
 */
import { promises as fs } from 'node:fs';
import { homedir }        from 'node:os';
import { join }           from 'node:path';

const CONFIG_FILE = 'config.json';

export function configDir() {
  if (process.env.FOLIO_CONFIG_DIR) return process.env.FOLIO_CONFIG_DIR;
  const xdg = process.env.XDG_CONFIG_HOME;
  return join(xdg && xdg.length > 0 ? xdg : join(homedir(), '.config'), 'folio');
}

export function configPath() {
  return join(configDir(), CONFIG_FILE);
}

/** @returns {Promise<object|null>} Parsed config, or null if not present. */
export async function loadConfig() {
  try {
    const text = await fs.readFile(configPath(), 'utf8');
    return JSON.parse(text);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Atomic write via tmp-then-rename.
 * @param {object} cfg
 */
export async function saveConfig(cfg) {
  const dir = configDir();
  await fs.mkdir(dir, { recursive: true });
  const final = configPath();
  const tmp   = `${final}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  await fs.rename(tmp, final);
}

/**
 * Throws a CLI-friendly error if no config exists.
 * @returns {Promise<object>}
 */
export async function requireConfig() {
  const cfg = await loadConfig();
  if (!cfg) {
    const err = new Error(
      `no config at ${configPath()} — run \`folio init <local-path>\` first`,
    );
    err.code = 'NO_CONFIG';
    throw err;
  }
  return cfg;
}
