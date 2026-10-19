#!/usr/bin/env node
/**
 * lint-platform-exceptions-declared — a surface one shell paints on purpose and the other does not is DECLARED in
 * `docs/conventions/web-mobile-exceptions.md` (its "Current listed exceptions" table), naming its id in backticks.
 *
 * The tags that make a surface one-platform are code: a manifest entry's `platforms: […]` that does not list both
 * shells, and the tabs `alphaSurface.js` paints only where there is a mesh (`MESH_TABS`). Both had shipped with no row
 * (found by the buttons assessment, 2026-10-19), so nothing told a reader the difference was meant. Red when one has
 * no row.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = 'docs/conventions/web-mobile-exceptions.md';
const ALPHA = 'apps/basis/src/v2/alphaSurface.js';

/** The one-platform ids a manifest source declares: an entry whose `platforms` names one shell, not both. */
export function onePlatformIds(text) {
  const out = [];
  for (const m of String(text).matchAll(/id:\s*'([^']+)'[^\n]*?platforms:\s*\[([^\]]*)\]/g)) {
    const shells = m[2].match(/'([^']+)'/g)?.map((x) => x.slice(1, -1)) ?? [];
    if (!(shells.includes('web') && shells.includes('mobile'))) out.push(m[1]);
  }
  return out;
}

/** The mesh-only tab ids `alphaSurface.js` names. */
export function meshTabIds(text) {
  const m = String(text).match(/MESH_TABS\s*=\s*Object\.freeze\(\[([^\]]*)\]\)/);
  return m ? (m[1].match(/'([^']+)'/g) ?? []).map((x) => x.slice(1, -1)) : [];
}

/** The ids the exceptions table declares: backticked words in its rows. */
export function declaredIds(doc) {
  const at = String(doc).indexOf('## Current listed exceptions');
  const table = at > -1 ? String(doc).slice(at) : '';
  return new Set([...table.matchAll(/^\|.*$/gm)].flatMap((row) => [...row[0].matchAll(/`([^`]+)`/g)].map((x) => x[1])));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const sources = readdirSync(path.join(ROOT, 'apps')).map((a) => path.join(ROOT, 'apps', a, 'manifest.js')).filter(existsSync);
  const ids = [...new Set([
    ...sources.flatMap((f) => onePlatformIds(readFileSync(f, 'utf8'))),
    ...meshTabIds(readFileSync(path.join(ROOT, ALPHA), 'utf8')),
  ])];
  const declared = declaredIds(readFileSync(path.join(ROOT, DOC), 'utf8'));
  const missing = ids.filter((id) => !declared.has(id));
  if (missing.length) {
    console.error(`lint-platform-exceptions-declared: one-platform surfaces with no row in ${DOC}:`);
    for (const id of missing) console.error(`  • \`${id}\` — add a row naming it in backticks (what · platform · why · since · exit path)`);
    process.exit(1);
  }
  console.log(`lint-platform-exceptions-declared: every one-platform surface (${ids.length}) has its row`);
}
