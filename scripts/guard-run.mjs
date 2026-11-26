/**
 * guard-run.mjs — how the guards aggregate (guards.mjs) runs its parts, kept pure so a test can hold it.
 *
 * - `runPool(tasks, limit)`: run async tasks with at most `limit` at once, results in the tasks' own order. The lints
 *   are independent read-only scans of the tree (the ones that write do so only under --update, which the aggregate
 *   never passes), so they can run side by side.
 * - `selfTestsNeeded({ ci, all, changed })`: the guards' own self-tests (`vitest run scripts/`) take most of the
 *   aggregate's time and only test the guard scripts, so locally they run only when something under scripts/ differs
 *   from the branch's base. CI, or `--all`, always runs them.
 */

/** Run `tasks` (functions returning promises) at most `limit` at a time; resolves to their results in order. */
export async function runPool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, worker));
  return results;
}

/**
 * Whether the self-tests run. `changed` is the list of paths that differ from the base (committed or not), or null
 * when that could not be worked out — then they run, the safe side.
 */
export function selfTestsNeeded({ ci, all, changed }) {
  if (ci || all) return { run: true, why: ci ? 'CI' : '--all' };
  if (changed == null) return { run: true, why: 'the changed files could not be read' };
  const hit = changed.filter((p) => p.startsWith('scripts/'));
  if (hit.length) return { run: true, why: `${hit.length} file(s) under scripts/ changed` };
  return { run: false, why: 'nothing under scripts/ differs from the base (CI runs them; --all forces them)' };
}

/**
 * Checks that run on EVERY guards run, beside the lints, whether or not the self-tests run. guard-index reads test
 * files across the whole repo, so a branch that touches only apps/ can make docs/guards.md stale: with the self-tests
 * skipped, only this step catches it before the merge queue does.
 */
export const ALWAYS_STEPS = [
  { name: 'guard-index-fresh', script: 'guard-index.mjs', args: ['--check'] },
];

/** Byte-order compare: the same on every machine, unlike localeCompare, which follows the machine's locale. */
export const byteCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
