// lint-api-docs — the API-appendix drift guard (source JSDoc ↔ docs/api/), in the `npm run guards` aggregate.
// (It ran only by hand as `api-fitness` until 2026-10-09 — outside the aggregate, so ten packages' docs/api went stale.)
//
// Two checks, both driven by scripts/api-appendix.mjs (the generator — single source of logic):
//
//   1. COVERAGE cannot regress: every public export of every wave-1 package must carry a JSDoc
//      block with a description, unless it is a recorded gap in scripts/api-doc-gaps.json.
//      A new undocumented public export FAILS here — document it or record it deliberately.
//   2. docs/api/ cannot drift: regenerating the appendix in memory must byte-match the files
//      on disk. Edit the source JSDoc and run `node scripts/api-appendix.mjs`, never the .md.
//
// README↔code existence is readme-fitness's job — not duplicated here.
// Run:  node scripts/lint-api-docs.mjs   (or `npm run api-fitness`; exit 1 on any failure)
// Note: importing @onderling/item-types prints one ajv strict-mode warning line — harmless.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateAll, coverage, ROOT } from './api-appendix.mjs';

const allowlist = JSON.parse(readFileSync(resolve(ROOT, 'scripts', 'api-doc-gaps.json'), 'utf8')).gaps;

const { models, files } = await generateAll();
let failures = 0;

// ── 1. JSDoc coverage of the public surface ─────────────────────────────────
for (const model of models) {
  const allowed = new Set(allowlist[model.name] ?? []);
  const { total, documented, gaps } = coverage(model);
  const unrecorded = gaps.filter((g) => !allowed.has(g));
  const stale = [...allowed].filter((a) => !gaps.includes(a));
  if (unrecorded.length) {
    failures++;
    console.log(`✗ ${model.name}: ${unrecorded.length} public export(s) lack a JSDoc block (not recorded in api-doc-gaps.json):`);
    for (const g of unrecorded) console.log(`    ${g}`);
  } else {
    console.log(`✓ ${model.name} — ${documented}/${total} documented${allowed.size ? ` (${allowed.size} recorded gap(s))` : ''}`);
  }
  if (stale.length) {
    failures++;
    console.log(`✗ ${model.name}: stale allowlist entr${stale.length === 1 ? 'y' : 'ies'} (now documented — remove from api-doc-gaps.json): ${stale.join(', ')}`);
  }
}

// ── 2. docs/api/ must equal a fresh regeneration ────────────────────────────
let drift = 0;
for (const [rel, content] of files) {
  const onDisk = resolve(ROOT, 'docs', 'api', rel);
  if (!existsSync(onDisk)) { console.log(`✗ docs/api/${rel}: MISSING — run node scripts/api-appendix.mjs`); drift++; continue; }
  if (readFileSync(onDisk, 'utf8') !== content) {
    console.log(`✗ docs/api/${rel}: drifts from the source — run node scripts/api-appendix.mjs`);
    drift++;
  }
}
if (drift) failures++;
else console.log(`✓ docs/api/ matches a fresh regeneration (${files.size} files)`);

if (failures) { console.log('\napi-fitness FAILED.'); process.exit(1); }
console.log('\napi-fitness green: coverage holds and docs/api/ matches the source.');
