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
  it('runs and reports all three tiers', () => {
    const r = spawnSync(process.execPath, [path.join(HERE, 'health.mjs')], { encoding: 'utf8' });
    const out = r.stdout + r.stderr;
    expect(out).toMatch(/GUARDS ·/);
    expect(out).toMatch(/SURFACES ·/);
    expect(out).toMatch(/SHELLS ·/);
    expect([0, 1], 'exit reflects guard health, never a crash').toContain(r.status);
  }, 30000);   // /health runs every guard — allow for the full aggregate

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
