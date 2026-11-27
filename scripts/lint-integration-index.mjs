#!/usr/bin/env node
/**
 * lint-integration-index.mjs — the integration index stays in sync with reality.
 *
 * A `*.css.test.js` that exists on disk but is missing from `integration-index.mjs` is a gated integration
 * test that the runner (`npm run test:integration`) never triggers — it silently rots. An index row whose
 * file is gone is a stale pointer. Either is drift; both fail here. Auto-run by `npm run guards`.
 */
import { INTEGRATION_TESTS, discoverCssTests } from './integration-index.mjs';
import { whereIn } from './guard-where.mjs';

const INDEX = 'scripts/integration-index.mjs';
const rowAt = (f) => whereIn(INDEX, `'${f}'`);

const indexed = new Set(INTEGRATION_TESTS.map((t) => t.file));
const disk = discoverCssTests();

const missing = disk.filter((f) => !indexed.has(f));                 // on disk, absent from the index
const stale = [...indexed].filter((f) => !disk.includes(f));         // in the index, no file on disk
const undescribed = INTEGRATION_TESTS.filter((t) => !t.proves || !t.proves.trim()).map((t) => t.file);

let red = false;
if (missing.length) {
  red = true;
  console.error(`✗ integration tests NOT in the index (the runner never triggers them):\n  ${missing.map((f) => `${f}:1`).join('\n  ')}\n  Fix: add a row { file, proves } for each to ${INDEX}.`);
}
if (stale.length) {
  red = true;
  console.error(`✗ index rows with no matching file:\n  ${stale.map((f) => `${rowAt(f)}: ${f}`).join('\n  ')}\n  Fix: remove each row from ${INDEX}, or point it at where the test lives now.`);
}
if (undescribed.length) {
  red = true;
  console.error(`✗ index rows missing a 'proves' line:\n  ${undescribed.map((f) => `${rowAt(f)}: ${f}`).join('\n  ')}\n  Fix: give each row a proves: '<what the test proves, in one sentence>'.`);
}
if (red) process.exit(1);

console.log(`✓ integration-index: ${INTEGRATION_TESTS.length} integration tests indexed, in sync with disk.`);
