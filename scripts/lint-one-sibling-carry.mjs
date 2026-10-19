#!/usr/bin/env node
/**
 * lint-one-sibling-carry — a person's own devices are reached by ONE carry (`apps/basis/src/v2/siblingCarry.js`).
 *
 * A module that loops over a self's siblings and sends to each by hand is a second, per-datatype sibling fan — the
 * build-up the carry was made to end (Frits 2026-09-13), and twice it crept back (profile facts, circle follow, found
 * 2026-10-19). Red when a `src/` file maps over a siblings list with a `sendToPeer(` / `sendToSibling(` in the same
 * callback. A catch-up ANSWER (one reply to the one device that asked) is a reply, not a fan, and does not loop.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = ['apps/basis/src'];
const ALLOWED = new Set(['apps/basis/src/v2/siblingCarry.js']);

/** The hand fans in one file's text: a `.map(` over a siblings-derived list whose callback sends. */
export function handFans(text) {
  const out = [];
  const lines = String(text).split('\n');
  const fromSiblings = new Set();
  lines.forEach((l, i) => {
    const m = l.match(/(\w+)\s*=\s*\(?\s*await\s+siblings\w*\(/);
    if (m) fromSiblings.add(m[1]);
    for (const v of fromSiblings) {
      if (new RegExp(`\\b${v}\\.(map|forEach)\\(|for\\s*\\(\\s*const\\s+\\w+\\s+of\\s+${v}\\b`).test(l)) {
        const window = lines.slice(i, i + 3).join('\n');
        if (/\bsend(ToPeer|ToSibling)\(/.test(window)) out.push(i + 1);
      }
    }
  });
  return out;
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith('.js')) acc.push(p);
  }
  return acc;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const hits = [];
  for (const dir of SCAN) {
    for (const f of walk(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, f);
      if (ALLOWED.has(rel)) continue;
      for (const line of handFans(readFileSync(f, 'utf8'))) hits.push(`${rel}:${line}`);
    }
  }
  if (hits.length) {
    console.error('lint-one-sibling-carry: a hand-rolled fan to the person\'s own devices — carry it through makeSiblingCarry (siblingCarry.js):');
    for (const h of hits) console.error(`  • ${h}`);
    process.exit(1);
  }
  console.log('lint-one-sibling-carry: every fan to the person\'s own devices goes through the one sibling carry');
}
