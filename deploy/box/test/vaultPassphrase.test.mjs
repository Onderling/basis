// The box's vault passphrase lives in its .env (BOX_VAULT_PASSPHRASE), outside every volume the box backs up. A box made
// before kept it as vault.passphrase in the assistant's volume; install.sh (re-run, idempotent) moves it: appended to .env
// when .env lacks it, the volume's file deleted, one log line, the value never printed. A box with neither gets a fresh
// one. Two that differ are left alone for the operator (the runner refuses to boot on them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const LIB = join(resolve(import.meta.dirname, '..'), 'lib.sh');

function run(envText, volFile) {
  const box = mkdtempSync(join(tmpdir(), 'vault-box-'));
  const vol = mkdtempSync(join(tmpdir(), 'vault-vol-'));
  if (envText != null) writeFileSync(join(box, '.env'), envText, { mode: 0o600 });
  if (volFile != null) writeFileSync(join(vol, 'vault.passphrase'), volFile);
  const r = spawnSync('bash', ['-c', `. "${LIB}"; vault_passphrase_into_env "$1"`, '_', vol], { encoding: 'utf8', env: { ...process.env, BOX_DIR: box } });
  const env = existsSync(join(box, '.env')) ? readFileSync(join(box, '.env'), 'utf8') : '';
  return { r, env, box, vol, volLeft: existsSync(join(vol, 'vault.passphrase')) };
}

test('a box that kept it in the volume: moved into .env, the file deleted, the value never logged', () => {
  const { r, env, volLeft, box } = run('RELAY_DOMAIN=x\n', 'old-pass\n');
  assert.equal(r.status, 0, r.stderr);
  assert.match(env, /^BOX_VAULT_PASSPHRASE=old-pass$/m);
  assert.equal(volLeft, false);
  assert.ok(!(r.stderr + r.stdout).includes('old-pass'), 'the value is never printed');
  assert.equal((r.stderr.match(/vault passphrase/g) ?? []).length, 1, r.stderr);
  assert.equal(statSync(join(box, '.env')).mode & 0o777, 0o600);
});

test('idempotent: run again, nothing changes', () => {
  const first = run('RELAY_DOMAIN=x\n', 'old-pass\n');
  const again = spawnSync('bash', ['-c', `. "${LIB}"; vault_passphrase_into_env "$1"`, '_', first.vol], { encoding: 'utf8', env: { ...process.env, BOX_DIR: first.box } });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(readFileSync(join(first.box, '.env'), 'utf8'), first.env);
});

test('.env has it and the volume holds the same: the file goes', () => {
  const { r, env, volLeft } = run('BOX_VAULT_PASSPHRASE=same\n', 'same');
  assert.equal(r.status, 0, r.stderr);
  assert.equal((env.match(/BOX_VAULT_PASSPHRASE=/g) ?? []).length, 1);
  assert.equal(volLeft, false);
});

test('two that differ: both left, a non-zero exit names the conflict (not the values)', () => {
  const { r, env, volLeft } = run('BOX_VAULT_PASSPHRASE=newer\n', 'older');
  assert.notEqual(r.status, 0);
  assert.equal(volLeft, true);
  assert.match(env, /^BOX_VAULT_PASSPHRASE=newer$/m);
  assert.ok(!/newer|older/.test(r.stderr + r.stdout), r.stderr);
});

test('neither: a fresh passphrase in .env, and no file anywhere else', () => {
  const { r, env, volLeft } = run('RELAY_DOMAIN=x\n', null);
  assert.equal(r.status, 0, r.stderr);
  assert.match(env, /^BOX_VAULT_PASSPHRASE=[A-Za-z0-9_-]{32,}$/m);
  assert.equal(volLeft, false);
});
