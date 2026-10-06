/**
 * The summary check a branch requires (`tests passed`) must stand for EVERY gate job. A matrix job that `same bytes?`
 * skips never reports its per-suite names, so a branch that requires them by name waits forever on a merge-back
 * (seen on the v0.1.45 merge-back). The summary always runs, and it is only as good as its `needs`: a gate job that
 * can be skipped by `same bytes?` and is not in it would pass unseen. Pin the agreement, not either list.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wf = yaml.load(readFileSync(path.join(root, '.github/workflows/test.yml'), 'utf8'));
const jobs = wf.jobs ?? {};
const needsOf = (j) => [].concat(jobs[j]?.needs ?? []);
// the gate: every job behind `same bytes?` that runs on a pull request (the browser tail runs after the merge)
const gate = Object.keys(jobs).filter((j) => needsOf(j).includes('same-bytes') && j !== 'tests-passed'
  && !String(jobs[j].if ?? '').includes("github.event_name != 'pull_request'"));

describe('the summary check stands for every gate job', () => {
  it('exists, always runs, and needs `same bytes?` and every gate job', () => {
    const t = jobs['tests-passed'];
    expect(t?.name).toBe('tests passed');
    expect(String(t?.if)).toMatch(/always\(\)/);
    expect(needsOf('tests-passed')).toContain('same-bytes');
    expect(gate.length).toBeGreaterThan(2);
    expect(gate.filter((j) => !needsOf('tests-passed').includes(j)), 'gate jobs the summary does not stand for').toEqual([]);
  });
  it('reads each of them, so none can be skipped into a pass', () => {
    const script = JSON.stringify(jobs['tests-passed']?.steps ?? []);
    for (const j of gate) expect(script, `the verdict reads ${j}`).toContain(`needs.${j}.result`);
  });
});
