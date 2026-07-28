/**
 * folio init <local-path>
 *
 * Interactive setup:
 *   - Prompt for localRoot (default: argv[0] if given, else ~/notes).
 *   - Prompt for WebID.
 *   - Prompt to confirm derived podRoot (heuristic: WebID minus '#me' + '/notes/').
 *   - Ask whether the user has an existing BIP-39 phrase.
 *       - yes → prompt for it; validate via `Bootstrap.fromMnemonic()`.
 *       - no  → generate via `Bootstrap.create()`; DISPLAY the phrase with a
 *               loud warning; require the user to type it back to confirm.
 *   - Persist the phrase to a `VaultNodeFs` at `<configDir>/vault.json`.
 *   - Persist config via `saveConfig`.
 *   - Write a marker file at `<localRoot>/.onderling/.folio-managed`.
 *
 * Non-interactive mode: when stdin is fed by a pipe (e.g. tests), defaults
 * are accepted on empty answers.
 */
import { promises as fs } from 'node:fs';
import { homedir }        from 'node:os';
import { join, resolve }  from 'node:path';

import { Bootstrap, validateMnemonic } from '@onderling/core';
import { VaultNodeFs } from '@onderling/vault';

import { configDir, saveConfig, loadConfig } from './_config.js';
import { prompt, confirm, closePrompt }      from './_prompt.js';

export async function initCmd(args) {
  try {
    return await _init(args);
  } finally {
    closePrompt();
  }
}

async function _init(args) {
  const initialPath = args[0];

  const existing = await loadConfig();
  if (existing) {
    console.log('folio init: an existing config was found at', join(configDir(), 'config.json'));
    const ok = await confirm('Overwrite?', false);
    if (!ok) {
      console.log('aborted.');
      return;
    }
  }

  // 1. localRoot.
  const defaultLocal = initialPath
    ? resolve(initialPath)
    : join(homedir(), 'notes');
  const localRootRaw = await prompt('Local notes folder', { default: defaultLocal });
  const localRoot    = resolve(localRootRaw);
  await fs.mkdir(localRoot, { recursive: true });

  // 2. WebID.
  const webId = await prompt('Your WebID (e.g. https://alice.example/profile/card#me)', {
    default: '',
  });
  if (!webId) throw new Error('WebID is required');

  // 3. podRoot (derive then confirm).
  const derivedPodRoot = derivePodRoot(webId);
  const podRoot = await prompt('Pod root for notes', { default: derivedPodRoot });

  // 4. BIP-39 phrase.
  const havePhrase = await confirm('Do you already have a BIP-39 recovery phrase?', false);
  let mnemonic;
  if (havePhrase) {
    const entered = await prompt('Enter your 24-word BIP-39 phrase');
    if (!validateMnemonic(entered)) {
      throw new Error('Invalid BIP-39 phrase — words must be valid and the checksum must match');
    }
    mnemonic = entered;
  } else {
    const { mnemonic: generated } = Bootstrap.create();
    console.log('');
    console.log('================================================================');
    console.log(' YOUR RECOVERY PHRASE — WRITE THIS DOWN NOW');
    console.log(' This is your ONLY recovery key.  Without it, you cannot');
    console.log(' restore your identity if this device is lost.');
    console.log('----------------------------------------------------------------');
    console.log(' ', generated);
    console.log('================================================================');
    console.log('');
    const echoed = await prompt('Type the phrase back to confirm you saved it');
    if (echoed.trim().split(/\s+/).join(' ') !== generated) {
      throw new Error('Phrase mismatch — initialization aborted');
    }
    mnemonic = generated;
  }

  // 5. Persist phrase to VaultNodeFs (plaintext for v1; passphrase wrapping
  //    is a Phase-B enhancement once we wire keyring access).
  const vaultPath = join(configDir(), 'vault.json');
  const vault     = new VaultNodeFs(vaultPath);
  await vault.set('bootstrap-mnemonic', mnemonic);
  // We also persist the seed bytes for code that needs the raw secret without
  // re-deriving from the mnemonic (faster, equally sensitive).
  const bootstrap = Bootstrap.fromMnemonic(mnemonic);
  await vault.set('bootstrap-seed-b64', Buffer.from(bootstrap.secret).toString('base64'));

  // 6. Persist config.
  const cfg = {
    localRoot,
    podRoot:   podRoot.endsWith('/') ? podRoot : `${podRoot}/`,
    webId,
    vaultPath,
    intervalMs: 60_000,
  };
  await saveConfig(cfg);

  // 7. Marker file.
  const markerDir = join(localRoot, '.onderling');
  await fs.mkdir(markerDir, { recursive: true });
  await fs.writeFile(
    join(markerDir, '.folio-managed'),
    JSON.stringify({ podRoot: cfg.podRoot, webId, createdAt: new Date().toISOString() }, null, 2),
    'utf8',
  );

  console.log('');
  console.log('Folio is set up.');
  console.log('  local:    ', localRoot);
  console.log('  pod:      ', cfg.podRoot);
  console.log('  config:   ', join(configDir(), 'config.json'));
  console.log('  vault:    ', vaultPath);
  console.log('');
  console.log('Run `folio sync` to do the first sync, or `folio watch` to keep them in sync.');
}

/**
 * Derive a plausible default pod root from a WebID.
 *
 * Examples:
 *   https://alice.example/profile/card#me  →  https://alice.example/notes/
 *   https://alice.example/                 →  https://alice.example/notes/
 */
function derivePodRoot(webId) {
  try {
    const u = new URL(webId);
    return `${u.origin}/notes/`;
  } catch {
    return 'https://example.invalid/notes/';
  }
}
