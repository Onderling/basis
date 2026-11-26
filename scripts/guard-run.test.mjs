import { describe, it, expect } from 'vitest';
import { runPool, selfTestsNeeded, byteCompare } from './guard-run.mjs';

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

  it('byteCompare orders by code unit, not by locale', () => {
    expect(['b', 'B', 'a', '_', 'A'].sort(byteCompare)).toEqual(['A', 'B', '_', 'a', 'b']);
  });
});
