/**
 * folio reset — remove Folio's local settings (config + vault + per-folder
 * metadata) WITHOUT touching the user's actual notes.
 *
 *   $ folio reset           # interactive — prompts before deleting
 *   $ folio reset --yes     # skip the confirmation
 *   $ folio reset --dry-run # list paths that would be deleted, then exit
 *
 * Removes:
 *   <configDir>/config.json                    (config)
 *   <configDir>/vault.json                     (BIP-39 phrase + OIDC tokens)
 *   <localRoot>/.onderling/                  (sync state + marker; legacy .canopy/ removed too)
 *   <localRoot>/.folio/                        (B3 share tokens)
 *
 * Does NOT remove anything else under `<localRoot>` — every .md / .txt /
 * other note stays exactly where it was.
 *
 * Exit codes:
 *   0  reset succeeded (or dry-run completed)
 *   1  some path failed to delete (most often a permissions issue)
 *   2  user declined the prompt
 */
import { promises as fs } from 'node:fs';
import { join }           from 'node:path';
import { configDir, configPath, loadConfig } from './_config.js';
import { confirm, closePrompt }              from './_prompt.js';

const VAULT_FILE       = 'vault.json';
const FOLDER_META_DIR        = '.onderling';
const FOLDER_META_DIR_LEGACY = '.canopy';   // pre-rename installs — reset clears both
const FOLDER_SHARE_DIR = '.folio';

export async function resetCmd(args = []) {
  const flags = {
    yes:    args.includes('--yes') || args.includes('-y'),
    dryRun: args.includes('--dry-run') || args.includes('-n'),
  };

  // Resolve targets — config first, then per-folder paths if a config exists.
  const cfgPath   = configPath();
  const vaultPath = join(configDir(), VAULT_FILE);
  const cfg       = await loadConfig();

  const targets = [
    { path: cfgPath,   kind: 'file', label: 'config' },
    { path: vaultPath, kind: 'file', label: 'vault' },
  ];
  if (cfg?.localRoot) {
    targets.push(
      { path: join(cfg.localRoot, FOLDER_META_DIR),  kind: 'dir', label: 'folder metadata (.onderling/)' },
      { path: join(cfg.localRoot, FOLDER_META_DIR_LEGACY), kind: 'dir', label: 'folder metadata (legacy .canopy/)' },
      { path: join(cfg.localRoot, FOLDER_SHARE_DIR), kind: 'dir', label: 'share tokens (.folio/)' },
    );
  }

  // Filter to ones that actually exist so we don't lie to the user.
  const existing = [];
  for (const t of targets) {
    if (await pathExists(t.path)) existing.push(t);
  }

  if (existing.length === 0) {
    console.log('folio reset: nothing to remove — no Folio settings on this machine.');
    return;
  }

  console.log('folio reset will remove:');
  for (const t of existing) console.log(`  ${t.path}    (${t.label})`);
  if (cfg?.localRoot) {
    console.log('');
    console.log(`Your notes folder ${cfg.localRoot} will NOT be touched.`);
  }

  if (flags.dryRun) {
    console.log('');
    console.log('Dry run — no files were deleted.');
    return;
  }

  if (!flags.yes) {
    console.log('');
    const ok = await confirm('Proceed?', false);
    closePrompt();
    if (!ok) {
      console.log('Aborted.');
      process.exitCode = 2;
      return;
    }
  }

  let failures = 0;
  for (const t of existing) {
    try {
      if (t.kind === 'file') {
        await fs.unlink(t.path);
      } else {
        await fs.rm(t.path, { recursive: true, force: true });
      }
      console.log(`removed ${t.path}`);
    } catch (err) {
      failures++;
      console.error(`failed to remove ${t.path}: ${err?.message ?? err}`);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('Folio settings removed.  Run `folio init <local-path>` to set up again.');
}

async function pathExists(p) {
  try { await fs.access(p); return true; }
  catch { return false; }
}
