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
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineAt, whereIn } from './guard-where.mjs';
import { generateAll, coverage, ROOT } from './api-appendix.mjs';

/** Each undocumented export as `file:line: name` at its declaration, then what to do instead. */
export function gapLines(model, unrecorded, read = (f) => readFileSync(f, 'utf8'), root = ROOT) {
  const out = [];
  for (const g of unrecorded) {
    const rec = model.symbols.get(g);
    let at = model.name;
    if (rec?.file) {
      let line = 1;
      try { if (rec.declOffset != null) line = lineAt(read(rec.file), rec.declOffset); } catch { /* unreadable: the file's top */ }
      at = `${relative(root, rec.file)}:${line}`;
    }
    out.push(`    ${at}: ${g}`);
  }
  out.push(`    Fix: put a /** … */ block with a description right above each declaration; only for a deliberate gap, add the name under "${model.name}" in scripts/api-doc-gaps.json.`);
  return out;
}

/** The 1-based first line where two texts differ (a missing line counts). */
export function firstDiffLine(a, b) {
  const x = String(a).split('\n'), y = String(b).split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return i + 1;
  return 1;
}

/** A docs/api file that differs from a fresh regeneration: where it first differs, and what to do instead. */
export function driftMessage(rel, onDisk, fresh) {
  return `✗ docs/api/${rel}:${firstDiffLine(onDisk, fresh)}: drifts from the source JSDoc (first differing line).\n    Fix: edit the JSDoc in the source, never the .md, and run node scripts/api-appendix.mjs.`;
}

async function main() {
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
      for (const l of gapLines(model, unrecorded)) console.log(l);
    } else {
      console.log(`✓ ${model.name} — ${documented}/${total} documented${allowed.size ? ` (${allowed.size} recorded gap(s))` : ''}`);
    }
    if (stale.length) {
      failures++;
      console.log(`✗ ${model.name}: stale allowlist entr${stale.length === 1 ? 'y' : 'ies'} (now documented):`);
      for (const a of stale) console.log(`    ${whereIn('scripts/api-doc-gaps.json', `"${a}"`)}: ${a}`);
      console.log('    Fix: remove each from scripts/api-doc-gaps.json.');
    }
  }

  // ── 2. docs/api/ must equal a fresh regeneration ────────────────────────────
  let drift = 0;
  for (const [rel, content] of files) {
    const onDisk = resolve(ROOT, 'docs', 'api', rel);
    if (!existsSync(onDisk)) { console.log(`✗ docs/api/${rel}:1: MISSING.\n    Fix: run node scripts/api-appendix.mjs and commit the file.`); drift++; continue; }
    const have = readFileSync(onDisk, 'utf8');
    if (have !== content) {
      console.log(driftMessage(rel, have, content));
      drift++;
    }
  }
  if (drift) failures++;
  else console.log(`✓ docs/api/ matches a fresh regeneration (${files.size} files)`);

  if (failures) { console.log('\napi-fitness FAILED.'); process.exit(1); }
  console.log('\napi-fitness green: coverage holds and docs/api/ matches the source.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
