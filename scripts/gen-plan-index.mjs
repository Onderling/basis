#!/usr/bin/env node
/**
 * gen-plan-index — regenerate plans/INDEX.md, a GENERATED one-row-per-file index of the plans/ overviews and of
 * plans/{live,notes,briefs}/*.md.
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

// The top of plans/ (the overview files) and the three folders the living docs are sorted into (2026-09-25).
// Paths are relative to plans/, so a row says where the doc lives. archive/ is not indexed — it is frozen.
const FOLDERS = ['', 'live', 'notes', 'briefs'];
const files = FOLDERS.flatMap((sub) => {
  const dir = path.join(PLANS, sub);
  let names = [];
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((f) => f.endsWith('.md') && !(sub === '' && f === 'INDEX.md')).map((f) => (sub ? `${sub}/${f}` : f));
}).sort();

// Status label for the docs that carry weight — so the master and the design of record are unmistakable at the top.
const OVERRIDE = {
  'TRIAGE-plans-after-launch.md': '★ MASTER — the order, and every open plan\'s state',
  'PLAN-homes.md':                '★ ROOT — design of record',
  'DOC-STATUS.md':                'log — the dated record of what happened to the docs',
  'DECISIONS-FOR-REVIEW.md':      'log — the judgement calls made without Frits',
  'BACKLOG-ideas.md':             'backlog — every unbuilt idea from the docs that went',
};

// Where a doc lives says what it is (live/ = the design of record for work not done · notes/ = settled reference ·
// briefs/ = dated, task-shaped, archived once its work lands); the top holds only the overviews.
const cls = (f) => {
  const name = f.split('/').pop();
  if (OVERRIDE[name]) return OVERRIDE[name];
  if (f.startsWith('live/'))   return 'live';
  if (f.startsWith('notes/'))  return 'note';
  if (f.startsWith('briefs/')) return 'brief';
  return 'overview';
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
out += 'The ★ rows are the master and the design of record. `live/` holds the design of record for work not done, '
     + '`notes/` settled reference, `briefs/` dated task-shaped docs; archived docs live in `plans/archive/<YYYY-MM>/`.\n\n';
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
