#!/usr/bin/env node
/**
 * lint-one-scan-loop — a scanned text is classified by ONE first-match loop (`packages/qr`, `classifyQrPayload`).
 *
 * The web router (`routeScan`) and the phone's scanner each carried the same few lines that walk a list of classifiers
 * and take the first that answers; the two drift apart one fix at a time. Red when a `src/` file outside the qr
 * package loops over classifiers calling `.classify(`, or when the qr package imports anything of React Native (it is
 * pure, so the web router can use it).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = 'packages/qr/src';

/** The first-match loops in one file's text: a `for (… of …)` whose next lines call `.classify(`. */
export function firstMatchLoops(text) {
  const lines = String(text).split('\n');
  const out = [];
  lines.forEach((l, i) => {
    if (/for\s*\(\s*const\s+\w+\s+of\s+[\w.]+\s*\)/.test(l) && /\.classify\(/.test(lines.slice(i, i + 4).join('\n'))) out.push(i + 1);
  });
  return out;
}

/** An import of React Native in one file's text. */
export function importsReactNative(text) {
  return /from\s+['"](react-native|@onderling\/react-native|expo-[\w-]+)(\/[^'"]*)?['"]|require\(\s*['"]react-native/.test(String(text));
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(m?js|jsx)$/.test(p)) acc.push(p);
  }
  return acc;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const hits = [];
  const roots = ['apps', 'packages'].flatMap((top) => readdirSync(path.join(ROOT, top)).map((d) => path.join(ROOT, top, d, 'src')));
  for (const dir of roots) {
    for (const f of walk(dir)) {
      const rel = path.relative(ROOT, f);
      const text = readFileSync(f, 'utf8');
      if (rel.startsWith(HOME + '/')) { if (importsReactNative(text)) hits.push(`${rel}: the qr package imports React Native`); continue; }
      for (const line of firstMatchLoops(text)) hits.push(`${rel}:${line}: a first-match loop over classifiers — call classifyQrPayload (@onderling/qr)`);
    }
  }
  if (!existsSync(path.join(ROOT, HOME))) hits.push(`${HOME}: missing — the one loop has no home`);
  if (hits.length) {
    console.error('lint-one-scan-loop:');
    for (const h of hits) console.error(`  • ${h}`);
    process.exit(1);
  }
  console.log('lint-one-scan-loop: one first-match loop (@onderling/qr), and it is pure');
}
