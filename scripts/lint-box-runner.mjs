#!/usr/bin/env node
/**
 * lint-box-runner — the box runner (deploy/box) stays a working thing, not a script that rotted.
 * Runs `bash -n` over the runner + role scripts, checks every role still declares the repo paths its
 * image is built from (`scripts/box-role-paths.mjs` — stale means the box would rebuild the wrong set,
 * so a role would be interrupted by an unrelated release, or worse, NOT rebuilt by its own), and the
 * updater's own test suite (a real git remote, a fake docker: update, selective rebuild, rollback, HOLD,
 * RESET, Caddyfile + reload, install). Seconds; no docker daemon needed.
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
const paths = spawnSync(process.execPath, [path.join(ROOT, 'scripts/box-role-paths.mjs')], { cwd: ROOT, encoding: 'utf8' });
if (paths.status !== 0) { red++; console.error((paths.stdout + paths.stderr).trim()); }
const t = spawnSync(process.execPath, ['--test', 'deploy/box/test/', 'deploy/web/test/'], { cwd: ROOT, encoding: 'utf8' });
if (t.status !== 0) { red++; console.error((t.stdout + t.stderr).split('\n').filter((l) => /not ok|error|Error/.test(l)).slice(0, 20).join('\n')); }
console.log(red ? `box-runner: ${red} problem(s)` : `box-runner: ${scripts.length} scripts parse, role paths current, updater + publish tests green`);
process.exit(red ? 1 : 0);
