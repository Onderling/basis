#!/usr/bin/env node
/**
 * lint-box-runner — the box runner (deploy/box) stays a working thing, not a script that rotted.
 * Runs `bash -n` over the runner + role scripts and the updater's own test suite (a real git remote,
 * a fake docker: update, rollback, HOLD, RESET, Caddyfile, install). Seconds; no docker daemon needed.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripts = [
  ...['lib.sh', 'update.sh', 'install.sh'].map((f) => path.join('deploy/box', f)),
  ...readdirSync(path.join(ROOT, 'deploy/roles')).filter((f) => f.endsWith('.health')).map((f) => path.join('deploy/roles', f)),
];
let red = 0;
for (const s of scripts) {
  const r = spawnSync('bash', ['-n', s], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) { red++; console.error(`✗ bash -n ${s}\n${r.stderr}`); }
}
const t = spawnSync(process.execPath, ['--test', 'deploy/box/test/', 'deploy/web/test/'], { cwd: ROOT, encoding: 'utf8' });
if (t.status !== 0) { red++; console.error((t.stdout + t.stderr).split('\n').filter((l) => /not ok|error|Error/.test(l)).slice(0, 20).join('\n')); }
console.log(red ? `box-runner: ${red} problem(s)` : `box-runner: ${scripts.length} scripts parse, updater + publish tests green`);
process.exit(red ? 1 : 0);
