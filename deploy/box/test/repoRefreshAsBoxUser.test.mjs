// install.sh refreshes the box's repos (clone, fetch, checkout). Run as root over a checkout the box user owns, git refuses
// it as "dubious ownership" (Frits's tablet re-run, 2026-10-26: the operator had to add a root safe.directory). So the
// refresh runs git AS THE BOX USER whenever the installer runs as root, as update.sh does — never as root. Shims stand in
// for id/sudo/git: `id -u` says root, `sudo -u <user>` records the user, and git records who ran it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const INSTALL = join(resolve(import.meta.dirname, '..'), 'install.sh');

function shims({ uid }) {
  const bin = mkdtempSync(join(tmpdir(), 'repo-shims-'));
  const log = join(bin, 'git.log');
  const w = (name, body) => { writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  w('id', `if [ "$1" = "-u" ]; then echo ${uid}; else exit 0; fi`);
  w('sudo', `if [ "$1" = "-u" ]; then u="$2"; shift 2; RAN_AS="$u" "$@"; else "$@"; fi`);
  w('git', `echo "\${RAN_AS:-root} $*" >> "${log}"; if [ "$1" = "clone" ]; then mkdir -p "\${@: -1}/.git"; fi; exit 0`);
  return { bin, log };
}

function refresh({ uid, existing }) {
  const { bin, log } = shims({ uid });
  const box = mkdtempSync(join(tmpdir(), 'repo-box-'));
  if (existing) mkdirSync(join(box, 'repos', 'basis', '.git'), { recursive: true });
  // the function exactly as install.sh defines it (a piped install has no lib.sh, so it lives there)
  const r = spawnSync('bash', ['-c', `eval "$(sed -n '/^refresh_repo() {/,/^}/p' "${INSTALL}")"; refresh_repo "$1" "$2" "$3" "$4"`, '_', join(box, 'repos', 'basis'), 'https://example.invalid/basis.git', 'live', 'onderling'],
    { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  let lines = [];
  try { lines = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean); } catch { /* no git ran */ }
  return { r, lines };
}

test('run as root over an existing checkout: every git runs as the box user', () => {
  const { r, lines } = refresh({ uid: 0, existing: true });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(lines.length >= 2, lines.join('\n'));
  for (const l of lines) assert.match(l, /^onderling /, `git ran as root: ${l}`);
});

test('run as root on a fresh box: the clone runs as the box user too', () => {
  const { r, lines } = refresh({ uid: 0, existing: false });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(lines.some((l) => / clone /.test(l)), lines.join('\n'));
  for (const l of lines) assert.match(l, /^onderling /, `git ran as root: ${l}`);
});

test('run as the user already (SKIP_SYSTEM boxes, tests): git runs as is, no sudo', () => {
  const { r, lines } = refresh({ uid: 1000, existing: true });
  assert.equal(r.status, 0, r.stderr);
  for (const l of lines) assert.match(l, /^root /);   // the shim's mark for "not through sudo"
});
