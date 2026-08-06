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
// Collect hits per FILE (not file:line). The baseline is keyed on `{ file: count }`, so a constructor moving
// to a new line (an edit above it) does NOT re-trip the guard — only a genuinely NEW constructor (the count
// going UP, or a not-yet-baselined file) does. The old file:line baseline was brittle: it re-tripped on any
// line drift above a known site (2026-08-06).
const sitesByFile = {};   // file -> [{ lineNo, text }]
for (const f of files) {
  if (ALLOWED.some((re) => re.test(f))) continue;
  let src; try { src = readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
  src.split('\n').forEach((line, i) => {
    if (/new\s+CircleItemStore\s*\(/.test(line)) (sitesByFile[f] ??= []).push({ lineNo: i + 1, text: line.trim() });
  });
}
const counts = Object.fromEntries(Object.entries(sitesByFile).map(([f, s]) => [f, s.length]));
const total = Object.values(counts).reduce((a, b) => a + b, 0);

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify({ counts }, null, 2) + '\n');
  console.log(`✓ baseline updated: ${Object.keys(counts).length} file(s), ${total} constructor site(s)`); process.exit(0);
}
let base = {};
try { base = JSON.parse(readFileSync(BASELINE, 'utf8')).counts ?? {}; } catch { /* none */ }
const offenders = Object.entries(counts).filter(([f, n]) => n > (base[f] ?? 0));
if (offenders.length) {
  console.error('✗ lint:circle-store-door — new CircleItemStore constructor(s) outside the registry:');
  for (const [f, n] of offenders) {
    console.error(`   ${f}: ${n} constructor(s), baseline allows ${base[f] ?? 0}`);
    for (const s of sitesByFile[f]) console.error(`     - :${s.lineNo}  ${s.text}`);
  }
  console.error('\nGet the store from the registry (`createCircleStores`) so it is WIRED — publish + inbound —\nby construction. A hand-made store is how tasks went missing (one-store-per-circle).');
  process.exit(1);
}
if (total) console.warn(`⚠ lint:circle-store-door — ${total} known site(s) carried (the adopt-or-registry debt).`);
console.log('✓ lint:circle-store-door: no new stray stores.');
