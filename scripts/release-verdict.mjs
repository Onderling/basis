/**
 * release-verdict — do these BYTES have a green tail? The proof belongs to the tree, not to the commit id.
 *
 * A merge-back (`live` → `development`) on a normal release carries no new code: its tree equals the previous
 * `development` head's. A release merge into `live` carries the `development` head's tree. Running the whole suite again
 * on bytes that already passed is a repeat, and every repeat made the next release queue behind it. So:
 *   - `release:check` accepts a commit when a commit with the SAME tree has a green tail (a run with the browser shards,
 *     every job green), and says which run it leaned on;
 *   - the tests workflow's first job asks the same question about its own commit (its own run left out) and, on yes,
 *     skips every other job — a run with a verdict: "same bytes as <sha>".
 * A same-tree run that is red or still running refuses: a flaky red is rerun, never stepped over to an older green. A
 * CANCELLED run gave no verdict at all, and is passed by as if it had not run.
 *
 * The walk: from the commit, through parents whose tree is the same (first parent first), at most `maxCommits` commits.
 * A commit whose tree differs is neither a candidate nor a way through.
 *
 * Pure: git and GitHub are handed in (`release-check.mjs` passes `git` and `gh`; the tests pass tables).
 */

/** Is this a real tail: a browser shard ran green, and no job failed. */
export function tailOf(jobs) {
  const list = Array.isArray(jobs) ? jobs : [];
  const failed = list.filter((j) => !['success', 'skipped'].includes(j?.conclusion));
  const shards = list.filter((j) => /^browser \(shard \d+\/\d+\)$/.test(String(j?.name)) && j.conclusion === 'success');
  return { failed, real: shards.length > 0 && failed.length === 0, shards: shards.length };
}

/**
 * @param {string} sha
 * @param {object} io
 * @param {(sha: string) => string} io.treeOf
 * @param {(sha: string) => string[]} io.parentsOf  first parent first
 * @param {(sha: string) => Array<{databaseId: number, status: string, conclusion?: string, event: string, createdAt: string}>} io.runsFor
 * @param {(runId: number) => Array<{name: string, conclusion: string}>} io.jobsOf
 * @param {number|null} [io.excludeRunId]  the run asking (its own run is not its proof)
 * @param {number} [io.maxCommits]
 * @returns {{ok: true, leanedOn: string, runId: number, shards: number}|{ok: false, reason: string, at?: string, runId?: number, detail?: string}}
 */
export function verdictFor(sha, { treeOf, parentsOf, runsFor, jobsOf, excludeRunId = null, maxCommits = 10 }) {
  const tree = treeOf(sha);
  const queue = [sha];
  const seen = new Set();
  while (queue.length && seen.size < maxCommits) {
    const c = queue.shift();
    if (seen.has(c)) continue;
    seen.add(c);
    if (treeOf(c) !== tree) continue;   // other bytes: neither a proof nor a way through
    const runs = (runsFor(c) ?? [])
      // a cancelled run gave no verdict (a newer push, or cancelled by hand): as if it had not run
      .filter((r) => (r.event === 'push' || r.event === 'workflow_dispatch') && r.databaseId !== excludeRunId && r.conclusion !== 'cancelled')
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const run = runs[0];
    if (run) {
      if (run.status !== 'completed') return { ok: false, reason: 'running', at: c, runId: run.databaseId };
      const t = tailOf(jobsOf(run.databaseId));
      if (t.failed.length) return { ok: false, reason: 'red', at: c, runId: run.databaseId, detail: t.failed.map((j) => `${j.name}: ${j.conclusion}`).join(' · ') };
      if (t.real) return { ok: true, leanedOn: c, runId: run.databaseId, shards: t.shards };
      // a green run without the tail (itself "same bytes", or a gate-only run): look further back
    }
    queue.push(...(parentsOf(c) ?? []));
  }
  return { ok: false, reason: 'no-tail' };
}
