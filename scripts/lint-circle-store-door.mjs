#!/usr/bin/env node
/**
 * lint-circle-store-door (G-C1) — one store per circle, structurally: `new CircleItemStore` is legal only
 * inside the store registry (and item-store's own internals). Two stores for one circle is how the task
 * fan-out bug happened — the write and the publisher looked at different objects, and NOTHING failed.
 * This makes the unsynced store unobtainable rather than merely wrong.
 *
 *   node scripts/lint-circle-store-door.mjs [--update]
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASELINE = path.join(ROOT, 'scripts', 'circle-store-door-baseline.json');
const ALLOWED = [
  /^packages\/item-store\/src\//,                       // the registry + the store's own package
  /(^|\/)(test|tests|e2e|test-browser)\//, /\.(test|spec)\.[cm]?js$/,
];
const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n')
  .filter((f) => /^(apps|packages)\/.*\.[cm]?js$/.test(f) && !f.includes('/node_modules/'));
const hits = [];
for (const f of files) {
  if (ALLOWED.some((re) => re.test(f))) continue;
  let src; try { src = readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
  src.split('\n').forEach((line, i) => {
    if (/new\s+CircleItemStore\s*\(/.test(line)) hits.push(`${f}:${i + 1}`);
  });
}
if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify({ sites: hits.sort() }, null, 2) + '\n');
  console.log(`✓ baseline updated: ${hits.length} known constructor site(s)`); process.exit(0);
}
let known = new Set();
try { known = new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).sites ?? []); } catch { /* none */ }
const fresh = hits.filter((h) => !known.has(h));
if (fresh.length) {
  console.error(`✗ lint:circle-store-door — ${fresh.length} NEW CircleItemStore constructor(s) outside the registry:`);
  for (const h of fresh) console.error('   - ' + h);
  console.error('\nGet the store from the registry (`createCircleStores`) so it is WIRED — publish + inbound —\nby construction. A hand-made store is how tasks went missing (the homes plan, G-C1).');
  process.exit(1);
}
if (hits.length) console.warn(`⚠ lint:circle-store-door — ${hits.length} known site(s) carried (the adopt-or-registry debt).`);
console.log('✓ lint:circle-store-door: no new stray stores.');
