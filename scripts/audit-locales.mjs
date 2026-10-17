#!/usr/bin/env node
/**
 * audit-locales.mjs — Phase 52.15.6 (2026-05-14).
 *
 * Scans every `apps/<name>/locales/*.json` for terminology
 * violations defined in
 * `Project Files/conventions/localisation.md`. Specifically: locale
 * entries whose `text` field contains a banned Pod-synonym AND whose
 * `doc` field signals a pod-related context (matches /pod/i).
 *
 * Exit code:
 *   0  — clean
 *   1  — violations found
 *   2  — script error (missing apps/, bad JSON, etc.)
 *
 * Usage:
 *   node scripts/audit-locales.mjs
 *   node scripts/audit-locales.mjs --apps apps/pinboard apps/folio   # subset
 *   node scripts/audit-locales.mjs --json                          # machine-readable
 *
 * Designed to be hand-runnable; CI integration is open (repo has no
 * CI yet).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '..');

/* ── Configuration — keep in sync with localisation.md ─────────── */

/** Words banned as substitutes for "Pod" in technical contexts. */
export const BANNED_PATTERNS = [
  // EN
  { lang: 'en', pattern: /\bstorage\b/i,    word: 'storage' },
  { lang: 'en', pattern: /\bdrive\b/i,      word: 'drive' },
  { lang: 'en', pattern: /\bcloud\b/i,      word: 'cloud' },
  { lang: 'en', pattern: /\byour data\b/i,  word: 'your data' },
  { lang: 'en', pattern: /\bvault\b/i,      word: 'vault' },
  { lang: 'en', pattern: /\bbucket\b/i,     word: 'bucket' },
  // NL
  { lang: 'nl', pattern: /\bopslag\b/i,     word: 'opslag' },
  { lang: 'nl', pattern: /\bschijf\b/i,     word: 'schijf' },
  { lang: 'nl', pattern: /\bcloud\b/i,      word: 'cloud' },
  { lang: 'nl', pattern: /\bjouw data\b/i,  word: 'jouw data' },
  { lang: 'nl', pattern: /\bje data\b/i,    word: 'je data' },
  { lang: 'nl', pattern: /\bkluis\b/i,      word: 'kluis' },
  { lang: 'nl', pattern: /\bbak\b/i,        word: 'bak' },
];

/** Context-relevance heuristic: doc says "pod" → audit applies. */
export const POD_CONTEXT_PATTERN = /\bpod\b/i;

/* ── Argument parsing ──────────────────────────────────────────── */

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const appsIdx = args.indexOf('--apps');
const appsFilter = appsIdx >= 0
  ? args.slice(appsIdx + 1).filter(a => !a.startsWith('--'))
  : null;

/* ── Discovery ─────────────────────────────────────────────────── */

function discoverLocaleFiles() {
  const appsDir = join(REPO_ROOT, 'apps');
  let appNames;
  try {
    appNames = readdirSync(appsDir).filter(name => {
      try { return statSync(join(appsDir, name)).isDirectory(); }
      catch { return false; }
    });
  } catch (err) {
    fail(`audit-locales: cannot read apps/: ${err.message}`, 2);
  }

  const files = [];
  for (const name of appNames) {
    if (appsFilter && !appsFilter.some(f => f.endsWith(name) || f === name || f === `apps/${name}`)) {
      continue;
    }
    const localesDir = join(appsDir, name, 'locales');
    let entries;
    try { entries = readdirSync(localesDir); }
    catch { continue; }  // no locales dir — skip silently
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const lang = entry.replace(/\.json$/, '');
      files.push({ app: name, lang, path: join(localesDir, entry) });
    }
  }
  return files;
}

/* ── Scanning ──────────────────────────────────────────────────── */

/**
 * Walks the locale tree and yields every leaf entry. Supports both
 * legacy plain-string leaves and the locked {text, doc} shape (the
 * latter is what the audit applies to — plain strings have no `doc`
 * field so they aren't matched as "pod-related").
 */
export function* walkEntries(obj, path = []) {
  if (obj == null) return;
  if (typeof obj === 'string') {
    yield { path, text: obj, doc: null };
    return;
  }
  if (typeof obj !== 'object') return;
  // Leaf {text, doc} entry
  if (typeof obj.text === 'string' && (obj.doc === undefined || typeof obj.doc === 'string')) {
    yield { path, text: obj.text, doc: obj.doc ?? null };
    return;
  }
  // Nested object — recurse.
  for (const [k, v] of Object.entries(obj)) {
    yield* walkEntries(v, [...path, k]);
  }
}

/**
 * Audit a parsed locale-JSON object. Exported for unit testing —
 * pass a synthetic object and verify the violations list.
 *
 * @param {object} args
 * @param {object} args.obj
 * @param {string} args.lang   — 'en' | 'nl' (matched against BANNED_PATTERNS)
 * @param {string} [args.app]  — optional label for the report
 * @returns {Array<{app, lang, key, word, text, doc}>}
 */
export function auditLocaleObject({ obj, lang, app = '<unknown>' }) {
  const violations = [];
  for (const entry of walkEntries(obj)) {
    if (!entry.doc) continue;                              // skip plain-string leaves
    if (!POD_CONTEXT_PATTERN.test(entry.doc)) continue;    // not a pod-context entry
    for (const banned of BANNED_PATTERNS) {
      if (banned.lang !== lang) continue;
      if (banned.pattern.test(entry.text)) {
        violations.push({
          app, lang,
          key:  entry.path.join('.'),
          word: banned.word,
          text: entry.text,
          doc:  entry.doc,
        });
      }
    }
  }
  return violations;
}

function auditFile({ app, lang, path }) {
  let json;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return { violations: [], errors: [{ file: path, message: `JSON parse error: ${err.message}` }] };
  }
  const violations = auditLocaleObject({ obj: json, lang, app })
    .map(v => ({ ...v, file: path }));
  return { violations, errors: [] };
}

/* ── Main ──────────────────────────────────────────────────────── */

function fail(msg, code = 2) {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}

function main() {
  const files = discoverLocaleFiles();
  if (files.length === 0) {
    if (appsFilter) {
      fail(`audit-locales: no locale files found matching --apps ${appsFilter.join(' ')}`, 2);
    }
    fail('audit-locales: no apps/*/locales/*.json files found', 2);
  }

  const allViolations = [];
  const allErrors     = [];
  for (const file of files) {
    const { violations, errors } = auditFile(file);
    allViolations.push(...violations);
    allErrors.push(...errors);
  }

  if (jsonOutput) {
    process.stdout.write(JSON.stringify({
      files:      files.length,
      violations: allViolations,
      errors:     allErrors,
    }, null, 2) + '\n');
  } else {
    process.stdout.write(`audit-locales: scanned ${files.length} locale files\n`);
    for (const err of allErrors) {
      process.stderr.write(`ERROR ${err.file}: ${err.message}\n`);
    }
    if (allViolations.length === 0) {
      process.stdout.write('audit-locales: ✓ clean — no terminology violations\n');
    } else {
      process.stderr.write(`audit-locales: ✗ ${allViolations.length} violation(s):\n`);
      for (const v of allViolations) {
        process.stderr.write(
          `  ${v.app}/${v.lang} key=${v.key} banned="${v.word}" text="${v.text}" doc="${v.doc}"\n`,
        );
      }
    }
  }

  if (allErrors.length > 0) process.exit(2);
  if (allViolations.length > 0) process.exit(1);
  process.exit(0);
}

// Only run main() when invoked directly (not when imported for testing).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
