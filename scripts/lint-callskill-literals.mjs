#!/usr/bin/env node
/**
 * lint-callskill-literals — a literal `callSkill('group', 'op')` must name an op some manifest declares.
 *
 * The waist takes `(appOrigin, opId, args)`, and both are usually string literals at the call site. Nothing
 * checks them: an op that does not exist dispatches, resolves to nothing, and the caller reads an empty
 * result as "no data". That is silent — `callSkill('stoop', 'listGroups')` shipped on mobile against an op
 * that never existed (only a core GroupManager method by that name), leaving a sections list permanently
 * empty with every test green. `src/screens/**` has no test coverage, so nothing else catches this class.
 *
 * Source of truth is the manifests themselves (invariant 4), read through the same spec list the surface
 * coverage snapshot uses — so a new app is checked the moment it is composed, with no second table here.
 *
 * Scope + honest limits:
 *   • LITERAL two-argument call sites only. A computed origin or op (`callSkill(app, id, …)`) is skipped —
 *     unknowable statically, and the generic dispatchers legitimately do this.
 *   • Comments are stripped first, so prose mentioning a retired op does not fail the build.
 *   • ALLOW lists the ops that are real but deliberately not in a manifest; each needs a reason. Growing
 *     this list is the smell — an op a person can reach should be declared.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const sh = (cmd) => execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: ROOT });
const HERE = path.dirname(new URL(import.meta.url).pathname);

/**
 * Where each app origin's ops are DECLARED. This deliberately differs from surface-coverage.mjs on three
 * rows: coverage renders the composed CHAT catalog (which carries the mock stand-ins for stoop/tasks/folio),
 * while a call-site check needs the app's REAL declaration — `apps/stoop/manifest.js` declares 34 ops where
 * the mock declares a handful. Both entries are listed; every op either source declares counts as declared.
 */
const SPECS = [
  { name: 'basis',     path: 'apps/basis/manifest.js',                            pick: (m) => m.basisManifest },
  { name: 'household', path: 'apps/household/manifest.js',                        pick: (m) => m.householdManifest },
  { name: 'stoop',     path: 'apps/stoop/manifest.js',                            pick: (m) => m.stoopManifest },
  { name: 'folio',     path: 'apps/folio/manifest.js',                            pick: (m) => m.folioManifest },
  { name: 'calendar',  path: 'apps/calendar/manifest.js',                         pick: (m) => m.calendarManifest },
  { name: 'agents',    path: 'apps/agents/manifest.js',                           pick: (m) => m.agentsManifest },
  { name: 'params',    path: 'apps/basis/src/v2/paramsManifest.js',               pick: (m) => m.paramsManifest },
  // the composed chat stand-ins — tasks has no app manifest of its own today
  { name: 'tasks',     path: 'apps/basis/src/core/manifests/mockManifests.js',    pick: (m) => m.mockTasksManifest },
  { name: 'stoop',     path: 'apps/basis/src/core/manifests/mockManifests.js',    pick: (m) => m.mockStoopManifest },
  { name: 'folio',     path: 'apps/basis/src/core/manifests/mockManifests.js',    pick: (m) => m.mockFolioManifest },
];

/**
 * Ops that exist but no manifest declares. Each row states WHY — an undeclared op a person can reach is an
 * invariant-4 violation, not an exemption, so a row here should be a deliberate architectural statement.
 */
const ALLOW = new Map([
  // (empty — add `['group.op', 'reason']` only with a reason that survives review)
]);

const declared = new Set();
const groups = new Set();
const skipped = [];
for (const spec of SPECS) {
  try {
    const m = spec.pick(await import(path.resolve(ROOT, spec.path)));
    if (!m || !Array.isArray(m.operations)) { skipped.push(`${spec.name}: no operations`); continue; }
    const group = m.appId ?? m.app ?? spec.name;
    groups.add(group);
    for (const op of m.operations) if (op?.id) declared.add(`${group}.${op.id}`);
  } catch (e) {
    skipped.push(`${spec.name}: ${e.message}`);
  }
}

if (!declared.size) {
  console.error('lint-callskill-literals: no manifest could be read — refusing to pass vacuously');
  for (const s of skipped) console.error(`  ${s}`);
  process.exit(1);
}

const isSource = (f) => /\.[cm]?[jt]sx?$/.test(f) && !f.includes('/node_modules/')
  && !f.startsWith('scripts/lint-callskill-literals');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// callSkill('group', 'op'  — both literal, quote style free, whitespace/newlines tolerated.
const CALL = /\bcallSkill\s*\(\s*(['"])([\w-]+)\1\s*,\s*(['"])([\w.-]+)\3/g;

const bad = [];
for (const f of sh('git ls-files').split('\n').filter(Boolean).filter(isSource)) {
  let src;
  try { src = stripComments(readFileSync(path.join(ROOT, f), 'utf8')); } catch { continue; }
  if (!src.includes('callSkill')) continue;
  for (const m of src.matchAll(CALL)) {
    const [group, op] = [m[2], m[4]];
    const pair = `${group}.${op}`;
    if (declared.has(pair) || ALLOW.has(pair)) continue;
    // An unknown GROUP is a different (and weaker) claim than an unknown op in a known group: a group we
    // do not compose here may be declared elsewhere. Report it, but say which case it is.
    const line = src.slice(0, m.index).split('\n').length;
    bad.push({ f, line, pair, why: groups.has(group) ? 'no such op in this app\'s manifest' : `unknown app origin "${group}"` });
  }
}

if (skipped.length) for (const s of skipped) console.error(`(skipped ${s})`);

/**
 * BASELINE — the same discipline as `lint-unreached-exports` / `lint-codenames`: the existing backlog is
 * recorded once and the guard fails on anything NEW. This is not a shrug. The first run found 179 literal
 * call sites naming ops no manifest declares — overwhelmingly `stoop` (102) and `household` (65) — which is
 * a real invariant-4 gap (the manifest is meant to be the single contract) far too large to close in the
 * same turn as the guard. Baselining makes the number VISIBLE and non-growing; closing it is its own work.
 * Do not grow this file. `--update` rewrites it; a shrinking baseline is the point.
 */
const BASELINE = path.join(HERE, 'callskill-literals.baseline.json');
const key = (b) => `${b.f}::${b.pair}`;
const found = [...new Set(bad.map(key))].sort();

if (process.argv.includes('--update')) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(BASELINE, `${JSON.stringify(found, null, 2)}\n`);
  console.log(`baseline updated: ${found.length} known undeclared call sites`);
  process.exit(0);
}

let base = [];
try { base = JSON.parse(readFileSync(BASELINE, 'utf8')); } catch { /* no baseline yet → everything is new */ }
const known = new Set(base);
const fresh = bad.filter((b) => !known.has(key(b)));
const fixed = base.filter((k) => !found.includes(k));

if (fresh.length) {
  console.error(`\n✗ ${fresh.length} NEW callSkill literal(s) name an op no manifest declares:\n`);
  for (const b of fresh) console.error(`  ${b.f}:${b.line}  callSkill('${b.pair.split('.')[0]}', '${b.pair.split('.').slice(1).join('.')}')  — ${b.why}`);
  console.error('\nAdd the op to its manifest (invariant 4), or fix the typo. Do NOT baseline it away.\n');
  process.exit(1);
}

if (fixed.length) {
  console.log(`✓ callSkill literals: ${fixed.length} baselined call site(s) are gone — run with --update to shrink the baseline`);
}
console.log(`✓ callSkill literals: no new undeclared ops (${declared.size} declared across ${groups.size} apps; ${found.length} baselined)`);
