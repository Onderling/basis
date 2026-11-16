#!/usr/bin/env node
/**
 * lint-architecture-date — docs/architecture.md carries a "Last updated: YYYY-MM-DD" line, and every change to the
 * file moves it.
 *
 * Why: the file is the first thing an agent or a reader is told to read, and it went stale for weeks while the code
 * moved (an audit on 2026-11-12 found five wrong statements). A date on the file says how fresh it is; a date nobody
 * has to move says nothing. So:
 *   • the line must exist and be a real date, not in the future;
 *   • when the file differs from the base branch (`origin/development`, or GUARD_BASE_REF), its date must be LATER
 *     than the base's date, or today (a second change on the same day). A change that leaves an older date is red.
 * When the base ref is not available (a fresh clone, a shallow CI checkout that did not fetch it), the second check
 * says so and passes: it cannot tell, and a guard that guesses goes red for the wrong reason.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'docs/architecture.md';

/** The "Last updated" date in the file's text, or null. */
export function lastUpdated(text) {
  const m = String(text).match(/\*\*Last updated:\s*(\d{4}-\d{2}-\d{2})\*\*/);
  if (!m) return null;
  const d = new Date(`${m[1]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== m[1] ? null : m[1];
}

/**
 * Problems, as messages.
 * @param {string} text        the file now
 * @param {string|null} base   the file on the base branch, or null when the base is not available
 * @param {string} today       YYYY-MM-DD
 */
export function architectureDateProblems(text, base, today) {
  const now = lastUpdated(text);
  if (!now) return [`${FILE} has no valid "**Last updated: YYYY-MM-DD**" line near its top`];
  const out = [];
  if (now > today) out.push(`${FILE} says it was last updated ${now}, which is in the future`);
  if (base != null && base !== text) {
    const was = lastUpdated(base);
    // moved, or already today (a second change on the day the base was dated)
    if (was && now <= was && now !== today) out.push(`${FILE} changed but its "Last updated" date did not move (still ${now}) — set it to today`);
  }
  return out;
}

function baseText() {
  const ref = process.env.GUARD_BASE_REF || 'origin/development';
  try {
    return execFileSync('git', ['show', `${ref}:${FILE}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const text = readFileSync(path.join(ROOT, FILE), 'utf8');
  const base = baseText();
  const problems = architectureDateProblems(text, base, new Date().toISOString().slice(0, 10));
  if (problems.length) {
    console.error('lint-architecture-date:');
    for (const p of problems) console.error(`  • ${p}`);
    process.exit(1);
  }
  console.log(`lint-architecture-date: last updated ${lastUpdated(text)}${base == null ? ' (no base ref to compare with — the "date moved" check was skipped)' : ''}`);
}
