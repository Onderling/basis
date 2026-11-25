#!/usr/bin/env node
/**
 * lint-store-reads — a store never takes what it could not read for "nothing" and saves over it.
 *
 * The shape behind most of the silent losses found in November 2026: a store read a stored value, parsed it ITSELF,
 * turned a parse failure into an empty value, and the next save wrote that empty value over the old bytes (a newer
 * build's shape, a torn write — gone). The store kinds now hold the rule in one place each:
 *   • a key's JSON value is read through `getJson` (`sealedKeyValue`, `plainKeyValue`, `jsonKv` in
 *     apps/basis/src/v2/localStoreSeal.js): a value that does not parse is kept, every write to it refused, and said;
 *   • a store's Map snapshot is read through `mapSnapshotGate` (@onderling/local-store): stamped, and never saved over
 *     when it could not be read.
 * Two text rules hold them, over the shells and the shared code:
 *   1. a `getItem(` with a `JSON.parse(` within the next few lines is red — on raw storage AND on a sealed store (it
 *      still offers `getItem`): read the value through `getJson`;
 *   2. a persist adapter class (`class …Persist`) that does not use `mapSnapshotGate` is red.
 * A known exception goes in scripts/store-reads-baseline.json with a note that starts with one of:
 *   • "not a store:"   — the parsed text is not a stored value (a URL query, a clipboard, a network answer);
 *   • "never saved over:" — the value is only read, or what does not parse is kept and handed on (said where);
 *   • "harmless loss:" — a value whose loss costs nothing (a cache rebuilt elsewhere, a remembered "no" asked again,
 *                        a view the alpha paints the same either way): the `overwritable` of sealedKeyValue, said why;
 *   • "debt:"          — a store that still parses by hand: a finding, to be moved onto getJson.
 * The baseline is edited by hand; a file above its count, or a new file, is red; a stale entry is red too.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['apps/basis/web', 'apps/basis/src', 'apps/basis/bin', 'apps/basis-mobile/src', 'apps/basis-mobile/App.js',
  'apps/pinboard/src', 'apps/tasks-v0/src'];
const THE_WRAPPERS = new Set(['apps/basis/src/v2/localStoreSeal.js']);
const BASELINE = path.join(ROOT, 'scripts/store-reads-baseline.json');
const WINDOW = 4;   // lines after a getItem( in which a JSON.parse( counts as "parsed by hand"
const HEADS = ['not a store:', 'never saved over:', 'harmless loss:', 'debt:'];

/** The shipped files under the roots (no tests). */
export function storeFiles(root = ROOT) {
  const out = [];
  const walk = (rel) => {
    let st; try { st = statSync(path.join(root, rel)); } catch { return; }
    if (st.isFile()) { if (/\.(m?js|jsx)$/.test(rel) && !/\.test\.|\.spec\./.test(rel)) out.push(rel); return; }
    for (const n of readdirSync(path.join(root, rel))) {
      if (n === 'node_modules' || n.startsWith('.') || n === 'test' || n === 'dist') continue;
      walk(`${rel}/${n}`);
    }
  };
  for (const r of ROOTS) walk(r);
  return out;
}

/** What one file does wrong: `{ handParsed: number, gatelessPersist: string[] }`. */
export function findingsIn(text) {
  const lines = text.split('\n');
  let handParsed = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (!/\bgetItem\s*\??\.?\s*\(/.test(lines[i])) continue;
    if (/^\s*(\/\/|\*)/.test(lines[i])) continue;   // a comment
    for (let j = i; j < Math.min(lines.length, i + WINDOW); j += 1) {
      if (/JSON\.parse\s*\(/.test(lines[j]) && !/^\s*(\/\/|\*)/.test(lines[j])) { handParsed += 1; break; }
    }
  }
  const gatelessPersist = [];
  if (!/mapSnapshotGate/.test(text)) {
    for (const m of text.matchAll(/class\s+(\w*Persist)\b/g)) gatelessPersist.push(m[1]);
  }
  return { handParsed, gatelessPersist };
}

export function check(root = ROOT, baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))) {
  const problems = [];
  const seen = new Set();
  for (const rel of storeFiles(root)) {
    if (THE_WRAPPERS.has(rel)) continue;
    const { handParsed, gatelessPersist } = findingsIn(readFileSync(path.join(root, rel), 'utf8'));
    for (const c of gatelessPersist) problems.push(`${rel}: persist adapter ${c} does not read through mapSnapshotGate`);
    if (!handParsed) continue;
    seen.add(rel);
    const entry = baseline[rel];
    if (!entry) { problems.push(`${rel}: ${handParsed} stored value(s) parsed by hand (getItem + JSON.parse) — read through getJson, or declare it with a reason`); continue; }
    if (!HEADS.some((h) => String(entry.note ?? '').startsWith(h))) problems.push(`${rel}: baseline note must start with one of: ${HEADS.join(' · ')}`);
    if (handParsed > entry.count) problems.push(`${rel}: ${handParsed} parsed by hand, baseline allows ${entry.count}`);
  }
  for (const rel of Object.keys(baseline)) if (!seen.has(rel)) problems.push(`${rel}: stale baseline entry (nothing parsed by hand there any more) — remove it`);
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = check();
  if (problems.length) {
    console.error(`✖ store-reads: a store parses what it read by hand, or a persist adapter skips the gate:\n${problems.map((p) => `    ${p}`).join('\n')}`);
    process.exit(1);
  }
  const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
  console.log(`✓ store-reads: every stored JSON value through getJson, every persist adapter through the gate; ${Object.keys(base).length} declared exception(s)`);
}
