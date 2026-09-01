/**
 * The guard's own test — a guard whose test is red, or whose test cannot go red, is not a guard.
 *
 * It runs the real script (so the check under test is the check that ships) and then proves it CAN fail,
 * by pointing its call-site scan at a fixture that builds a second registry.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lint-one-store-per-circle.mjs');
const ROOT = path.dirname(path.dirname(SCRIPT));

describe('lint-one-store-per-circle', () => {
  it('passes on the repo as it stands — every circle owns one store', () => {
    const out = execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    expect(out).toMatch(/allowed construction site\(s\), no others/);
  });

  it('FAILS when a second per-circle registry appears — the property it exists to hold', () => {
    // A file under `apps/` that builds one and is not allowed: exactly the lists bug, reproduced.
    const dir = path.join(ROOT, 'apps', '.guard-fixture-tmp');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'secondStore.js');
    writeFileSync(file, "import { createCircleStores } from '@onderling/item-store';\nexport const s = createCircleStores({ dataSource: null });\n");
    try {
      let failed = false;
      let stderr = '';
      try { execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8' }); }
      catch (err) { failed = true; stderr = String(err.stderr ?? ''); }
      expect(failed, 'the guard refuses a second per-circle store registry').toBe(true);
      expect(stderr).toMatch(/secondStore\.js builds a per-circle store registry/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('FAILS when an allowance goes stale — the list stays honest', () => {
    // An allowance naming a file that no longer builds one must be removed, not left to rot into a
    // permission nobody rechecks.
    const dir = mkdtempSync(path.join(tmpdir(), 'guard-'));
    try {
      const src = execFileSync('node', ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(SCRIPT)}, 'utf8'))`], { encoding: 'utf8' });
      const patched = src.replace(
        /const ALLOWED = Object\.freeze\(\{/,
        "const ALLOWED = Object.freeze({\n  'apps/basis/src/v2/does-not-build-one.js': 'stale allowance fixture',",
      );
      const copy = path.join(dir, 'patched.mjs');
      writeFileSync(copy, patched);
      let stderr = '';
      try { execFileSync(process.execPath, [copy], { cwd: ROOT, encoding: 'utf8' }); }
      catch (err) { stderr = String(err.stderr ?? ''); }
      expect(stderr).toMatch(/does not exist|no longer builds one/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
