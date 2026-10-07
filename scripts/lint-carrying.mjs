#!/usr/bin/env node
/**
 * lint-carrying — the carrying index held to the code (`carrying.mjs`): every server route and store is declared with
 * its row; every row's "used today by" file exists and reaches the mechanism. Inert rows are counted, not refused.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCarrying } from './carrying.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n')
  .filter((f) => /\.m?js$/.test(f) && !/(^|\/)(test|tests|test-browser|e2e|e2e-journeys|fixtures|node_modules|_archive)\//.test(f) && !/\.test\.m?js$/.test(f));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const r = checkCarrying({ read, files });

let red = 0;
if (r.unlisted.length) {
  red += r.unlisted.length;
  console.error(`\n✖ lint-carrying: ${r.unlisted.length} server route(s)/store(s) not in the carrying index — open docs/conventions/carrying-index.md (the neighbour is usually there), then declare it in scripts/carrying.mjs CARRIERS:`);
  for (const u of r.unlisted) console.error(`  ${u.kind} ${u.id} (${u.file})`);
}
if (r.unknownRow.length) {
  red += r.unknownRow.length;
  console.error(`\n✖ lint-carrying: ${r.unknownRow.length} declared carrier(s) name a row the index does not have:`);
  for (const u of r.unknownRow) console.error(`  ${u.id} → "${u.row}"`);
}
if (r.unreached.length) {
  red += r.unreached.length;
  console.error(`\n✖ lint-carrying: ${r.unreached.length} row(s) say a file uses them that does not (DONE = reached; move the row to the inert table, or name the real consumer):`);
  for (const u of r.unreached) console.error(`  "${u.row}" — ${u.consumer ?? ''} ${u.why}`);
}
if (!red) console.log(`✓ lint-carrying: ${r.rows} rows, every server route and store declared, every consumer reaches its row · ${r.inert} inert (kept; see the index)`);
process.exit(red ? 1 : 0);
