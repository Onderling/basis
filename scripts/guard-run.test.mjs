import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runPool, selfTestsNeeded, byteCompare, ALWAYS_STEPS } from './guard-run.mjs';

describe('guard-run', () => {
  it('runPool never runs more than the limit at once and keeps the order', async () => {
    let now = 0;
    let peak = 0;
    const task = (v, ms) => async () => {
      now++; peak = Math.max(peak, now);
      await new Promise((r) => setTimeout(r, ms));
      now--;
      return v;
    };
    const out = await runPool([task('a', 30), task('b', 5), task('c', 20), task('d', 1), task('e', 10)], 2);
    expect(out).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(peak).toBe(2);
  });

  it('the self-tests run under CI or --all whatever changed', () => {
    expect(selfTestsNeeded({ ci: true, all: false, changed: [] }).run).toBe(true);
    expect(selfTestsNeeded({ ci: false, all: true, changed: [] }).run).toBe(true);
  });

  it('locally they run only when something under scripts/ changed', () => {
    expect(selfTestsNeeded({ ci: false, all: false, changed: ['apps/basis/src/x.js'] }).run).toBe(false);
    expect(selfTestsNeeded({ ci: false, all: false, changed: ['apps/basis/src/x.js', 'scripts/lint-x.mjs'] }).run).toBe(true);
  });

  it('when the changed files cannot be read they run (the safe side)', () => {
    expect(selfTestsNeeded({ ci: false, all: false, changed: null }).run).toBe(true);
  });

  it('guard-index --check is an always-step, and guards.mjs runs the always-steps outside the self-test skip', () => {
    expect(ALWAYS_STEPS).toContainEqual({ name: 'guard-index-fresh', script: 'guard-index.mjs', args: ['--check'] });
    const src = readFileSync(new URL('guards.mjs', import.meta.url), 'utf8');
    const always = src.indexOf('ALWAYS_STEPS.map');
    const skip = src.indexOf('if (plan.run)');
    expect(always).toBeGreaterThan(-1);
    expect(always).toBeLessThan(skip);
  });

  it('guards.mjs starts the INSTALLED vitest, never one fetched by npx at run time', () => {
    // the root has no vitest of its own: `npx vitest` there downloads whatever the registry serves that minute
    const code = readFileSync(new URL('guards.mjs', import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/['"`]npx['"`]/);
    expect(code).toMatch(/spawnSync\(VITEST, \['run', 'scripts\/', '--root', ROOT/);
    expect(code).toMatch(/const VITEST = path\.join\(ROOT, 'apps\/basis\/node_modules\/\.bin\/vitest'\)/);
  });

  it('byteCompare orders by code unit, not by locale', () => {
    expect(['b', 'B', 'a', '_', 'A'].sort(byteCompare)).toEqual(['A', 'B', '_', 'a', 'b']);
  });
});
