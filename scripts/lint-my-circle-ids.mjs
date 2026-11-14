#!/usr/bin/env node
/**
 * lint-my-circle-ids — the circles this device is in are read through ONE reader (`apps/basis/src/v2/myCircleIds.js`).
 *
 * pinboard's `listMyCircles` answers plain ids. Five places mapped that answer as objects (`(b) => b?.groupId ?? b?.id`),
 * which turned every id into nothing: the pod read-back on coming back to the front, its boot and reconnect kicks and
 * the phone's background slot read no circle on either shell (found 2026-11-14). Red when shared code or a shell maps
 * a list with that object-only pattern; read the op through `myCircleIds(callSkill)` / `circleIdsFrom(result)`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = ['apps/basis/src', 'apps/basis/web', 'apps/basis/bin', 'apps/basis-mobile/src', 'apps/basis-mobile/App.js'];

/** The lines (1-based) of one file's text that map a list as objects only: `.map((x) => x?.groupId ?? x?.id)`. */
export function objectOnlyMaps(text) {
  const out = [];
  String(text).split('\n').forEach((l, i) => {
    const m = l.match(/\.map\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*(\w+)\?\.groupId\s*\?\?\s*(\w+)\?\.id\s*\)/);
    if (m && m[1] === m[2] && m[2] === m[3]) out.push(i + 1);
  });
  return out;
}

function walk(p, acc = []) {
  if (statSync(p).isDirectory()) { for (const name of readdirSync(p)) { if (name !== 'node_modules') walk(path.join(p, name), acc); } }
  else if (/\.(m?js|jsx)$/.test(p)) acc.push(p);
  return acc;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const hits = [];
  for (const entry of SCAN) {
    let files = [];
    try { files = walk(path.join(ROOT, entry)); } catch { files = []; }
    for (const f of files) {
      for (const line of objectOnlyMaps(readFileSync(f, 'utf8'))) hits.push(`${path.relative(ROOT, f)}:${line}`);
    }
  }
  if (hits.length) {
    console.error('lint-my-circle-ids: a list mapped as objects only (listMyCircles answers plain ids) — read it through myCircleIds / circleIdsFrom (apps/basis/src/v2/myCircleIds.js):');
    for (const h of hits) console.error(`  • ${h}`);
    process.exit(1);
  }
  console.log('lint-my-circle-ids: no list is mapped as objects only; the circles are read through one reader');
}
