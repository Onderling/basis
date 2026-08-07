#!/usr/bin/env node
/**
 * lint-unreached-exports — a substrate symbol that nothing reaches is a LIABILITY, not an asset.
 *
 * ── Why this guard exists ────────────────────────────────────────────────────────────────────────────
 * On 2026-08-03 an audit of the whole repo found that the dominant remaining shape in every seam was not
 * missing mechanism — it was mechanism that was **built, tested, and never consumed**:
 * `createGrantsOverPeer`, `peerFacade`, `sealedMessageLog`, `loadProfile`, `makeAgentTrailEntry`, a circle
 * store that was mirrored with nothing writing to it, a BLE transport the app never constructs.
 *
 * **Every one of them passed its tests. None of them ran.** Three parallel agents needed most of a day to
 * find that by hand. This script finds it in seconds, which is the entire argument for it existing.
 *
 * The damage is not the dead code — it is that an inert seam reads as CAPABILITY in every plan that cites
 * it. `PLAN-agent-management-surface` sat "blocked on missing substrate" while the substrate it needed had
 * already shipped, unconsumed. That is what this prevents.
 *
 * ── What it checks ───────────────────────────────────────────────────────────────────────────────────
 * For each symbol exported from `packages/<pkg>/src/**`, is it referenced ANYWHERE outside its own package
 * and outside test files? Consumers may be apps, other packages, or scripts.
 *
 * A symbol with no such consumer is either:
 *   • deliberate PUBLIC API for third parties → list it in `public-api-allowlist.json` WITH A REASON, or
 *   • an inert seam → wire it, or delete it.
 *
 * The allowlist requires a reason string because "it's public API" is exactly the excuse that lets this
 * class back in. A reason someone has to write is a reason someone can disagree with.
 *
 * ── What it deliberately does NOT do ─────────────────────────────────────────────────────────────────
 * This is a TEXT-level check, not a resolver. It cannot see dynamic dispatch (`obj[name]()`), re-exports
 * that rename, or a symbol reached only through a barrel's `export *`. So it is tuned to under-report:
 * a name that appears anywhere outside its package counts as reached, even if that appearance is a
 * comment. **A false "reached" is a missed finding; a false "unreached" would train people to ignore the
 * guard.** Given which failure is worse here, under-reporting is the right bias — this guard's job is to
 * catch the obvious dead seam, not to prove liveness.
 *
 *   node scripts/lint-unreached-exports.mjs            check (exit 1 on anything new)
 *   node scripts/lint-unreached-exports.mjs --update   rewrite the baseline from what is on disk now
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const BASELINE = path.join(ROOT, 'scripts', 'unreached-exports-baseline.json');
const ALLOWLIST = path.join(ROOT, 'scripts', 'public-api-allowlist.json');

const sh = (cmd) => execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const tracked = () => sh('git ls-files').split('\n').filter(Boolean);

const isTest = (f) => /(^|\/)(test|tests|e2e|test-browser|__tests__)\//.test(f) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(f);
const isVendored = (f) => /(^|\/)vendor\//.test(f) || /\.min\.js$/.test(f);

/** `packages/<pkg>/src/**.js` — the substrate surface this guard governs. */
function packageSources(files) {
  return files.filter((f) => /^packages\/[^/]+\/src\/.*\.[cm]?js$/.test(f) && !isTest(f) && !isVendored(f));
}
const pkgOf = (f) => f.split('/')[1];

/** Exported symbol names in one file. Covers the declaration forms this repo actually uses. */
function exportsIn(src) {
  const names = new Set();
  const add = (n) => { if (n && n !== 'default') names.add(n); };
  for (const m of src.matchAll(/^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) add(m[1]);
  for (const m of src.matchAll(/^\s*export\s+class\s+([A-Za-z_$][\w$]*)/gm)) add(m[1]);
  for (const m of src.matchAll(/^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) add(m[1]);
  // `export { a, b as c }` — the EXPOSED name is what a consumer writes, so take the alias where present.
  for (const m of src.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const as = t.match(/\bas\s+([A-Za-z_$][\w$]*)/);
      add(as ? as[1] : t.split(/\s+/)[0]);
    }
  }
  return names;
}

const files = tracked();
const sources = packageSources(files);

/**
 * Only the PUBLIC surface counts — the names a package's barrel (`src/index.js`) actually exposes.
 *
 * The first version of this guard checked every export in every module and reported 990 symbols, which is
 * noise, not a finding: a package's internal helpers are legitimately exported so their own tests can reach
 * them, and that is not an inert seam — it is a unit under test. Reporting them would have buried the six
 * real cases in nine hundred false ones, and a guard nobody can act on is a guard nobody runs.
 *
 * A symbol on the barrel is different: the package is ASSERTING that something outside should call this.
 * If nothing does, that assertion is false, and that is exactly the class this exists to catch.
 */
function barrelSurface(pkg) {
  const barrel = `packages/${pkg}/src/index.js`;
  if (!files.includes(barrel)) return null;   // no barrel → no declared surface → nothing to assert
  let src;
  try { src = readFileSync(path.join(ROOT, barrel), 'utf8'); } catch { return null; }
  const names = exportsIn(src);
  // `export * from './x.js'` re-exports everything x declares — those names are on the surface too.
  for (const m of src.matchAll(/^\s*export\s*\*\s*from\s*['"](\.[^'"]+)['"]/gm)) {
    const rel = path.join(path.dirname(barrel), m[1]);
    try { for (const n of exportsIn(readFileSync(path.join(ROOT, rel), 'utf8'))) names.add(n); }
    catch { /* unresolvable re-export — skip rather than guess */ }
  }
  return names;
}
const surfaceByPkg = new Map();
for (const pkg of new Set(sources.map(pkgOf))) surfaceByPkg.set(pkg, barrelSurface(pkg));

// Everything a consumer could be: any tracked JS outside tests/vendor. Read once — 500 symbols × N files
// of grep would be minutes; one pass is milliseconds.
const consumerFiles = files.filter(
  (f) => /\.[cm]?[jt]sx?$/.test(f) && !isTest(f) && !isVendored(f) && !f.includes('/node_modules/'),
);
const contentByFile = new Map();
for (const f of consumerFiles) {
  try { contentByFile.set(f, readFileSync(path.join(ROOT, f), 'utf8')); } catch { /* unreadable → skip */ }
}

let allow = {};
let allowPackages = {};
try {
  const a = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
  allow = a.symbols ?? {};
  // Whole-package entries: a PUBLISHED package's barrel IS its third-party surface, so "nothing in this
  // repo calls it" is the expected state, not a finding. One reason per package beats 400 copies of the
  // same reason — and keeps the list readable enough that someone would notice a package added by stealth.
  allowPackages = a.packages ?? {};
} catch { /* none yet */ }

const violations = [];
// Barrel symbols in a WHOLE-PACKAGE-exempted (published) package that nothing in-repo reaches. Expected for
// genuine third-party API — but the whole-package exemption is COARSE, so an internal seam that landed on a
// published barrel without being real API (the `peerFacade` class) would hide here silently. We keep these
// GREEN (a published barrel IS a third-party surface) but SURFACE their count, so the mask stays honest.
const exemptedUnreached = [];
for (const file of sources) {
  let src;
  try { src = readFileSync(path.join(ROOT, file), 'utf8'); } catch { continue; }
  const owner = pkgOf(file);
  for (const name of exportsIn(src)) {
    if (allow[name]) continue;   // explicitly-named public API, with a per-symbol reason — fully exempt
    const surface = surfaceByPkg.get(owner);
    if (!surface || !surface.has(name)) continue;    // internal helper — its own tests may be its only caller
    const re = new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`);
    let reached = false;
    for (const [f, content] of contentByFile) {
      if (pkgOf(f) === owner && f.startsWith('packages/')) continue;   // own package does not count
      if (re.test(content)) { reached = true; break; }
    }
    if (reached) continue;
    // Unreached. A whole-package exemption keeps it green but is surfaced (not failed); anything else fails.
    if (allowPackages[owner]) exemptedUnreached.push({ file, symbol: name, package: owner });
    else violations.push({ file, symbol: name, package: owner });
  }
}

const siteKey = (v) => `${v.file}:${v.symbol}`;

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify({
    $schema: 'unreached-exports-baseline/v0',
    description:
      'CEILING of substrate exports with no consumer outside their own package. A symbol here is DEBT: '
      + 'wire it or delete it. Removing entries is always allowed; adding one needs a reason in review.',
    total: violations.length,
    symbols: violations.map(siteKey).sort(),
  }, null, 2)}\n`);
  console.log(`✓ baseline updated: ${violations.length} unreached export(s) → ${path.relative(ROOT, BASELINE)}`);
  process.exit(0);
}

let known = new Set();
try { known = new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).symbols ?? []); } catch { /* none yet */ }
const fresh = violations.filter((v) => !known.has(siteKey(v)));

if (fresh.length) {
  console.error(`\n✗ lint:unreached — ${fresh.length} export(s) that NOTHING reaches:\n`);
  for (const v of fresh) console.error(`   - ${v.file}  →  ${v.symbol}`);
  console.error(`
An export with no consumer outside its own package is an INERT SEAM. It passes its tests, it reads as
capability in every plan that cites it, and it never runs. Three of those cost a day to find by hand.

Fix, in order of preference:
  1. WIRE it — name the production path that reaches it. That is the definition of done (CLAUDE.md).
  2. DELETE it — if nothing needs it, the repo is better without it.
  3. Declare it public API — add it to scripts/public-api-allowlist.json WITH A REASON, if third parties
     are genuinely meant to call it.
`);
  process.exit(1);
}

// ── Report the carried debt WITH ITS VERDICT ────────────────────────────────────────────────────────
// A baseline records THAT something is unreached. It cannot record WHICH of the two it is — orphaned (the
// job still stands, wire it) or superseded (something else took the job, delete it). That distinction is
// the whole decision, it costs a subsystem's worth of archaeology to recover, and on 2026-08-03 it was
// recovered for nine of them. Without somewhere to put it, that work evaporates and the next person redoes
// it. So: `reasons` in the baseline, keyed by package, printed here.
//
// Packages with no verdict yet are named as such — an honest "not yet triaged" beats a silent omission.
const carried = violations.length;
if (carried) {
  let reasons = {};
  try { reasons = JSON.parse(readFileSync(BASELINE, 'utf8')).reasons ?? {}; } catch { /* none yet */ }
  const byPkg = new Map();
  for (const v of violations) byPkg.set(v.package, (byPkg.get(v.package) ?? 0) + 1);
  console.warn(`⚠ lint:unreached: ${carried} known unreached export(s) carried — debt, not news.\n`);
  for (const [pkg, n] of [...byPkg].sort((a, b) => b[1] - a[1])) {
    const why = reasons[pkg];
    console.warn(`   ${String(n).padStart(3)}  ${pkg.padEnd(18)} ${why ?? '— NOT YET TRIAGED (orphaned or superseded? recover the intent before deciding)'}`);
  }
  console.warn('\n   orphaned → wire it · superseded → delete it. "Unreached" alone decides nothing.\n');
}

// ── Visibility: the whole-package exemptions, made honest ────────────────────────────────────────────
// A published package's barrel IS its third-party surface, so "no in-repo consumer" is expected there and we
// do not fail on it. But that whole-package exemption is coarse — it would also hide an INTERNAL seam that
// ended up on a published barrel without being genuine API (peerFacade is the worked example: an internal
// per-circle member projection, on `core`'s barrel, unadopted). So we surface the per-package count. Green,
// but honest: someone can look at "core: N" and ask whether all N are really third-party API. Triage by
// moving an inert internal off the barrel (making it a plain internal the guard ignores) or wiring it.
if (exemptedUnreached.length) {
  const byPkg = new Map();
  for (const v of exemptedUnreached) byPkg.set(v.package, (byPkg.get(v.package) ?? 0) + 1);
  console.warn(`ℹ lint:unreached: ${exemptedUnreached.length} barrel symbol(s) in published (whole-package-exempted) packages have no in-repo consumer.`);
  console.warn('   Expected for genuine third-party API — but VERIFY none is an inert internal (the peerFacade class). Per package:');
  for (const [pkg, n] of [...byPkg].sort((a, b) => b[1] - a[1])) console.warn(`   ${String(n).padStart(3)}  ${pkg}`);
  console.warn('');
}
console.log('✓ lint:unreached: no newly-unreached exports.');
