#!/usr/bin/env node
/**
 * lint-resolution-policy (G-L23) — the DECLARATION LAYER is complete + has no SECOND ordering mechanism.
 *
 * Two claims, both baselined (green day one, red only on a NEW violation — the roadmap's "architectural spine
 * step 0"):
 *
 *   (a) COMPLETENESS — every manifest op that WRITES a mergeable item field declares its resolution policy
 *       (`resolves: [{ field, policy }]`), so a concurrent-write merge is never decided by an undeclared,
 *       sender-shaped default. The current undeclared write-ops are grandfathered in the baseline; a NEW
 *       write-op with no `resolves` fails until it declares one (or is added to the baseline with a reason).
 *   (b) NO SECOND ORDERING — no NEW bespoke wall-clock/timestamp comparison-sort in the merge-critical paths.
 *       The one ordering coordinate is the Lamport clock + deps-DAG (design §3); a `.sort((a,b)=>a.ts-b.ts)`
 *       creeping into a merge path is exactly the drift that predated this layer (it would have caught
 *       causalMerge's old wall-clock and chat's timestamp order). Known sites are baselined by file+count.
 *
 * Also pins AGREEMENT: a declared policy must be a real policy, and the security-relevant task CLAIM cluster
 * must never be declared DOWN to content — the manifest layer cannot weaken the substrate's safe floor.
 *
 *   node scripts/lint-resolution-policy.mjs [--update]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const BASELINE = path.join(HERE, 'resolution-policy-baseline.json');

const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

// Verbs that WRITE a mergeable item field (as opposed to list/tree/read/help/remove). An op with one of these
// verbs is expected to declare how its writes reconcile. Deletes are not a field merge → excluded.
const WRITE_VERBS = new Set([
  'add', 'update', 'edit', 'claim', 'reassign', 'submit', 'approve', 'reject', 'revoke', 'complete', 'confirm', 'register',
]);

// Merge-critical source roots the "no second ordering mechanism" lint scans.
const ORDERING_DIRS = ['packages/item-store/src'];
// A bespoke wall-clock/timestamp ORDERING (a comparison or a sort comparator keyed on a time field). Matches
// ordering, NOT assignment (`updatedAt: ts`) — so display-timestamp writes don't trip it.
const ORDERING_RE = [
  /\.sort\([^)]*\b(updatedAt|createdAt|claimedAt|timestamp|ts)\b/,          // sort keyed on a time field
  /\b(updatedAt|createdAt|timestamp)\s*[<>]=?\s*[^=]/,                       // `x.updatedAt < y`
  /[<>]=?\s*\w*\.(updatedAt|createdAt|timestamp)\b/,                         // `< y.updatedAt`
  /\b[ab]\.(updatedAt|createdAt|timestamp|ts)\b.*-.*\b[ab]\.(updatedAt|createdAt|timestamp|ts)\b/, // `(a,b)=> a.ts - b.ts` (comparator subtraction)
];

// EVERY manifest: the set the app runs (`allManifests`: the app folders' manifests AND the ones declared inside basis,
// the parameter register, the lanes, keys, grants, the assistant, the tools), then any `apps/*/manifest.js` that set
// does not carry (an example app). An op is keyed by its manifest's own `app`, not by the folder it sits in.
async function appManifests() {
  const out = [];
  const seen = new Set();
  const { allManifests } = await load('apps/basis/src/v2/manifestSources.js');
  for (const manifest of allManifests()) {
    if (!manifest?.app || seen.has(manifest)) continue;
    seen.add(manifest);
    out.push({ app: manifest.app, rel: `the ${manifest.app} manifest (apps/basis/src/v2/manifestSources.js lists it)`, manifest });
  }
  const appsDir = path.join(ROOT, 'apps');
  for (const dir of readdirSync(appsDir)) {
    const rel = `apps/${dir}/manifest.js`;
    try { readFileSync(path.join(ROOT, rel)); } catch { continue; }
    let mod;
    try { mod = await load(rel); } catch (e) { out.push({ app: dir, rel, error: e }); continue; }
    const manifest = mod.default ?? Object.values(mod).find((v) => v && Array.isArray(v.operations));
    if (!manifest || seen.has(manifest)) continue;
    seen.add(manifest);
    out.push({ app: manifest.app ?? dir, rel, manifest });
  }
  return out;
}

const RESOLUTIONS = new Set(['content', 'claim', 'spine']);
// The security-relevant task claim cluster — mirrors @onderling/item-store causalMerge CLAIM_FIELDS. A
// manifest may not declare any of these on `task` as anything other than `claim` (no downgrade).
let CLAIM_FIELDS = [];

async function collect() {
  ({ CLAIM_FIELDS } = await load('packages/item-store/src/causalMerge.js'));
  const writeOpsMissing = [];   // `<app>:<opId>` write-ops with no resolves
  const violations = [];        // hard errors (bad policy / downgrade) — never baselined
  const fileOf = {};            // `<app>:<opId>` -> the manifest file that declares it
  for (const { app, rel, manifest, error } of await appManifests()) {
    if (error) { violations.push(`${rel}: manifest failed to import (${error.message}).\n     Fix: make the manifest import cleanly (run node on it to see the error).`); continue; }
    for (const op of manifest?.operations ?? []) {
      const key = `${app}:${op.id}`;
      fileOf[key] = rel;
      const decls = Array.isArray(op.resolves) ? op.resolves : [];
      // Agreement: declared policies must be real; task claim-cluster fields must stay `claim`.
      const types = Array.isArray(op.appliesTo?.type) ? op.appliesTo.type : (op.appliesTo?.type ? [op.appliesTo.type] : []);
      for (const d of decls) {
        if (!d || !RESOLUTIONS.has(d.policy)) { violations.push(`${rel}: ${key}: declares unknown policy "${d?.policy}" for field "${d?.field}".\n     Fix: set the policy to one of ${[...RESOLUTIONS].join(' | ')} in the op's \`resolves\`.`); continue; }
        if (types.includes('task') && CLAIM_FIELDS.includes(d.field) && d.policy !== 'claim') {
          violations.push(`${rel}: ${key}: declares (task, ${d.field}) → ${d.policy}, but the claim cluster is FIXED at claim (no downgrade).\n     Fix: declare { field: '${d.field}', policy: 'claim' }, or drop that entry from the op's \`resolves\`.`);
        }
      }
      if (WRITE_VERBS.has(op.verb) && decls.length === 0) writeOpsMissing.push(key);
    }
  }
  return { writeOpsMissing: writeOpsMissing.sort(), violations, fileOf };
}

function scanOrdering() {
  const hits = {};   // file -> count
  const walk = (dir) => {
    let names; try { names = readdirSync(path.join(ROOT, dir), { withFileTypes: true }); } catch { return; }
    for (const d of names) {
      const rel = `${dir}/${d.name}`;
      if (d.isDirectory()) { walk(rel); continue; }
      if (!/\.[cm]?js$/.test(d.name) || /\.test\./.test(d.name)) continue;
      const src = readFileSync(path.join(ROOT, rel), 'utf8');
      let n = 0;
      for (const line of src.split('\n')) if (ORDERING_RE.some((re) => re.test(line))) n++;
      if (n) hits[rel] = n;
    }
  };
  for (const dir of ORDERING_DIRS) walk(dir);
  return hits;
}

const { writeOpsMissing, violations, fileOf } = await collect();
const orderingHits = scanOrdering();

let base = { writeOpsMissing: [], timestampSorts: {} };
try { base = JSON.parse(readFileSync(BASELINE, 'utf8')); } catch { /* none → everything new */ }

// `--update` only SHRINKS the baseline (the debt is fixed, never re-granted): an entry stays while it is still
// missing, an ordering count drops to what is there now; nothing is ever added. A new write-op declares its policy.
if (process.argv.includes('--update')) {
  const now = new Set(writeOpsMissing);
  const kept = (base.writeOpsMissing ?? []).filter((k) => now.has(k)).sort();
  const sorts = Object.fromEntries(Object.entries(base.timestampSorts ?? {})
    .map(([f, n]) => [f, Math.min(n, orderingHits[f] ?? 0)]).filter(([, n]) => n > 0));
  writeFileSync(BASELINE, JSON.stringify({ writeOpsMissing: kept, timestampSorts: sorts }, null, 2) + '\n');
  console.log(`✓ baseline shrunk: ${base.writeOpsMissing?.length ?? 0} → ${kept.length} grandfathered write-op(s), ${Object.keys(sorts).length} ordering site(s) (it never grows)`);
  process.exit(0);
}
const baseOps = new Set(base.writeOpsMissing ?? []);
const newMissing = writeOpsMissing.filter((k) => !baseOps.has(k));
const newOrdering = Object.entries(orderingHits).filter(([f, n]) => n > (base.timestampSorts?.[f] ?? 0));

let red = false;
if (violations.length) {
  red = true;
  console.error('✗ lint:resolution-policy — declaration disagreements (never baselined):');
  for (const v of violations) console.error(`   ${v}`);
}
if (newMissing.length) {
  red = true;
  console.error('✗ lint:resolution-policy — new write-op(s) with no declared resolution policy:');
  for (const k of newMissing) console.error(`   ${fileOf[k]}: ${k} writes with no declared resolution policy.\n     Fix: add \`resolves: [{ field, policy }]\` to the op (the baseline only shrinks: --update never adds to it).`);
}
if (newOrdering.length) {
  red = true;
  console.error('✗ lint:resolution-policy — new bespoke timestamp/wall-clock ordering (a SECOND ordering mechanism):');
  for (const [f, n] of newOrdering) console.error(`   ${f}: ${n} site(s), baseline allows ${base.timestampSorts?.[f] ?? 0} (scripts/resolution-policy-baseline.json).\n     Fix: order by the Lamport clock, not a wall clock.`);
}
// A baseline entry whose debt is paid (the op declares its policy now, or is gone; fewer ordering sites) is red too:
// left in, it would let the same op lose its declaration again unseen
const nowMissing = new Set(writeOpsMissing);
const paid = [...baseOps].filter((k) => !nowMissing.has(k));
const fewer = Object.entries(base.timestampSorts ?? {}).filter(([f, n]) => (orderingHits[f] ?? 0) < n);
if (paid.length || fewer.length) {
  red = true;
  console.error('✗ lint:resolution-policy — the baseline carries debt that is paid:');
  for (const k of paid) console.error(`   scripts/resolution-policy-baseline.json: ${k} is listed, but it declares its policy now or no manifest has it.`);
  for (const [f, n] of fewer) console.error(`   scripts/resolution-policy-baseline.json: ${f} allows ${n} ordering site(s), ${orderingHits[f] ?? 0} left.`);
  console.error('     Fix: run node scripts/lint-resolution-policy.mjs --update (it only removes).');
}
if (red) process.exit(1);

const carried = writeOpsMissing.length + Object.values(orderingHits).reduce((a, b) => a + b, 0);
if (carried) console.warn(`⚠ lint:resolution-policy — ${writeOpsMissing.length} undeclared write-op(s) + ${Object.values(orderingHits).reduce((a, b) => a + b, 0)} ordering site(s) carried (the declare-or-baseline debt).`);
console.log('✓ lint:resolution-policy: declarations agree, completeness held, no new second-ordering.');
