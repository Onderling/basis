#!/usr/bin/env node
// Dependency-boundary fitness function — CLAUDE.md invariant #5 (three-layer dependency).
//
// FAILS CI when a file reaches ACROSS a package boundary into another package's RAW
// `packages/<pkg>/src/**` by a RELATIVE path (e.g.
//   import { X } from '../../../packages/sync-engine/src/objectVersions.js')
// instead of going through that package's PUBLIC surface (`@onderling/<pkg>` barrel or a
// `@onderling/<pkg>/<subpath>` export). This is the recurring drift the kring-host extraction
// arc (W2–W5) keeps hand-fixing; per CLAUDE.md "How to work", we leave a check behind so the
// same drift FAILS next time.
//
// SEMANTICS — baseline is a CEILING, not a snapshot to match exactly:
//   • FAILS if ANY current violation is NOT in the baseline (a NEW reach-in).
//   • PASSES if current ⊆ baseline (removing a violation is always allowed — another agent is
//     concurrently REMOVING some of these; the check must stay green as the set SHRINKS).
//   • WARNS (non-fatal) about baselined violations still present, so the debt stays visible.
//
// What counts as a violation:
//   • specifier is RELATIVE (starts with '.'), AND
//   • it resolves (lexically) into `packages/<B>/src/**` where <B> is a DIFFERENT package than
//     the importing file's own package (apps/<X> or packages/<A>).
//   • Imports that stay within the importer's own package (its own `src/`) are FINE.
//   • Bare `@onderling/<pkg>` specifiers are FINE — that IS the public boundary.
//
// Usage:
//   node scripts/lint-dep-boundaries.mjs            # check against baseline (exit 1 on new)
//   node scripts/lint-dep-boundaries.mjs --update   # regenerate the baseline from current
//   node scripts/lint-dep-boundaries.mjs --json     # machine-readable current violations
//   (wired as: npm run lint:deps)

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineOf } from './guard-where.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const REPO_ROOT = resolve(__dirname, '..');
export const BASELINE_PATH = join(__dirname, 'dep-boundary-baseline.json');

const SOURCE_EXT = ['.js', '.mjs', '.jsx', '.ts'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.next', '.expo']);
const SCAN_ROOTS = ['apps', 'packages'];

/* ── source discovery ─────────────────────────────────────────── */

/** Recursively collect source files under `dir`, skipping node_modules/dist/build/coverage. */
export function collectSourceFiles(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      collectSourceFiles(full, out);
    } else if (e.isFile() && SOURCE_EXT.some((x) => e.name.endsWith(x)) && !e.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/* ── specifier extraction ─────────────────────────────────────── */

// Strip block + line comments so `//` in http:// and commented-out imports don't produce matches.
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1');

const RE_IMPORT_EXPORT_FROM = /(?:^|[\s;}])(?:import|export)\b[^;'"`]*?\bfrom\s*['"]([^'"]+)['"]/g;
const RE_SIDE_EFFECT_IMPORT = /(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g;
const RE_REQUIRE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** All module specifiers referenced by static import / export-from / require() in `source`. */
export function parseSpecifiers(source) {
  const clean = stripComments(source);
  const specs = new Set();
  for (const re of [RE_IMPORT_EXPORT_FROM, RE_SIDE_EFFECT_IMPORT, RE_REQUIRE]) {
    re.lastIndex = 0;
    for (const m of clean.matchAll(re)) specs.add(m[1]);
  }
  return [...specs];
}

/* ── boundary classification (pure / lexical — no disk access) ── */

/** Return `apps/<X>` or `packages/<X>` (repo-relative, posix) owning `fileRel`, else null. */
function owningPackage(fileRel) {
  const parts = fileRel.split('/');
  if ((parts[0] === 'apps' || parts[0] === 'packages') && parts.length > 1) {
    return `${parts[0]}/${parts[1]}`;
  }
  return null;
}

/** posix-normalise a path (the baseline + matching are posix so it's stable across platforms). */
const toPosix = (p) => p.split(sep).join('/');

/**
 * Classify a single (file, specifier) pair. Pure lexical path math — takes an ABSOLUTE file
 * path + repo root so it is trivially testable with synthetic inputs (no disk access).
 * Returns a violation object, or null if fine.
 */
export function classifyImport(fileAbs, specifier, repoRoot = REPO_ROOT) {
  if (!specifier.startsWith('.')) return null; // bare specifier (`@onderling/*`, node builtin) = OK
  const fileRel = toPosix(relative(repoRoot, fileAbs));
  const importerPkg = owningPackage(fileRel);
  if (!importerPkg) return null; // importer not inside apps/ or packages/

  const targetAbs = resolve(dirname(fileAbs), specifier);
  const targetRel = toPosix(relative(repoRoot, targetAbs));
  // Must resolve INTO packages/<B>/src/**
  const m = targetRel.match(/^packages\/([^/]+)\/src\//);
  if (!m) return null;
  const targetPkg = `packages/${m[1]}`;
  if (targetPkg === importerPkg) return null; // within the importer's own package = FINE

  return {
    file: fileRel,
    specifier,
    reachesInto: `@onderling/${m[1]}`,
    targetPkgDir: targetPkg,
    category: categoryOf(fileRel),
  };
}

/** runtime = real architectural debt; test/script = lower-priority tooling reach-ins. */
function categoryOf(fileRel) {
  const isTest = /(^|\/)(test|tests|__tests__|__mocks__|e2e|fixtures?)(\/|$)/.test(fileRel) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(fileRel);
  const isScript = /(^|\/)scripts?(\/|$)/.test(fileRel);
  return isTest ? 'test' : isScript ? 'script' : 'runtime';
}

/* ── whole-repo scan ──────────────────────────────────────────── */

/** Scan the repo and return a sorted, de-duplicated list of boundary violations. */
export function scanViolations(repoRoot = REPO_ROOT) {
  const files = [];
  for (const r of SCAN_ROOTS) files.push(...collectSourceFiles(join(repoRoot, r)));
  const seen = new Map();
  for (const fileAbs of files) {
    let src;
    try { src = readFileSync(fileAbs, 'utf8'); } catch { continue; }
    for (const spec of parseSpecifiers(src)) {
      const v = classifyImport(fileAbs, spec, repoRoot);
      if (v) seen.set(`${v.file}::${v.specifier}`, v);
    }
  }
  return [...seen.values()].sort((a, b) =>
    a.file === b.file ? a.specifier.localeCompare(b.specifier) : a.file.localeCompare(b.file));
}

/* ── baseline (ceiling) diff ──────────────────────────────────── */

const keyOf = (v) => `${v.file}::${v.specifier}`;

export function loadBaseline(path = BASELINE_PATH) {
  if (!existsSync(path)) return { violations: [] };
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Compare current violations against a baseline treated as a CEILING.
 *   newViolations — present now, absent from baseline → these FAIL the check.
 *   stillPresent  — in both (surviving debt) → warn only.
 *   removed       — in baseline, gone now → informational (allowed, never fails).
 */
export function diffAgainstBaseline(current, baseline) {
  const baseKeys = new Set((baseline.violations ?? []).map(keyOf));
  const curKeys = new Set(current.map(keyOf));
  return {
    newViolations: current.filter((v) => !baseKeys.has(keyOf(v))),
    stillPresent: current.filter((v) => baseKeys.has(keyOf(v))),
    removed: (baseline.violations ?? []).filter((v) => !curKeys.has(keyOf(v))),
  };
}

/* ── CLI ──────────────────────────────────────────────────────── */

function buildBaselineFile(current) {
  const counts = { runtime: 0, script: 0, test: 0 };
  for (const v of current) counts[v.category] = (counts[v.category] ?? 0) + 1;
  return {
    $schema: 'dep-boundary-baseline/v0',
    description:
      'CEILING of known cross-package raw-src reach-ins (CLAUDE.md invariant #5). ' +
      'lint:deps FAILS on any violation NOT listed here; removing entries is always allowed. ' +
      'Regenerate with: node scripts/lint-dep-boundaries.mjs --update',
    generatedAt: new Date().toISOString().slice(0, 10),
    total: current.length,
    byCategory: counts,
    violations: current.map((v) => ({
      file: v.file,
      specifier: v.specifier,
      reachesInto: v.reachesInto,
      category: v.category,
    })),
  };
}

function main() {
  const args = process.argv.slice(2);
  const current = scanViolations();

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(current, null, 2) + '\n');
    return;
  }
  if (args.includes('--update')) {
    writeFileSync(BASELINE_PATH, JSON.stringify(buildBaselineFile(current), null, 2) + '\n');
    console.log(`✓ baseline updated: ${current.length} violation(s) → ${toPosix(relative(REPO_ROOT, BASELINE_PATH))}`);
    return;
  }

  const baseline = loadBaseline();
  const { newViolations, stillPresent, removed } = diffAgainstBaseline(current, baseline);

  if (removed.length) {
    console.log(`✓ ${removed.length} baselined violation(s) removed — nice. Run --update to shrink the ceiling:`);
    for (const v of removed) console.log(`     - ${v.file}  (${v.specifier})`);
  }
  if (stillPresent.length) {
    console.log(`\n⚠  ${stillPresent.length} baselined boundary violation(s) still present (known debt):`);
    for (const v of stillPresent) console.log(`     - [${v.category}] ${v.file} → ${v.reachesInto}  (${v.specifier})`);
  }
  if (newViolations.length) {
    console.error(`\n✖ lint:deps: ${newViolations.length} NEW cross-package boundary violation(s):`);
    for (const v of newViolations) {
      let src = '';
      try { src = readFileSync(join(REPO_ROOT, v.file), 'utf8'); } catch { /* gone: point at its top */ }
      console.error(`   - ${v.file}:${lineOf(src, v.specifier)}`);
      console.error(`       reaches into ${v.reachesInto} raw src via  ${v.specifier}`);
      console.error(`       Fix: import from \`${v.reachesInto}\` (barrel) instead, or add a \`${v.reachesInto}/<subpath>\` export and import that.`);
    }
    console.error(`\nInvariant #5: apps → packages/{substrates} → packages/core, always through the ` +
      `\`@onderling/<pkg>\` public surface — never another package's raw src/.\n`);
    process.exit(1);
  }
  console.log(`\n✓ lint:deps: no new boundary violations (${current.length} current ≤ ${(baseline.violations ?? []).length} baselined).`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
