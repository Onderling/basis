/**
 * The browser suite's CI shards, balanced by measured time: every spec file runs in exactly one shard, none is empty,
 * and no shard carries more than the ideal share plus its heaviest file (the greedy bound) — so a release no longer
 * waits for one shard that drew all the slow walks.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { planShards, specFiles } from '../scripts/browser-shard.mjs';

const { seconds } = JSON.parse(readFileSync(new URL('../test-browser/shard-durations.json', import.meta.url), 'utf8'));

describe('the browser shards', () => {
  const files = specFiles();
  const plan = planShards(files, seconds, 8);

  it('every spec file in exactly one shard; none empty', () => {
    expect(plan.flat().sort()).toEqual([...files].sort());
    for (const s of plan) expect(s.length).toBeGreaterThan(0);
  });

  it('balanced: no shard above the ideal share plus the heaviest file', () => {
    const w = (f) => seconds[f] ?? 60;
    const loads = plan.map((s) => s.reduce((a, f) => a + w(f), 0));
    const ideal = files.reduce((a, f) => a + w(f), 0) / 8;
    const heaviest = Math.max(...files.map(w));
    for (const l of loads) expect(l).toBeLessThanOrEqual(ideal + heaviest);
    expect(Math.max(...loads)).toBeLessThanOrEqual(Math.max(heaviest, ideal) * 1.25);
  });

  it('the same split every time (each shard computes it on its own)', () => {
    expect(planShards(files, seconds, 8)).toEqual(plan);
  });
});
