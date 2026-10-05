/**
 * The proof belongs to the bytes: a merge-back whose tree equals its parent's leans on the parent's tail; after a hotfix
 * on `live` the trees differ and nothing is leaned on (the full run is owed); a red or running same-tree run refuses —
 * never stepped over to an older green; a run without the tail is no proof; the asking run is not its own proof.
 */
import { describe, it, expect } from 'vitest';
import { verdictFor, tailOf } from './release-verdict.mjs';

const GREEN = [{ name: 'basis', conclusion: 'success' }, { name: 'browser (shard 1/8)', conclusion: 'success' }, { name: 'browser (shard 2/8)', conclusion: 'success' }];
const SKIPPED = [{ name: 'same bytes?', conclusion: 'success' }, { name: 'basis', conclusion: 'skipped' }, { name: 'browser (shard ${{ matrix.shard }}/8)', conclusion: 'skipped' }];
const RED = [{ name: 'basis', conclusion: 'success' }, { name: 'browser (shard 6/8)', conclusion: 'failure' }];
const GATE_ONLY = [{ name: 'basis', conclusion: 'success' }, { name: 'browser (shard ${{ matrix.shard }}/8)', conclusion: 'skipped' }];

/** A little history: commits with a tree and parents, runs per commit, jobs per run. */
function io(commits, runs = {}, jobs = {}) {
  return {
    treeOf: (c) => commits[c].tree,
    parentsOf: (c) => commits[c].parents,
    runsFor: (c) => runs[c] ?? [],
    jobsOf: (id) => jobs[id],
  };
}
const run = (id, status = 'completed', event = 'push', createdAt = `2026-10-05T0${id % 10}:00:00Z`) => ({ databaseId: id, status, event, createdAt });

describe('do these bytes have a green tail', () => {
  it('a merge-back with its parent\'s tree leans on the parent\'s tail, and names it', () => {
    const h = io({ back: { tree: 'T1', parents: ['dev', 'rel'] }, dev: { tree: 'T1', parents: ['f'] }, rel: { tree: 'T1', parents: ['old'] }, f: { tree: 'T0', parents: [] }, old: { tree: 'T9', parents: [] } },
      { dev: [run(1)] }, { 1: GREEN });
    expect(verdictFor('back', h)).toMatchObject({ ok: true, leanedOn: 'dev', runId: 1 });
  });

  it('after a hotfix on live the trees differ: nothing to lean on — the full run is owed', () => {
    const h = io({ back: { tree: 'T2', parents: ['dev', 'hot'] }, dev: { tree: 'T1', parents: [] }, hot: { tree: 'T3', parents: [] } }, { dev: [run(1)] }, { 1: GREEN });
    expect(verdictFor('back', h)).toMatchObject({ ok: false, reason: 'no-tail' });
  });

  it('the only same-tree run red, or still running: refused (rerun it), never an older green behind it', () => {
    const commits = { back: { tree: 'T1', parents: ['dev'] }, dev: { tree: 'T1', parents: ['dev0'] }, dev0: { tree: 'T1', parents: [] } };
    expect(verdictFor('back', io(commits, { dev: [run(2)], dev0: [run(1)] }, { 1: GREEN, 2: RED }))).toMatchObject({ ok: false, reason: 'red', at: 'dev' });
    expect(verdictFor('back', io(commits, { dev: [run(2, 'in_progress')], dev0: [run(1)] }, { 1: GREEN }))).toMatchObject({ ok: false, reason: 'running', at: 'dev' });
  });

  it('a cancelled run gave no verdict: passed by, to the same bytes behind it', () => {
    const commits = { back: { tree: 'T1', parents: ['dev'] }, dev: { tree: 'T1', parents: [] } };
    expect(verdictFor('back', io(commits, { back: [{ ...run(2), conclusion: 'cancelled' }], dev: [run(1)] }, { 1: GREEN, 2: RED }))).toMatchObject({ ok: true, leanedOn: 'dev' });
  });

  it('a run without the tail is no proof: a "same bytes" run leans further back; a gate-only run alone is not enough', () => {
    const commits = { b2: { tree: 'T1', parents: ['b1'] }, b1: { tree: 'T1', parents: ['dev'] }, dev: { tree: 'T1', parents: [] } };
    expect(verdictFor('b2', io(commits, { b1: [run(3)], dev: [run(1)] }, { 3: SKIPPED, 1: GREEN }))).toMatchObject({ ok: true, leanedOn: 'dev' });
    expect(verdictFor('dev', io({ dev: { tree: 'T1', parents: [] } }, { dev: [run(4)] }, { 4: GATE_ONLY }))).toMatchObject({ ok: false, reason: 'no-tail' });
    expect(tailOf(SKIPPED).real).toBe(false);
    expect(tailOf([{ name: 'basis', conclusion: 'success' }, { name: 'browser (shard 1/8)', conclusion: 'skipped' }]).real).toBe(false);
  });

  it('the asking run is not its own proof; a pull request\'s run is no tail', () => {
    const h = io({ c: { tree: 'T1', parents: [] } }, { c: [run(5, 'in_progress'), { ...run(6), event: 'pull_request' }] }, { 6: GREEN });
    expect(verdictFor('c', { ...h, excludeRunId: 5 })).toMatchObject({ ok: false, reason: 'no-tail' });
  });

  it('the release PR: its merge commit has the development head\'s tree, which has the tail', () => {
    const h = io({ merge: { tree: 'T1', parents: ['live', 'dev'] }, live: { tree: 'T0', parents: [] }, dev: { tree: 'T1', parents: [] } }, { dev: [run(1)] }, { 1: GREEN });
    expect(verdictFor('merge', h)).toMatchObject({ ok: true, leanedOn: 'dev' });
  });

  it('a feature branch\'s own head (no run of its own) is no proof for its pull request', () => {
    const h = io({ merge: { tree: 'T5', parents: ['dev', 'feat'] }, dev: { tree: 'T1', parents: [] }, feat: { tree: 'T5', parents: ['dev'] } }, { dev: [run(1)] }, { 1: GREEN });
    expect(verdictFor('merge', h)).toMatchObject({ ok: false, reason: 'no-tail' });
  });
});

describe('the tests workflow asks first', async () => {
  const { readFileSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const yaml = createRequire(import.meta.url)('js-yaml');
  const wf = yaml.load(readFileSync(new URL('../.github/workflows/test.yml', import.meta.url), 'utf8'));
  const gated = Object.entries(wf.jobs).filter(([k]) => k !== 'same-bytes' && k !== 'release-check');

  it('every other job waits for "same bytes?" and is skipped on yes — but runs when that job failed', () => {
    for (const [k, j] of gated) {
      expect(j.needs, k).toBe('same-bytes');
      expect(j.if, k).toContain("needs.same-bytes.outputs.same != 'true'");
      expect(j.if, k).toContain('!cancelled()');
    }
  });
  it('a dispatch by hand always runs; release-check runs on a pull request into live', () => {
    expect(wf.jobs['same-bytes'].steps.find((s) => s.id === 'verdict').if).toBe("github.event_name != 'workflow_dispatch'");
    expect(wf.jobs['release-check'].name).toBe('release-check');
    expect(wf.jobs['release-check'].if).toBe("github.event_name == 'pull_request' && github.base_ref == 'live'");
  });
});
