#!/usr/bin/env node
/**
 * A PHONE SHEET IS CAPPED IN WINDOW PIXELS, NEVER A PERCENTAGE. A card capped with `maxHeight: '85%'` did not bound it
 * on Android 16 (Detox on a 2,400 px screen: the Customise sheet's scroll measured 3,894 px, never scrolled, and its
 * last button was off-screen). Every sheet takes its cap from `useSheetCap()` in
 * `apps/basis-mobile/src/screens/v2/sheetCap.js` and lets its scroll shrink with `SHEET_SCROLL`. No baseline: none
 * are left.
 *
 *   node scripts/lint-sheet-cap.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCOPE = 'apps/basis-mobile/src';

/** The 1-based line numbers of a percentage `maxHeight` in one source text; comment lines are skipped. */
export function percentCaps(src) {
  const out = [];
  String(src).split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    if (/^\s*(\*|\/\*)/.test(code)) return;
    if (/maxHeight\s*:\s*(['"])\d+(\.\d+)?%\1/.test(code)) out.push(i + 1);
  });
  return out;
}

function* jsFiles(dir) {
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== 'node_modules') yield* jsFiles(p); }
    else if (/\.(js|jsx|ts|tsx)$/.test(n) && !/\.test\./.test(n)) yield p;
  }
}

/** Every hit in the phone app: `['path:line', ...]`. */
export function currentHits(root = ROOT) {
  const hits = [];
  for (const f of jsFiles(join(root, SCOPE))) {
    for (const ln of percentCaps(readFileSync(f, 'utf8'))) hits.push(`${relative(root, f)}:${ln}`);
  }
  return hits;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const hits = currentHits();
  if (hits.length) {
    console.error('✗ a percentage maxHeight on the phone — it does not bound a sheet on Android; use useSheetCap() from screens/v2/sheetCap.js:');
    for (const h of hits) console.error(`   ${h}`);
    process.exit(1);
  }
  console.log('✓ phone sheets: no percentage maxHeight');
}
