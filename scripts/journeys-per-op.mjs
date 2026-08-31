#!/usr/bin/env node
/**
 * journeys-per-op — how much of the declared surface has a STORY.
 *
 * The rule this measures (Frits, 2026-08-31): *"create at least one user journey for each opid to test
 * it. If we cant find any story for the op that makes sense, then its probably time to remove it."* A
 * declared op is a promise that the app offers something; a journey is the proof that a person can take
 * it up. Where no story can be written, the promise was the only thing there.
 *
 *   node scripts/journeys-per-op.mjs            the summary + what has no story at all
 *   node scripts/journeys-per-op.mjs --full     every op, grouped by how well it is covered
 *
 * ── Three numbers, and they say different things ────────────────────────────────────────────────────
 * A single "tested?" boolean would flatter the truth here, so the report keeps the tiers apart:
 *
 *   WAIST    the op is driven through `callSkill('app','op')` by some test. This is the only kind of
 *            coverage that proves a person's ROUTE works, because it is the route.
 *   JOURNEY  …and by a file with "journey" in its name. This is the number the rule is about.
 *   NAMED    the op id merely appears somewhere in a test — usually a handler-level unit test calling
 *            the function directly. That proves the code works, not that anyone can reach it.
 *            `basis:me` was the type specimen: tested on both shells, reachable by nobody for months.
 *   NOWHERE  the id appears in no test file at all. First candidates for the second half of the rule.
 *
 * Deliberately NOT a guard. Per `lint-hardcoded-strings`'s doctrine, a check that lands with a large
 * baseline teaches people to grow the baseline; this reports a number that should move, and becomes a
 * guard the day the number is small enough to hold at zero.
 *
 * ⚠ Literal call sites only (`callSkill('app','op')` and the journeys' own `call(node,'op')` helper). A
 * computed op id is unknowable statically, so the WAIST and JOURNEY tiers UNDER-report by design —
 * better than a number that quietly counts a dispatcher loop as coverage of everything.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { opsIn, walk } from './journeys-reach-users.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const full = process.argv.includes('--full');

/** Every app whose manifest declares ops, and the export that holds it. */
const MANIFESTS = [
  ['apps/basis/manifest.js',     'basisManifest'],
  ['apps/household/manifest.js', 'householdManifest'],
  ['apps/stoop/manifest.js',     'stoopManifest'],
  ['apps/folio/manifest.js',     'folioManifest'],
  ['apps/calendar/manifest.js',  'calendarManifest'],
  ['apps/agents/manifest.js',    'agentsManifest'],
  ['apps/params/manifest.js',    'paramsManifest'],
];

/** Where tests live. A journey is any file under these with "journey" in its path. */
const TEST_ROOTS = [
  'apps/basis/test', 'apps/basis/test-browser', 'apps/basis-mobile/test',
  'apps/e2e-journeys', 'apps/sdk-journeys',
  'apps/household/test', 'apps/stoop/test', 'apps/folio/test',
  'apps/calendar/test', 'apps/agents/test', 'apps/params/test',
];

async function declaredOps() {
  const out = new Map();                       // "app:op" → op id
  for (const [rel, name] of MANIFESTS) {
    let mod;
    try { mod = await import(pathToFileURL(path.join(ROOT, rel)).href); } catch { continue; }
    const m = mod[name] ?? Object.values(mod)[0];
    const app = m?.appId ?? m?.app ?? rel.split('/')[1];
    for (const op of (m?.operations ?? [])) out.set(`${app}:${op.id}`, op.id);
  }
  return out;
}

function scanTests(declared) {
  const waist = new Set(); const journey = new Set(); const named = new Set();
  for (const dir of TEST_ROOTS) {
    for (const file of walk(path.join(ROOT, dir))) {
      let src; try { src = readFileSync(file, 'utf8'); } catch { continue; }
      const isJourney = /journey/i.test(file);
      for (const key of opsIn(src)) { waist.add(key); if (isJourney) journey.add(key); }
      // the journeys' own `call(node, 'op')` helper — app-less, so credit every app declaring that id
      for (const m of src.matchAll(/\bcall\(\s*\w+\s*,\s*['"]([\w.-]+)['"]/g)) {
        for (const [key, id] of declared) if (id === m[1]) { waist.add(key); if (isJourney) journey.add(key); }
      }
      for (const [key, id] of declared) {
        if (named.has(key)) continue;
        if (new RegExp(`['"\`]${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`).test(src)) named.add(key);
      }
    }
  }
  return { waist, journey, named };
}

const declared = await declaredOps();
const { waist, journey, named } = scanTests(declared);
const keys = [...declared.keys()];
const pct = (n) => `${String(n).padStart(3)}  (${String(Math.round((n / keys.length) * 100)).padStart(2)}%)`;

console.log('\n  journeys per op — how much of the declared surface has a story\n');
console.log(`  declared ops .......................... ${String(keys.length).padStart(3)}`);
console.log(`  driven through the WAIST by a test .... ${pct(keys.filter((k) => waist.has(k)).length)}`);
console.log(`  driven by a JOURNEY ................... ${pct(keys.filter((k) => journey.has(k)).length)}   ← the rule`);
console.log(`  merely NAMED in some test ............. ${pct(keys.filter((k) => named.has(k)).length)}`);

const nowhere = keys.filter((k) => !named.has(k)).sort();
console.log(`  named NOWHERE ......................... ${pct(nowhere.length)}   ← no story, and no test either\n`);

const group = (list) => {
  const by = {};
  for (const k of list) { const [a, o] = k.split(':'); (by[a] ??= []).push(o); }
  return Object.entries(by).sort((x, y) => y[1].length - x[1].length);
};
for (const [app, ids] of group(nowhere)) console.log(`    ${app} (${ids.length}): ${ids.join(', ')}`);

if (full) {
  const storyless = keys.filter((k) => !journey.has(k)).sort();
  console.log(`\n  ── no JOURNEY (${storyless.length}) — the working list for the rule ──`);
  for (const [app, ids] of group(storyless)) console.log(`    ${app} (${ids.length}): ${ids.join(', ')}`);
}
console.log('');
