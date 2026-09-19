#!/usr/bin/env node
/**
 * lint-shell-seams — web ≡ mobile ≡ box: every shell composes every seam (`shell-seams.mjs` declares them).
 * Red on a NEW gap; a baselined gap is reported and tolerated; a baselined gap that is closed is red too,
 * so the baseline never outlives the gap it describes.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findGaps, SEAMS, SHELLS } from './shell-seams.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { gaps, known, stale } = findGaps((rel) => readFileSync(path.join(ROOT, rel), 'utf8'));

for (const k of known) console.log(`  · known gap: ${k.shell} lacks ${k.seam} — closed by ${k.closes}`);
let red = 0;
if (gaps.length) {
  red += gaps.length;
  console.error(`\n✖ lint-shell-seams: ${gaps.length} seam(s) missing from a shell — the substrate exposes it, the shell does not compose it, and nothing else will fail:`);
  for (const g of gaps) console.error(`  ${g.shell}: ${g.seam} — ${g.why}\n    (looked in ${g.files.join(', ')})`);
  console.error(`\nFix: compose the seam the way the other shells do (grep the seam id's pattern in ${SHELLS.map((s) => s.name).join('/')}), or — only for a gap with a brief that closes it — add it to BASELINE in scripts/shell-seams.mjs.\n`);
}
if (stale.length) {
  red += stale.length;
  console.error(`\n✖ lint-shell-seams: ${stale.length} baseline entr${stale.length === 1 ? 'y is' : 'ies are'} stale — the seam is composed now; remove the entry:`);
  for (const s of stale) console.error(`  ${s.shell}: ${s.seam}`);
}
if (!red) console.log(`✓ lint-shell-seams: ${SEAMS.length} seams composed by ${SHELLS.map((s) => s.name).join(', ')}${known.length ? ` (${known.length} known gap(s) baselined)` : ''}`);
process.exit(red ? 1 : 0);
