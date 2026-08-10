#!/usr/bin/env node
/**
 * gen-plan-index — regenerate plans/INDEX.md, a GENERATED one-row-per-file index of every plans/*.md.
 *
 * The hand-maintained DOC-STATUS board rotted (stale rows for archived files, the active convergence arc not
 * listed at all). This derives the index from the FILESYSTEM so it cannot drift: adding / renaming / removing a
 * plan changes INDEX.md on the next run. The one-liner is the file's own H1; the status is a small override map
 * for the known-important docs + a filename-prefix default; the date is the file mtime.
 *
 *   node scripts/gen-plan-index.mjs            # --write (default): regenerate plans/INDEX.md
 *   node scripts/gen-plan-index.mjs --check    # exit 1 if INDEX.md is stale (a plan is missing / renamed / new)
 *
 * NOTE: plans/ is gitignored (local planning docs), so this is a LOCAL hygiene tool run on demand, not a CI guard.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOT  = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const PLANS = path.join(ROOT, 'plans');
const INDEX = path.join(PLANS, 'INDEX.md');

const files = readdirSync(PLANS).filter((f) => f.endsWith('.md') && f !== 'INDEX.md').sort();

// Status label for the docs that carry weight — so the active arc is unmistakable at the top of the index.
const OVERRIDE = {
  'PLAN-homes.md':                      '★ ROOT — design of record',
  'PLAN-one-log-convergence.md':        '★ HUB — convergence arc',
  'PLAN-membership-on-the-log.md':      '★ AUTHORITY — membership security',
  'DESIGN-log-ordering-unification.md': '★ AUTHORITY — ordering/merge (#33–36)',
  'NOTE-generalized-catchup.md':        'active — convergence (realizes step 5)',
  'NOTE-claim-fold-generalization.md':  'deferred — #32 (first non-task consumer)',
  'PREP-membership-slices-4-5-7.md':    'session — convergence (A/B/C)',
  'PREP-session-stoop-circles.md':      'session — convergence (stoop→circles)',
  'PREP-batch-4-key-custody.md':        'session — convergence (step 4)',
  'PLAN-circles-migration-remainder.md':'session-map — convergence',
  'SUMMARY-architecture-current.md':    'reference — bridge (fold into docs/architecture)',
  'DOC-STATUS.md':                      'index (narrative; the table half is superseded by INDEX.md)',
};

const cls = (f) => {
  if (OVERRIDE[f]) return OVERRIDE[f];
  if (/^PLAN-/.test(f))                                     return 'plan';
  if (/^DESIGN-/.test(f))                                   return 'design';
  if (/^NOTE-/.test(f))                                     return 'note';
  if (/^PREP-/.test(f))                                     return 'prep';
  if (/^(SESSION|DRAFT|LOG|REVIEW|STATUS|DEMO)-/.test(f))   return 'session/log';
  if (/^(IMPL|QUEUE|AUDIT|SPEC|PROPOSAL)-/.test(f) || /^(PROGRESS|WORKLOG)/.test(f)) return 'tracker';
  if (/^(SUMMARY|IDEAS|JOURNEYS)/.test(f) || f === 'regular-checks.md')              return 'reference';
  if (/^(ADVICE|CHECKLIST|CODING)-/.test(f))               return 'plan';
  return 'other';
};

const h1 = (f) => {
  try {
    const m = readFileSync(path.join(PLANS, f), 'utf8').match(/^#\s+(.+?)\s*$/m);
    return m ? m[1].replace(/[`|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) : '—';
  } catch { return '(unreadable)'; }
};

const mdate = (f) => {
  const d = statSync(path.join(PLANS, f)).mtime;   // file timestamp (not Date.now) — allowed
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const rows = files.map((f) => ({ f, status: cls(f), title: h1(f), date: mdate(f) }));
// ★ (starred authorities) first, then alphabetical — so a reader sees the canonical set immediately.
rows.sort((a, b) => (b.status.startsWith('★') - a.status.startsWith('★')) || a.f.localeCompare(b.f));

let out = '# plans/ INDEX — GENERATED, do not hand-edit\n\n';
out += `*Run \`node scripts/gen-plan-index.mjs\` to regenerate after adding / renaming / removing a plan; `;
out += `\`--check\` fails when it is stale. plans/ is gitignored (local). ${files.length} docs.*\n\n`;
out += 'The ★ rows are the canonical active set (design of record · convergence hub · the two authorities). '
     + 'Everything else is a plan / note / session-doc / tracker / reference; archived docs live in `plans/archive/`.\n\n';
out += '| file | what (its H1) | status | modified |\n|---|---|---|---|\n';
for (const r of rows) out += `| \`${r.f}\` | ${r.title} | ${r.status} | ${r.date} |\n`;

if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(INDEX, 'utf8'); } catch { /* missing */ }
  if (current.trim() !== out.trim()) {
    console.error('✗ plans/INDEX.md is STALE — run `node scripts/gen-plan-index.mjs` to regenerate.');
    process.exit(1);
  }
  console.log(`✓ plans/INDEX.md is fresh (${files.length} plan docs indexed).`);
  process.exit(0);
}

writeFileSync(INDEX, out);
console.log(`✓ wrote plans/INDEX.md — ${files.length} plan docs indexed.`);
