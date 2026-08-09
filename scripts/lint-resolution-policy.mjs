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

function appManifests() {
  const appsDir = path.join(ROOT, 'apps');
  const out = [];
  for (const app of readdirSync(appsDir)) {
    const rel = `apps/${app}/manifest.js`;
    try { readFileSync(path.join(ROOT, rel)); out.push({ app, rel }); } catch { /* no manifest */ }
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
  for (const { app, rel } of appManifests()) {
    let mod;
    try { mod = await load(rel); } catch (e) { violations.push(`${rel}: manifest failed to import (${e.message})`); continue; }
    const manifest = mod.default ?? Object.values(mod).find((v) => v && Array.isArray(v.operations));
    for (const op of manifest?.operations ?? []) {
      const key = `${app}:${op.id}`;
      const decls = Array.isArray(op.resolves) ? op.resolves : [];
      // Agreement: declared policies must be real; task claim-cluster fields must stay `claim`.
      const types = Array.isArray(op.appliesTo?.type) ? op.appliesTo.type : (op.appliesTo?.type ? [op.appliesTo.type] : []);
      for (const d of decls) {
        if (!d || !RESOLUTIONS.has(d.policy)) { violations.push(`${key}: declares unknown policy "${d?.policy}" for field "${d?.field}"`); continue; }
        if (types.includes('task') && CLAIM_FIELDS.includes(d.field) && d.policy !== 'claim') {
          violations.push(`${key}: declares (task, ${d.field}) → ${d.policy}, but the claim cluster is FIXED at claim (no downgrade)`);
        }
      }
      if (WRITE_VERBS.has(op.verb) && decls.length === 0) writeOpsMissing.push(key);
    }
  }
  return { writeOpsMissing: writeOpsMissing.sort(), violations };
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

const { writeOpsMissing, violations } = await collect();
const orderingHits = scanOrdering();

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify({ writeOpsMissing, timestampSorts: orderingHits }, null, 2) + '\n');
  console.log(`✓ baseline updated: ${writeOpsMissing.length} grandfathered write-op(s), ${Object.keys(orderingHits).length} ordering site(s)`);
  process.exit(0);
}

let base = { writeOpsMissing: [], timestampSorts: {} };
try { base = JSON.parse(readFileSync(BASELINE, 'utf8')); } catch { /* none → everything new */ }
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
  for (const k of newMissing) console.error(`   ${k}  (add \`resolves: [{ field, policy }]\` to the op, or --update with a reason)`);
}
if (newOrdering.length) {
  red = true;
  console.error('✗ lint:resolution-policy — new bespoke timestamp/wall-clock ordering (a SECOND ordering mechanism):');
  for (const [f, n] of newOrdering) console.error(`   ${f}: ${n} site(s), baseline allows ${base.timestampSorts?.[f] ?? 0} — order by the Lamport clock, not a wall clock.`);
}
if (red) process.exit(1);

const carried = writeOpsMissing.length + Object.values(orderingHits).reduce((a, b) => a + b, 0);
if (carried) console.warn(`⚠ lint:resolution-policy — ${writeOpsMissing.length} undeclared write-op(s) + ${Object.values(orderingHits).reduce((a, b) => a + b, 0)} ordering site(s) carried (the declare-or-baseline debt).`);
console.log('✓ lint:resolution-policy: declarations agree, completeness held, no new second-ordering.');
