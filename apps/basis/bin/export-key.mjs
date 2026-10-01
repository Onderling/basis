#!/usr/bin/env node
/**
 * export-key — the admin's key for the household's sealed export files, set and opened ON THE BOX.
 *
 * Never through a chat: a bot's chat passes through Telegram's servers and the bot's own thread memory. Run it in the
 * bot's container (`docker exec -it <container> node apps/basis/bin/export-key.mjs …`); the passphrase is typed,
 * not echoed, and never written down by this script.
 *
 *   export-key.mjs set    [--data-dir /data/assistant]                make the key from a passphrase (asked twice)
 *   export-key.mjs unlock [--data-dir …] [--from <export file name>]  open the key for the next /import (one hour)
 *   export-key.mjs lock   [--data-dir …]                              close it again now
 *
 * `set` keeps only the key's PUBLIC half plus its passphrase-sealed secret (`export-key.json`): the box can seal every
 * night, not open. `unlock --from` opens the key a FILE carries — the way back on a new box, from an old export.
 */
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createExportKey, unlockExportKey, MIN_PASSPHRASE } from '../src/v2/householdExportSeal.js';
import { EXPORT_KEY_FILE, UNLOCKED_KEY_FILE, UNLOCK_FOR_MS } from '../src/v2/householdExportShelf.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { 'data-dir': { type: 'string', default: '/data/assistant' }, from: { type: 'string' } } });
const dataDir = path.resolve(values['data-dir']);
const keyPath = path.join(dataDir, EXPORT_KEY_FILE);
const unlockedPath = path.join(dataDir, UNLOCKED_KEY_FILE);

/** Ask with what is typed shown (a yes/no). */
function askPlain(question) {
  return new Promise((resolve) => { const rl = createInterface({ input: process.stdin, output: process.stdout }); rl.question(question, (x) => { rl.close(); resolve(x); }); });
}

/** Ask without echoing what is typed. */
function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

const cmd = positionals[0];
if (cmd === 'set') {
  if (existsSync(keyPath)) {
    console.log('export-key: a key is already set. Files sealed with it keep needing ITS passphrase (unlock --from <file>); a new key seals only the files from now on.');
    if ((await askPlain('Replace it? Type yes: ')).trim().toLowerCase() !== 'yes') { console.log('export-key: nothing changed.'); process.exit(0); }
  }
  const a = await ask(`Passphrase for the household export (at least ${MIN_PASSPHRASE} characters): `);
  if (a.length < MIN_PASSPHRASE) { console.error(`export-key: at least ${MIN_PASSPHRASE} characters; nothing changed.`); process.exit(1); }
  const b = await ask('The same again: ');
  if (a !== b) { console.error('export-key: the two do not match; nothing changed.'); process.exit(1); }
  rmSync(unlockedPath, { force: true });   // an old key left unlocked does not stay
  const key = await createExportKey({ passphrase: a });
  writeFileSync(keyPath, JSON.stringify(key, null, 1), { mode: 0o600 });
  console.log(`export-key: set. Each night's export is sealed from now on. Keep the passphrase OFF this box: without it no sealed file opens.`);
} else if (cmd === 'unlock') {
  let source;
  if (values.from) {
    if (!/^household-export-[\d-]+\.json$/.test(values.from)) { console.error('export-key: --from takes a file name from /exports'); process.exit(2); }
    source = JSON.parse(readFileSync(path.join(dataDir, 'exports', values.from), 'utf8'));
  } else {
    if (!existsSync(keyPath)) { console.error('export-key: no key set here; use --from <file> to open the key an export carries'); process.exit(2); }
    source = JSON.parse(readFileSync(keyPath, 'utf8'));
  }
  const pass = await ask('Passphrase: ');
  try {
    const secretKey = await unlockExportKey({ key: source, passphrase: pass });
    writeFileSync(unlockedPath, JSON.stringify({ secretKey, until: Date.now() + UNLOCK_FOR_MS }), { mode: 0o600 });
    console.log('export-key: unlocked — it closes after the next /import, or by itself within the hour. `lock` closes it now.');
  } catch (e) {
    console.error(`export-key: ${e?.message === 'wrong-passphrase' ? 'that passphrase does not open this key' : e?.message ?? e}`);
    process.exit(1);
  }
} else if (cmd === 'lock') {
  rmSync(unlockedPath, { force: true });
  console.log('export-key: locked.');
} else {
  console.error('usage: export-key.mjs set | unlock [--from <file>] | lock   [--data-dir <dir>]');
  process.exit(2);
}
