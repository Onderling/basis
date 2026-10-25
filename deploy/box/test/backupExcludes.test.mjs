// What never leaves a device: a push subscription lets its holder wake that device, so the box's restic backup (every
// volume, to every target) must leave the device runner's push store out. Run the real script against a fake restic
// and read what it was asked to back up; the excluded name is the one the device runner writes (pinned together).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const SCRIPT = path.join(ROOT, 'deploy/backup/backup.sh');

test('the box backup excludes the device runner\'s push store', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'backup-excl-'));
  const bin = path.join(dir, 'bin'); mkdirSync(bin);
  const log = path.join(dir, 'restic.log');
  writeFileSync(path.join(bin, 'restic'), `#!/bin/sh\necho "$@" >> ${log}\nexit 0\n`); chmodSync(path.join(bin, 'restic'), 0o755);
  const data = path.join(dir, 'data'); mkdirSync(data);
  const r = spawnSync('sh', [SCRIPT, 'backup'], { encoding: 'utf8', env: {
    PATH: `${bin}:${process.env.PATH}`, BACKUP_DATA: data, BACKUP_TARGETS_DIR: path.join(dir, 'none'),
    RESTIC_REPOSITORY: path.join(dir, 'repo'), RESTIC_PASSWORD: 'x',
  } });
  assert.equal(r.status, 0, r.stderr);
  const backupCall = readFileSync(log, 'utf8').split('\n').find((l) => l.startsWith('backup '));
  assert.ok(backupCall, readFileSync(log, 'utf8'));
  const runner = readFileSync(path.join(ROOT, 'apps/basis/bin/device-runner.mjs'), 'utf8');
  const pushFile = runner.match(/push:\s*path\.join\(dataDir, '([^']+)'\)/)?.[1];
  assert.ok(pushFile, 'the device runner names its push store');
  assert.match(backupCall, new RegExp(`--exclude[ =]${pushFile.replace('.', '\\.')}`), backupCall);
});
