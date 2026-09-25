import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lint-plans-structure.mjs');
const run = (dir) => spawnSync(process.execPath, [GUARD], { env: { ...process.env, LINT_PLANS_DIR: dir }, encoding: 'utf8' });
const dirs = [];
const tree = (files) => {
  const d = mkdtempSync(path.join(tmpdir(), 'plans-shape-')); dirs.push(d);
  for (const f of files) { mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); writeFileSync(path.join(d, f), '# x\n'); }
  return d;
};
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('lint-plans-structure', () => {
  it('passes the shape: overviews at the top, the rest in the folders', () => {
    const r = run(tree(['TRIAGE-plans-after-launch.md', 'live/PLAN-x.md', 'notes/NOTE-y.md', `briefs/BRIEF-${new Date().toISOString().slice(0, 10)}.md`]));
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
  it('FAILS on a plan left at the top — the property it exists to hold', () => {
    const r = run(tree(['TRIAGE-plans-after-launch.md', 'PLAN-stray.md']));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('PLAN-stray.md sits at the top');
  });
  it('FAILS on a brief older than four weeks that is not in the baseline', () => {
    const r = run(tree(['briefs/BRIEF-for-opus-2020-01-01.md']));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('archive it');
  });
  it('passes where there is no plans/ at all (CI)', () => {
    const r = run(path.join(tmpdir(), 'no-such-plans-dir-xyz'));
    expect(r.status).toBe(0);
  });
});
