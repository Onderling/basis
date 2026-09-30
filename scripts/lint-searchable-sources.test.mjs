/**
 * Self-test for the searchable-sources guard (a guard whose test is red is not a guard —
 * guards.mjs runs `vitest run scripts/`).
 *
 * Green on the current tree, and — the part worth testing — it actually goes RED when a tracked
 * source file carries a raw control byte. The whole point of this guard is catching something that
 * fails SILENTLY, so a version of it that could not fail would be indistinguishable from one that
 * works.
 */
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { spawnSync, execSync } from 'node:child_process';
import { writeFileSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const GUARD = path.join(HERE, 'lint-searchable-sources.mjs');
const PROBE_REL = 'packages/core/src/__searchable_probe.js';
const PROBE = path.join(ROOT, PROBE_REL);

// A PRIVATE copy of the git index: the probe is staged there only, so the other guards' self-tests (running in
// parallel, reading `git ls-files`) never see it, and this guard never sees what they stage. With the shared index
// the aggregate went red now and then while each file passed alone.
const INDEX = path.join(os.tmpdir(), `searchable-probe-index-${process.pid}-${Date.now()}`);
const env = { ...process.env, GIT_INDEX_FILE: INDEX };
const run = () => spawnSync(process.execPath, [GUARD], { encoding: 'utf8', cwd: ROOT, env });
const git = (cmd) => execSync(`git ${cmd}`, { cwd: ROOT, stdio: 'pipe', env });

beforeAll(() => {
  const shared = execSync('git rev-parse --path-format=absolute --git-path index', { cwd: ROOT, encoding: 'utf8' }).trim();
  copyFileSync(shared, INDEX);
});
afterAll(() => { if (existsSync(INDEX)) rmSync(INDEX); });

afterEach(() => {
  // The probe must be staged to be seen (the guard reads `git ls-files`), so unstage AND delete.
  try { git(`rm -q --cached ${PROBE_REL}`); } catch { /* not staged */ }
  if (existsSync(PROBE)) rmSync(PROBE);
});

describe('searchable-sources guard', () => {
  it('is green on the current tree', () => {
    const r = run();
    expect(r.stdout).toMatch(/all findable by search/);
    expect(r.status).toBe(0);
  });

  it('goes RED on a tracked source file carrying a raw control byte', () => {
    // Written as a byte, deliberately — that is the defect. Everything else in this repo writes the
    // escape, which is exactly the fix the guard's message asks for.
    writeFileSync(PROBE, `const SEP = '${String.fromCharCode(0)}';\nexport default SEP;\n`);
    git(`add -f ${PROBE_REL}`);

    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/grep silently skips/);
    expect(r.stderr).toContain(PROBE_REL);
    // …and it says WHERE, so the fix does not need a byte hunt.
    expect(r.stderr).toMatch(/control byte 0x00 at line 1/);
  });

  it('goes RED on a byte past the first 8 KB — where git\'s binary check stops looking but ugrep does not', () => {
    // `git grep -I` decides "binary" from the first ~8000 bytes; other search tools read further and skip the
    // file. A NUL on line 160 of a 44 KB file was invisible to them and green here (2026-09-29).
    const filler = Array.from({ length: 400 }, (_, i) => `export const line${i} = ${i};`).join('\n');
    writeFileSync(PROBE, `${filler}\nconst SEP = '${String.fromCharCode(0)}';\nexport default SEP;\n`);
    git(`add -f ${PROBE_REL}`);

    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(PROBE_REL);
    expect(r.stderr).toMatch(/control byte 0x00 at line 401/);
  });

  it('is green again once the byte is written as an escape — the identical string', () => {
    writeFileSync(PROBE, "const SEP = '\\u0000';\nexport default SEP;\n");
    git(`add -f ${PROBE_REL}`);

    expect(run().status).toBe(0);
    // The point of the fix: same value, different source encoding.
    expect('\u0000').toBe(String.fromCharCode(0));
  });
});
