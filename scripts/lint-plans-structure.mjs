#!/usr/bin/env node
/**
 * lint-plans-structure — the private plans/ folder keeps the shape it was sorted into (2026-09-25).
 *
 * plans/ grew to 167 top-level files in two months: plans, notes, briefs, session logs, handovers and overviews
 * side by side, with nothing saying which were still read. The sort put the living docs in three folders — live/
 * (the design of record for work not done), notes/ (settled reference), briefs/ (dated and task-shaped) — and left
 * only the overviews at the top. Without a check the top fills up again one "just this once" at a time.
 *
 * Red when:
 *   1. a top-level plans/*.md is not one of the overviews (it belongs in live/ · notes/ · briefs/);
 *   2. a brief in briefs/ is dated more than four weeks ago and not in the baseline — its work has landed or
 *      stopped, so it goes to archive/<YYYY-MM>/ once its unbuilt ideas are on the ledger or in the backlog;
 *   3. plans/INDEX.md is stale (`gen-plan-index --check`).
 *
 * plans/ is gitignored: on a machine without it (CI) this passes and says so. The baseline of known stale briefs
 * lives beside the private files it names (plans/tools/plans-structure-baseline.json); it only shrinks.
 *
 *   node scripts/lint-plans-structure.mjs            # check
 *   node scripts/lint-plans-structure.mjs --update   # rewrite the baseline to today's stale briefs
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// LINT_PLANS_DIR points the check at another folder — for its own test, which cannot use the real private tree.
const PLANS = process.env.LINT_PLANS_DIR ? path.resolve(process.env.LINT_PLANS_DIR) : path.join(ROOT, 'plans');
const BASELINE = path.join(PLANS, 'tools', 'plans-structure-baseline.json');
const MAX_AGE_DAYS = 28;

// The overviews — the only docs that live at the top. The last two are the plans maintenance's own working docs,
// there until the maintenance closes (they then go to archive/ like any brief).
const TOP = new Set([
  'TRIAGE-plans-after-launch.md', 'INDEX.md', 'DOC-STATUS.md', 'DECISIONS-FOR-REVIEW.md', 'BACKLOG-ideas.md',
  'PLAN-homes.md', 'INDEX-triage-2026-09.md', 'HANDOVER-plans-maintenance-2026-09-25.md',
]);

if (!existsSync(PLANS)) {
  console.log('✓ lint-plans-structure: no plans/ here (it is private and gitignored) — nothing to check.');
  process.exit(0);
}

const problems = [];

// 1 · the top holds only the overviews
for (const f of readdirSync(PLANS)) {
  if (f.endsWith('.md') && !TOP.has(f)) problems.push(`plans/${f} sits at the top — move it into live/, notes/ or briefs/`);
}

// 2 · briefs older than four weeks
const dateOf = (file) => {
  const inName = file.match(/20\d\d-\d\d-\d\d/);
  if (inName) return inName[0];
  try { return readFileSync(path.join(PLANS, 'briefs', file), 'utf8').split('\n').slice(0, 8).join('\n').match(/20\d\d-\d\d-\d\d/)?.[0] ?? null; }
  catch { return null; }
};
const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000).toISOString().slice(0, 10);
const stale = existsSync(path.join(PLANS, 'briefs'))
  ? readdirSync(path.join(PLANS, 'briefs')).filter((f) => f.endsWith('.md')).filter((f) => { const d = dateOf(f); return d && d < cutoff; }).sort()
  : [];
if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify({ note: 'briefs older than four weeks, known when the check was written or last re-baselined — only shrinks', stale }, null, 1) + '\n');
  console.log(`✓ lint-plans-structure: baseline rewritten — ${stale.length} known stale brief(s).`);
  process.exit(0);
}
let known = [];
try { known = JSON.parse(readFileSync(BASELINE, 'utf8')).stale ?? []; } catch { /* no baseline yet: every stale brief is news */ }
for (const f of stale) {
  if (!known.includes(f)) problems.push(`plans/briefs/${f} is dated before ${cutoff} — archive it (archive/<YYYY-MM>/) once its unbuilt ideas are on the ledger or in the backlog`);
}
const gone = known.filter((f) => !stale.includes(f));

// 3 · the index is current (the real tree's — a test folder has no index to keep)
if (!process.env.LINT_PLANS_DIR) {
  const idx = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'gen-plan-index.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  if (idx.status !== 0) problems.push('plans/INDEX.md is stale — run `node scripts/gen-plan-index.mjs`');
}

if (known.length) console.log(`⚠ lint-plans-structure: ${known.length - gone.length} known stale brief(s) in the baseline — debt, not news.`);
if (gone.length) console.log(`⚠ ${gone.length} baseline entr${gone.length === 1 ? 'y is' : 'ies are'} gone (archived) — run with --update to shrink it.`);
if (problems.length) {
  console.error(`\n✖ lint-plans-structure — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  • ${p}`);
  process.exit(1);
}
console.log('✓ lint-plans-structure: plans/ has its shape — overviews at the top, the rest in live/ · notes/ · briefs/, the index current.');
