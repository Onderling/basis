#!/usr/bin/env node
/**
 * lint-scan-schemes — every code Basis makes goes through the ONE scan router (Frits 2026-11-20).
 *
 * The router (`apps/basis/src/v2/scanRoute.js`) holds `SCAN_SCHEMES`: each scheme Basis makes, and the kind its code is
 * routed to or why it is deliberately not. A screen's connect code and a bot-link offer were made by Basis and routed
 * nowhere: the scanner said "unknown" to the app's own codes. Two rules, over the shipped shell and shared files:
 *   1. a scheme Basis makes is in the table: a `const …SCHEME… = '<text>'` whose text is a scheme (`word://` or
 *      `onderling-word:`), and every `'onderling-<word>://'` literal, must be a key of `SCAN_SCHEMES`;
 *   2. a code is read by the router only: `classifyQrPayload(` is called in `scanRoute.js` and nowhere else in the apps
 *      (a scanner for one purpose calls `routeScan(text, { for })`), so no second classifier list grows beside it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['apps/basis/src', 'apps/basis/web', 'apps/basis/bin', 'apps/basis-mobile/src', 'apps/basis-mobile/App.js'];
export const ROUTER = 'apps/basis/src/v2/scanRoute.js';

function files(root) {
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

const SCHEME_CONST = /\bconst\s+\w*SCHEME\w*\s*=\s*(['"`])([^'"`]+)\1/g;
const ONDERLING_LITERAL = /(['"`])(onderling-[a-z]+:\/\/)\1/g;
const IS_SCHEME = (v) => /^[a-z][a-z0-9+.-]*:\/\/$/.test(v) || /^onderling-[a-z]+:$/.test(v);

/** The problems over `{rel: text}`, against the router's table. */
export function schemeProblems(texts, schemes) {
  const problems = [];
  for (const [rel, text] of Object.entries(texts)) {
    text.split('\n').forEach((l, i) => {
      if (/^\s*(\/\/|\*)/.test(l)) return;
      const said = new Set();   // one problem per scheme per line (a constant is also a literal)
      for (const m of l.matchAll(SCHEME_CONST)) {
        if (IS_SCHEME(m[2]) && !(m[2] in schemes) && !said.has(m[2]) && said.add(m[2])) problems.push(`${rel}:${i + 1} makes the scheme '${m[2]}', which the scan router does not know — add it to SCAN_SCHEMES (${ROUTER}): routed, or 'not: <why>'`);
      }
      for (const m of l.matchAll(ONDERLING_LITERAL)) {
        if (!(m[2] in schemes) && !said.has(m[2]) && said.add(m[2])) problems.push(`${rel}:${i + 1} names the scheme '${m[2]}', which the scan router does not know — add it to SCAN_SCHEMES (${ROUTER})`);
      }
      if (rel !== ROUTER && /\bclassifyQrPayload\s*\(/.test(l)) problems.push(`${rel}:${i + 1} classifies a code outside the scan router — call routeScan(text) (or routeScan(text, { for }) for a scanner with one purpose)`);
    });
  }
  return problems;
}

export async function check(root = ROOT) {
  const { SCAN_SCHEMES } = await import(pathToFileURL(path.join(root, ROUTER)).href);
  const texts = {};
  for (const rel of files(root)) texts[rel] = readFileSync(path.join(root, rel), 'utf8');
  return schemeProblems(texts, SCAN_SCHEMES);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = await check();
  if (problems.length) {
    console.error(`✖ scan-schemes: a code Basis makes goes around the one scan router:\n${problems.map((p) => `    ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log('✓ scan-schemes: every scheme Basis makes is in the router\'s table; codes are classified by the router only');
}
