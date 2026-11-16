#!/usr/bin/env node
/**
 * lint-decisions — docs/decisions.md is in date order, and every decision docs/architecture.md cites is in it.
 *
 * Why (2026-11-12, from outside feedback): architecture.md said "ACP, and only ACP (decided 2026-08-26)" while
 * decisions.md still said WAC (2026-07-31) and had no entry for the ACP decision; a 2026-08-19 decision was the same;
 * and one entry sat out of date order. A decision written only into the architecture file is invisible to anyone who
 * greps decisions.md before changing a behaviour, which is what CLAUDE.md tells them to do. So:
 *   • ORDER: each entry's date (the first YYYY-MM-DD in its `## ` heading) is not earlier than the one before it;
 *   • BACKING: every "decided YYYY-MM-DD" in architecture.md has a decisions.md entry of that date.
 * A heading without a date is red too: an entry nobody can place in time cannot be ordered or cited.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DECISIONS = 'docs/decisions.md';
const ARCH = 'docs/architecture.md';
const DATE = /\d{4}-\d{2}-\d{2}/;

/** Each `## ` entry heading: its line number, its date (or null), its text. */
export function entries(text) {
  return String(text).split('\n').flatMap((l, i) => (l.startsWith('## ') ? [{ line: i + 1, date: l.match(DATE)?.[0] ?? null, heading: l }] : []));
}

/** The dates architecture.md cites as decided. */
export function citedDecisions(text) {
  return [...new Set([...String(text).matchAll(/decided (?:on )?(\d{4}-\d{2}-\d{2})/gi)].map((m) => m[1]))].sort();
}

/** Problems, as messages. */
export function decisionsProblems(decisionsText, archText) {
  const out = [];
  const es = entries(decisionsText);
  let prev = null;
  for (const e of es) {
    if (!e.date) { out.push(`${DECISIONS}:${e.line} has no date in its heading: ${e.heading.slice(0, 80)}`); continue; }
    if (prev && e.date < prev.date) out.push(`${DECISIONS}:${e.line} (${e.date}) comes after ${prev.date} (line ${prev.line}) — entries are in date order`);
    prev = e;
  }
  const have = new Set(es.map((e) => e.date).filter(Boolean));
  for (const d of citedDecisions(archText)) {
    if (!have.has(d)) out.push(`${ARCH} cites a decision of ${d}, and ${DECISIONS} has no entry of that date — record it there`);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const problems = decisionsProblems(readFileSync(path.join(ROOT, DECISIONS), 'utf8'), readFileSync(path.join(ROOT, ARCH), 'utf8'));
  if (problems.length) {
    console.error('lint-decisions:');
    for (const p of problems) console.error(`  • ${p}`);
    process.exit(1);
  }
  console.log(`lint-decisions: ${entries(readFileSync(path.join(ROOT, DECISIONS), 'utf8')).length} entries in date order, every decision architecture.md cites is recorded`);
}
