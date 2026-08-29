/**
 * Self-test for the /health report (guards.mjs runs `vitest run scripts/`). Asserts it runs, reports all
 * three tiers, and exits by guard health (0/1, never a crash) — not depending on a green tree, since the
 * pre-existing ledger + dep-boundaries reds are legitimately red.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { surfaceCoverage, shellSizes } from './health.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('health', () => {
  // health.mjs runs the whole guard suite. Its own bound was 30s and it MEASURES ~30s on this machine,
  // so the test went red the moment anything else ran beside it (a Metro bundle build, 2026-08-29) — a
  // guard whose self-test fails on machine load is a false alarm, not a guard. The bound is now generous
  // enough to mean "hung", not "busy".
  it('runs and reports all three tiers', () => {
    const r = spawnSync(process.execPath, [path.join(HERE, 'health.mjs')], { encoding: 'utf8' });
    const out = r.stdout + r.stderr;
    expect(out).toMatch(/GUARDS ·/);
    expect(out).toMatch(/SURFACES ·/);
    expect(out).toMatch(/SHELLS ·/);
    expect([0, 1], 'exit reflects guard health, never a crash').toContain(r.status);
  }, 180_000);   // /health runs every guard — allow for the full aggregate on a loaded machine

  it('shellSizes returns the largest shell files, descending', () => {
    const s = shellSizes(3);
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].lines).toBeGreaterThanOrEqual(s[s.length - 1].lines);
    expect(s[0].file).toMatch(/apps\/basis/);
  });

  it('surfaceCoverage parses the snapshot totals (flags a moved snapshot rather than silently null)', () => {
    const c = surfaceCoverage();
    expect(c).not.toBeNull();
    expect(Number(c.total)).toBeGreaterThan(0);
  });
});
