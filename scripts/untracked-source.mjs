/**
 * untracked-source — the source files the guards cannot see yet.
 *
 * Most guards read the tree through `git ls-files` / `git grep`, which list TRACKED files only. A new source file is
 * invisible to them until it is added, so `npm run guards` before `git add` can pass a red that only shows a PR later
 * (it did: a literal `callSkill('lists', …)` in a new file, 2026-09-29). This names those files so the aggregate can say
 * so; `git add -N <file>` (intent to add) is enough for `git ls-files` to list them.
 */

/** The code files among `git ls-files --others --exclude-standard` that a guard would scan. */
export function untrackedSource(paths) {
  return (Array.isArray(paths) ? paths : [])
    .filter((p) => /^(apps|packages|scripts)\//.test(p))
    .filter((p) => /\.(m?js|jsx|ts|tsx|json)$/.test(p))
    .filter((p) => !/(^|\/)node_modules\//.test(p));
}
