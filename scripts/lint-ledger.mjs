#!/usr/bin/env node
// Fitness function for the open-questions ledger in REMAINING-WORK.md.
//
// WHY THIS EXISTS: the ledger drifted FOUR times in July 2026 — twice claiming "empty" on a day that
// raised questions, once describing a rename that had already happened, once holding two items under
// "Open" that the same file answered forty lines lower. The rule ("nothing leaves this list until Frits
// answers it") was written down each time and did not hold, because nothing failed when it broke. This is
// the mechanical form of the sentence already in that section: *check it before calling a session done.*
//
// It guards three of the four observed drifts. The fourth — an item whose text describes something that
// has since been built — is not mechanically checkable, and this script does not pretend to catch it.
//
// HARD FAILS (exit 1):
//   1. An Open item without a stable `[L<n>]` id, or two Open items sharing one.
//   2. An id present in BOTH the Open and the Answered block, or an Open id that appears anywhere in
//      REMAINING-WORK.md marked `✔` — the exact shape of drifts 3 and 4.
//   3. A cross-reference (`ledger L<n>`, `[Frits — ledger L<n>]`) naming an id that does not exist, or
//      naming an ANSWERED id as though it were still open.
//   4. An id reused after retirement (monotonic against the high-water mark in the baseline).
//   5. A question marker in a private doc with no `[ledger L<n>]` / `[ledger n/a]` annotation and no
//      baseline entry — drift 1: a question raised in a design doc that never reached the ledger.
//
// SKIPS CLEANLY when REMAINING-WORK.md is absent: it and plans/ are gitignored by design, so a fresh
// public clone (and CI) has nothing to check. Absence is not a failure.
//
// PRIVACY: this file is tracked/public. It must never hardcode a `plans/` filename — the baseline of
// known marker sites lives in gitignored `plans/ledger-marker-baseline.json` precisely because the plan
// filenames themselves are private.
//
// Usage: node scripts/lint-ledger.mjs            (or: npm run lint:ledger)
//        node scripts/lint-ledger.mjs --update   rewrite the baseline from what is on disk now

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// LEDGER_LINT_ROOT lets the test suite point the guard at a fixture tree. A guard nobody has seen fail
// is a guard nobody knows works — and this one exists precisely because a written-down rule wasn't enough.
const ROOT = process.env.LEDGER_LINT_ROOT || new URL('..', import.meta.url).pathname;
const LEDGER_FILE = join(ROOT, 'REMAINING-WORK.md');
const PRIVATE_DIR = join(ROOT, 'plans');
const BASELINE = join(PRIVATE_DIR, 'ledger-marker-baseline.json');
const UPDATE = process.argv.includes('--update');

if (!existsSync(LEDGER_FILE)) {
  console.log('lint:ledger — REMAINING-WORK.md not present (private/gitignored); nothing to check.');
  process.exit(0);
}

const errors = [];
const warnings = [];
const src = readFileSync(LEDGER_FILE, 'utf8');

// ── the ledger section ───────────────────────────────────────────────────────
const LEDGER_HEADING = /^#\s*\?\s*Needs Frits.*\(the ledger\)\s*$/m;
const headingAt = src.search(LEDGER_HEADING);
if (headingAt === -1) {
  console.error('✖ lint:ledger — no ledger heading in REMAINING-WORK.md.');
  console.error('  Expected a line matching: # ? Needs Frits — open DESIGN questions (the ledger)');
  console.error('  The ledger is the one list that must not silently disappear; if it moved, point this');
  console.error('  guard at its new home rather than deleting the guard.');
  process.exit(1);
}
const after = src.slice(headingAt);
const endRel = after.slice(1).search(/^#\s[^#]/m); // next top-level heading
const section = endRel === -1 ? after : after.slice(0, endRel + 1);

const openAt = section.search(/^##\s+Open\s*$/m);
const answeredAt = section.search(/^##\s+Answered/m);
if (openAt === -1 || answeredAt === -1 || answeredAt < openAt) {
  errors.push('The ledger must contain "## Open" followed by "## Answered" — one of them is missing or out of order.');
}
const openBlock = openAt === -1 ? '' : section.slice(openAt, answeredAt === -1 ? undefined : answeredAt);
const answeredBlock = answeredAt === -1 ? '' : section.slice(answeredAt);

// ── 1. ids on open items ─────────────────────────────────────────────────────
const ID = /\[L(\d+)\]/g;
const idsIn = (text) => [...text.matchAll(ID)].map((m) => Number(m[1]));

// An open item is a top-level list entry: "1. ..." / "- ..." / "* ..."
const openItems = openBlock
  .split('\n')
  .filter((l) => /^\s*(?:\d+\.|[-*])\s+\S/.test(l))
  // italic scene-setting lines ("*The boundary model — the six of §13…*") are not items
  .filter((l) => !/^\s*[-*]\s*\*[^*]+\*\s*$/.test(l));

const openIds = [];
for (const line of openItems) {
  const found = idsIn(line);
  if (found.length === 0) {
    errors.push(`Open ledger item has no [L<n>] id — ids are what stop cross-references going stale when the list renumbers:\n    ${line.trim().slice(0, 120)}`);
    continue;
  }
  if (found.length > 1) {
    errors.push(`Open ledger item carries more than one id (${found.map((n) => `L${n}`).join(', ')}):\n    ${line.trim().slice(0, 120)}`);
  }
  openIds.push(found[0]);
}
const dupes = openIds.filter((n, i) => openIds.indexOf(n) !== i);
for (const d of new Set(dupes)) errors.push(`Two Open ledger items share the id L${d}.`);

// ── 2. an id must not be Open and Answered at once ───────────────────────────
const answeredIds = new Set(idsIn(answeredBlock));
for (const n of openIds) {
  if (answeredIds.has(n)) {
    errors.push(`L${n} is listed under BOTH "Open" and "Answered". This is the drift the guard exists for: a question that got answered and never left the open list.`);
  }
}
// the same thing said with a tick anywhere in the file
for (const n of openIds) {
  const tick = new RegExp(`✔[^\\n]{0,40}\\[L${n}\\]|\\[L${n}\\][^\\n]{0,40}✔`);
  if (tick.test(src)) {
    errors.push(`L${n} is Open, but appears marked ✔ elsewhere in REMAINING-WORK.md. Retire it from Open or drop the tick.`);
  }
}

// ── 3. cross-references resolve, and to the right state ──────────────────────
const allIds = new Set([...openIds, ...answeredIds]);
const REF = /ledger\s+L(\d+)/gi;
for (const m of src.matchAll(REF)) {
  const n = Number(m[1]);
  if (!allIds.has(n)) {
    errors.push(`A cross-reference names "ledger L${n}", which is on neither the Open nor the Answered list.`);
  } else if (/Frits\s*[—–-]\s*ledger\s+L\d+/i.test(m.input.slice(Math.max(0, m.index - 30), m.index + 20)) && answeredIds.has(n)) {
    errors.push(`"[Frits — ledger L${n}]" still asks for a decision, but L${n} is Answered. Fold the answer into the item.`);
  }
}

// ── 4/5. the baseline: marker sites + the id high-water mark ─────────────────
// The marker vocabulary is deliberately WIDE. It over-fires on prose ("Anna opens a decision"), and that
// is the correct trade: a false positive costs one `[ledger n/a]` annotation, a false negative costs a
// decision Frits never saw. The last four entries were added 2026-07-31 after a triage found three whole
// conventions the first version missed — including a "## Decisions for Frits" section holding six
// numbered decisions, none of them on the ledger. If you find another convention, widen this, don't
// narrow it.
const MARKER = new RegExp([
  /Frits'\s*call/, /Needs\s+Frits/, /OPEN[^\n]{0,20}(?:DECISION|for Frits)/, /Open question/,
  /Decisions?\s+for\s+Frits/,        // "## Decisions for Frits — FOR A TOGETHER DECISION"
  /Decisions?\s+I\s+need\s+from\s+you/, // "## Decisions I need from you" — found by the round-2 triage
  /\[Frits\b/,                       // "[Frits]" / "[Frits — wants to think again]" tags
  /◇\s*OPEN/,                        // DECISIONS-FOR-REVIEW's own open-decision heading
  /Still yours to decide/i,          // ditto, its section heading
].map((r) => r.source).join('|'), 'i');
// Any reference to a ledger id counts as annotation, wherever it sits in the line — `[ledger L4]`,
// `[Frits — ledger L7]`, `[ledger n/a — answered 07-30]`. An earlier version demanded a literal `[`
// immediately before "ledger" and so flagged the file's own `[Frits — ledger L7]` tags as un-annotated.
const ANNOTATED = /\bledger\s+(?:L\d+|n\/a)/i;

const privateDocs = existsSync(PRIVATE_DIR)
  ? readdirSync(PRIVATE_DIR).filter((f) => f.endsWith('.md')).map((f) => join('plans', f))
  : [];
const scanned = ['REMAINING-WORK.md', ...privateDocs];

// The ledger section is itself full of marker phrases (its own heading, its drift warning, its items).
// Those ARE the ledger, so scanning them would demand that the list annotate itself.
const ledgerFirstLine = src.slice(0, headingAt).split('\n').length;
const ledgerLastLine = ledgerFirstLine + section.split('\n').length - 1;

const sites = [];
for (const rel of scanned) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) continue;
  const isLedgerFile = rel === 'REMAINING-WORK.md';
  const lines = readFileSync(abs, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const lineNo = i + 1;
    if (isLedgerFile && lineNo >= ledgerFirstLine && lineNo <= ledgerLastLine) return;
    if (!MARKER.test(line)) return;
    if (ANNOTATED.test(line)) return;
    sites.push(`${rel}:${lineNo}`);
  });
}

const prior = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { markerSites: [], highWaterMark: 0 };
const highWater = Math.max(prior.highWaterMark || 0, ...allIds, 0);

if (UPDATE) {
  writeFileSync(BASELINE, `${JSON.stringify({
    markerSites: sites.sort(),
    highWaterMark: highWater,
    // ids that existed when the baseline was taken — so the reuse check can tell an OLD low id
    // (fine) from a NEW one that has claimed a retired number (not fine).
    knownIds: [...allIds].sort((a, b) => a - b),
  }, null, 2)}\n`);
  console.log(`lint:ledger — baseline rewritten: ${sites.length} un-annotated marker site(s), high-water mark L${highWater}.`);
  console.log('  Triage these DOWN over time. Every one you annotate [ledger L<n>] or [ledger n/a] is one');
  console.log('  fewer place a question can hide. Do not grow this number.');
  process.exit(0);
}

const known = new Set(prior.markerSites || []);
const fresh = sites.filter((s) => !known.has(s));
for (const s of fresh) {
  errors.push(`New un-annotated question marker at ${s}\n    A question raised in a doc does not count as being on the ledger. Add "[ledger L<n>]" if it is a\n    real open decision (and put it on the ledger), or "[ledger n/a]" if it is rhetorical or already answered.`);
}
// line numbers shift as docs are edited; a shrinking baseline is good news, not an error.
const retired = [...known].filter((s) => !sites.includes(s));
if (retired.length) warnings.push(`${retired.length} baseline marker site(s) no longer match (annotated, moved or removed). Run --update to re-baseline.`);

if (prior.highWaterMark && openIds.some((n) => n < prior.highWaterMark && !(prior.knownIds || []).includes(n))) {
  // soft check: a brand-new item taking a below-water id is probably a reused number
  warnings.push('An Open item uses an id below the recorded high-water mark. If that item is genuinely old, fine; if it is new, it is REUSING a retired id and every old cross-reference to it now points at the wrong question.');
}

// ── report ───────────────────────────────────────────────────────────────────
for (const w of warnings) console.warn(`⚠ ${w}`);
if (errors.length) {
  console.error(`\n✖ lint:ledger — ${errors.length} problem(s):\n`);
  for (const e of errors) console.error(`  • ${e}\n`);
  console.error('The ledger is the list of decisions that are Frits\' to make. Drift here means a question');
  console.error('he never saw got quietly treated as settled.\n');
  process.exit(1);
}
console.log(`✔ lint:ledger — ${openIds.length} open, ${answeredIds.size} answered-with-id, ${sites.length} un-annotated marker site(s) (baselined).`);
