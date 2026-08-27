/**
 * Self-test for the searchable-sources guard (a guard whose test is red is not a guard —
 * guards.mjs runs `vitest run scripts/`).
 *
 * Green on the current tree, and — the part worth testing — it actually goes RED when a tracked
 * source file carries a raw control byte. The whole point of this guard is catching something that
 * fails SILENTLY, so a version of it that could not fail would be indistinguishable from one that
 * works.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync, execSync } from 'node:child_process';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const GUARD = path.join(HERE, 'lint-searchable-sources.mjs');
const PROBE_REL = 'packages/core/src/__searchable_probe.js';
const PROBE = path.join(ROOT, PROBE_REL);

const run = () => spawnSync(process.execPath, [GUARD], { encoding: 'utf8', cwd: ROOT });
const git = (cmd) => execSync(`git ${cmd}`, { cwd: ROOT, stdio: 'pipe' });

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

  it('is green again once the byte is written as an escape — the identical string', () => {
    writeFileSync(PROBE, "const SEP = '\\u0000';\nexport default SEP;\n");
    git(`add -f ${PROBE_REL}`);

    expect(run().status).toBe(0);
    // The point of the fix: same value, different source encoding.
    expect('\u0000').toBe(String.fromCharCode(0));
  });
});
