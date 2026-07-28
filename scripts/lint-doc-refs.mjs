#!/usr/bin/env node
// Fitness function for the task #66 file-org model (see plans/PLAN-file-org-inventory.md).
// Keeps the docs-vs-code split self-enforcing so the "mess" can't silently recur.
//
// HARD FAILS (exit 1):
//   1. Any file tracked under an ignored private tree (plans/ or _archive/).
//   2. Any TRACKED markdown whose link target points into a private/ignored area
//      (plans/, _archive/, ../onderling projectfiles, REMAINING-WORK.md, PROGRESS.md) —
//      such links break on a fresh public clone.
//   3. Any TRACKED markdown with a BROKEN relative link (target file doesn't exist) —
//      e.g. a link left dangling after a doc move/purge.
// WARN (exit 0): tracked root docs matching a private prefix (`git rm --cached`);
//                CLAUDE.md over its size budget (per docs/conventions/doc-structure.md).
//
// Usage: node scripts/lint-doc-refs.mjs   (or: npm run lint:docs)

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const tracked = sh('git ls-files').split('\n').filter(Boolean);

const PRIVATE_TREE = /^(plans|_archive)\//;
const PRIVATE_PREFIX = /^(PLAN|DESIGN|CODING|VOORSTEL|PROPOSAL|NOTE|WIP|BRIEF)-.*\.md$|^(REMAINING-WORK|PROGRESS)\.md$/;
// link targets that won't resolve for a fresh clone (ignored or outside the repo):
const BAD_TARGET = /(^|\/)(plans|_archive)\/|onderling projectfiles|(^|\/)(REMAINING-WORK|PROGRESS)\.md/;
const MD_LINK = /\]\(([^)]+)\)/g;
// intentional placeholder/example links that legitimately don't resolve to a repo file:
const ALLOW_BROKEN = new Set(['bestand.html', 'xxx.html', './pod-layout-conventions.md']);
// strip fenced + inline code so `](...)` inside code samples isn't parsed as a link:
const stripCode = (s) => s.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');

const hard = [];
const warn = [];
const notes = [];

// 1. private trees must never be tracked
for (const f of tracked) if (PRIVATE_TREE.test(f)) hard.push(`tracked file inside a private tree: ${f}`);

// 2 + 3. tracked markdown links: no private/ignored targets, and no dangling relative links
for (const f of tracked) {
  if (!f.endsWith('.md') || PRIVATE_TREE.test(f)) continue;
  let body;
  try { body = readFileSync(f, 'utf8'); } catch { continue; }
  const dir = dirname(f);
  for (const m of stripCode(body).matchAll(MD_LINK)) {
    const raw = m[1].trim();
    const target = raw.split('#')[0].trim();
    if (!target || /^(https?:|mailto:|#)/.test(target)) continue;
    if (BAD_TARGET.test(target)) { hard.push(`${f}: link into private/ignored path -> ${raw}`); continue; }
    if (ALLOW_BROKEN.has(target) || /^\.+$/.test(target) || /[ {}|<>]/.test(target)) continue;
    const full = target.startsWith('/')
      ? join(process.cwd(), target.replace(/%20/g, ' '))
      : join(dir, target.replace(/%20/g, ' '));
    if (!existsSync(full)) hard.push(`${f}: broken relative link -> ${raw}`);
  }
}

// 4. root private-prefix docs that are still tracked (to untrack)
for (const f of tracked) if (!f.includes('/') && PRIVATE_PREFIX.test(f)) warn.push(f);

// 5. CLAUDE.md size budget (docs/conventions/doc-structure.md) — advisory, never a hard fail
try {
  const c = readFileSync('CLAUDE.md', 'utf8');
  const lines = c.split('\n').length;
  if (lines > 150 || c.length > 12000)
    notes.push(`CLAUDE.md is ${lines} lines / ${c.length} bytes — over the ~150-line budget. Compress per docs/conventions/doc-structure.md (relocate detail to a docs/ file, keep the rule + pointer).`);
} catch { /* CLAUDE.md may be absent in a sub-package checkout */ }

// 6. REMAINING-WORK.md stays a lean index — anti-re-merge (plans/PLAN-roadmap-and-docs-restructure.md).
// Private/local file (gitignored), so read directly; absent in a CI checkout → skipped.
try {
  const lines = readFileSync('REMAINING-WORK.md', 'utf8').split('\n').length;
  if (lines > 200)
    notes.push(`REMAINING-WORK.md is ${lines} lines — the roadmap is ballooning back into a detail dump. Keep it a lean prioritized index; move deep detail into plans/objectives/* (per plans/PLAN-roadmap-and-docs-restructure.md).`);
} catch { /* private/local; absent in CI */ }

if (notes.length) {
  console.log(`\n⚠  ${notes.length} advisory note(s):`);
  for (const n of notes) console.log(`     - ${n}`);
}
if (warn.length) {
  console.log(`\n⚠  ${warn.length} tracked root doc(s) match a private prefix — untrack to make private:`);
  for (const f of warn) console.log(`     git rm --cached "${f}"`);
}
if (hard.length) {
  console.error(`\n✖ lint-doc-refs: ${hard.length} violation(s):`);
  for (const h of hard) console.error(`   - ${h}`);
  console.error('\nFix: point the link at an in-repo public path, move the target into docs/, or drop the dead link.\n');
  process.exit(1);
}
console.log(`✓ lint-doc-refs: clean (${tracked.length} tracked files scanned).`);
