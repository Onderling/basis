import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lint-plans-structure.mjs');
const run = (dir) => spawnSync(process.execPath, [GUARD], { env: { ...process.env, LINT_PLANS_DIR: dir }, encoding: 'utf8' });
const dirs = [];
// A brief carries the status header by default; pass `{ path: text }` entries to write anything else.
const HEADER = '# x\n\n> **Status:** open · **Asks:** Fable · **Retire when:** the answer is built.\n';
const tree = (files) => {
  const d = mkdtempSync(path.join(tmpdir(), 'plans-shape-')); dirs.push(d);
  for (const entry of files) {
    const [f, text] = typeof entry === 'string' ? [entry, entry.startsWith('briefs/') ? HEADER : '# x\n'] : entry;
    mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); writeFileSync(path.join(d, f), text);
  }
  return d;
};
const today = () => new Date().toISOString().slice(0, 10);
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
  it('FAILS on a brief with no status header — nobody could tell whether it is still open', () => {
    const r = run(tree([[`briefs/BRIEF-${today()}.md`, '# a brief\n\nno header here\n']]));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('status header');
  });
  it('FAILS on a status outside the four words', () => {
    const r = run(tree([[`briefs/BRIEF-${today()}.md`, '# x\n\n> **Status:** pending · **Retire when:** later.\n']]));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('open · answered · building · done');
  });
  it('FAILS on a brief marked done that is still in briefs/ — it goes to the archive', () => {
    const r = run(tree([[`briefs/BRIEF-${today()}.md`, '# x\n\n> **Status:** done · **Retire when:** built.\n']]));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('is done');
  });
  it('FAILS on a header with no retire condition', () => {
    const r = run(tree([[`briefs/BRIEF-${today()}.md`, '# x\n\n> **Status:** open · **Asks:** Fable\n']]));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Retire when');
  });
  it('passes where there is no plans/ at all (CI)', () => {
    const r = run(path.join(tmpdir(), 'no-such-plans-dir-xyz'));
    expect(r.status).toBe(0);
  });
});

describe('lint-plans-structure --update only shrinks', () => {
  it('a brief that went stale after the baseline is NOT taken into it', () => {
    const d = tree(['briefs/BRIEF-for-opus-2020-01-01.md', ['tools/plans-structure-baseline.json', JSON.stringify({ stale: [], noHeader: [] })]]);
    spawnSync(process.execPath, [GUARD, '--update'], { env: { ...process.env, LINT_PLANS_DIR: d }, encoding: 'utf8' });
    expect(run(d).status).toBe(1);
  });
});
