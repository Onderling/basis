// lint-ci-runs-guards — the mechanism that runs the checks is itself checked.
//
// ── Why this exists ──────────────────────────────────────────────────────────────────────────────
// On 2026-08-09 CI stopped installing, and nobody noticed for two weeks. Worse than the outage: the
// workflow had NEVER run `npm run guards`, so this repo's ~18 structural guards were only ever
// executed by a human typing the command. They looked like build-time checks and were, in practice,
// conventions — a rule with no mechanism is a wish (plans/design/6_architecture_enforcement.md).
//
// The failure this guards against is the one that already happened here twice: a check that reports
// without binding, which is worse than no check because it produces false confidence. Jobs were
// labelled "(required)" while the branch protection making them required was an unverified manual
// step; one job was `continue-on-error` for parser failures that had been fixed long before.
//
// ── What it checks ───────────────────────────────────────────────────────────────────────────────
//   1. Some workflow runs `npm run guards`. Without this, every other guard is advisory.
//   2. Every job that RUNS anything (a suite, a journey) also does BOTH halves of installing this
//      repo: `pnpm install` AND `node scripts/relink-workspace.mjs`. A clean pnpm install finishes
//      with workspace symlinks missing (measured 2026-08-24: `@onderling/params` unresolvable, the
//      aggregate lands 17/18), so a job that skips the relink tests a tree no developer has.
//      → docs/architecture.md § "How the monorepo resolves".
//
// What it deliberately does NOT check: whether the jobs are marked required in branch protection.
// That lives in GitHub settings, not in the repo, and a guard cannot see it. It is called out in the
// workflow header instead, because a check that cannot bind should say so rather than pretend.
//
// Usage: node scripts/lint-ci-runs-guards.mjs   (runs inside `npm run guards`)

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIR = path.join(ROOT, '.github', 'workflows');

if (!existsSync(DIR)) {
  console.error('✖ lint:ci — no .github/workflows directory. CI is the only thing that makes a guard bind.');
  process.exit(1);
}

const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
const problems = [];

const all = files.map((f) => readFileSync(path.join(DIR, f), 'utf8')).join('\n');
// Comments do not run anything — strip them before asking what a workflow DOES.
const code = (t) => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

if (!/npm run guards/.test(code(all))) {
  problems.push('no workflow runs `npm run guards` — every structural guard in this repo is then advisory only');
}

for (const f of files) {
  const text = code(readFileSync(path.join(DIR, f), 'utf8'));
  const jobsAt = text.indexOf('\njobs:');
  if (jobsAt === -1) continue;
  // Split the jobs block on its 2-space-indented keys: `\n  <name>:`
  const body = text.slice(jobsAt);
  const marks = [...body.matchAll(/\n {2}([A-Za-z0-9_-]+):/g)];
  for (let i = 0; i < marks.length; i++) {
    const name = marks[i][1];
    const block = body.slice(marks[i].index, i + 1 < marks.length ? marks[i + 1].index : undefined);
    const runsSomething = /npm test|vitest|run\.mjs|test:integration/.test(block);
    if (!runsSomething) continue;
    if (!/pnpm install/.test(block)) {
      problems.push(`${f} · job "${name}" runs a suite without \`pnpm install\` — it cannot have installed this workspace`);
    }
    if (!/relink-workspace/.test(block)) {
      problems.push(`${f} · job "${name}" installs but never runs \`node scripts/relink-workspace.mjs\` — installing this repo is TWO commands (see docs/architecture.md § "How the monorepo resolves"); without it the tree is missing workspace symlinks a developer's tree has`);
    }
  }
}

if (problems.length) {
  console.error(`✖ lint:ci — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  • ${p}`);
  console.error('\nCI is what turns a guard from a convention into a check. A guard nothing runs is a wish.');
  process.exit(1);
}
console.log(`✓ lint:ci: ${files.length} workflow(s) — guards aggregate wired, every running job installs in two steps.`);
