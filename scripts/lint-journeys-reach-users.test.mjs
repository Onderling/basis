/**
 * Self-test for the journeys-reach-users guard (a guard whose test is red is not a guard —
 * guards.mjs runs `vitest run scripts/`).
 *
 * Green on the current tree, and — the part worth testing — it actually FAILS on the two shapes it
 * exists to catch. A guard nobody has seen go red is a guard nobody knows works.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUARD = path.join(HERE, 'lint-journeys-reach-users.mjs');
const BASELINE = path.join(HERE, 'journeys-reach-users-baseline.json');
const run = () => spawnSync(process.execPath, [GUARD], { encoding: 'utf8' });

/** Swap the baseline, run, put it back whatever happens. */
function withBaseline(content, fn) {
  const original = readFileSync(BASELINE, 'utf8');
  try { writeFileSync(BASELINE, content); return fn(); }
  finally { writeFileSync(BASELINE, original); }
}

describe('journeys-reach-users guard', () => {
  it('is green on the current tree, and every carried gap has a real reason', () => {
    const r = run();
    expect(r.stdout + r.stderr).toMatch(/op\(s\) walked by journeys/);
    expect(r.status).toBe(0);

    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
    for (const [op, reason] of Object.entries(baseline)) {
      // A placeholder is how a baseline turns from a record into a shrug.
      expect(reason, `${op} carries a placeholder reason`).not.toMatch(/REASON NEEDED/);
      expect(reason.length, `${op}'s reason says too little`).toBeGreaterThan(60);
    }
  });

  it('FAILS on a journey-driven write op nothing reaches — the thing it exists for', () => {
    const r = withBaseline('{}', run);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NOTHING a person uses can reach/);
  });

  it('FAILS on a baselined gap that has since been closed — debt must not outlive itself', () => {
    // The real baseline PLUS a stale entry, so the only thing wrong is the stale one. Dropping the
    // real entry too would make this the fresh-gap case again, which the test above already covers.
    const current = JSON.parse(readFileSync(BASELINE, 'utf8'));
    const r = withBaseline(JSON.stringify({ ...current, 'stoop:leaveGroup': 'reached long ago' }), run);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/now REACHED/);
    expect(r.stderr).toMatch(/stoop:leaveGroup/);
  });
});
