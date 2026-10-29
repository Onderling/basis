#!/usr/bin/env node
/**
 * ONE WORD: "kring". A circle is a "kring" in every Dutch string the person reads; "cirkel" crept back beside it on
 * web (the 2026-10-22 screen walk) and was taken out. This fails when "cirkel" appears again in a shell's source or a
 * locale, so the word goes through the one locale key instead.
 *
 * Allowed: a search synonym (the help card's tags, so someone who types "cirkel" still finds the kring card) — named
 * below with its reason, which is the sentence review should read.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCAN = ['apps/basis/src', 'apps/basis/web', 'apps/basis-mobile/src', 'packages'];
const ALLOWED = Object.freeze({
  'apps/basis/src/v2/help/kaartjes.js': {
    line: /^\s*"cirkel",\s*$/,
    why: 'a search tag of the kring card: typing "cirkel" finds it; never shown as a label',
  },
});

const files = execSync(`git ls-files ${SCAN.join(' ')}`, { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter((f) => /\.(js|mjs|jsx|json|html)$/.test(f) && !/(^|\/)(test|test-browser|__tests__)\//.test(f));
const problems = [];
for (const f of files) {
  let src;
  try { src = readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
  if (!/cirkel/i.test(src)) continue;
  src.split('\n').forEach((line, i) => {
    if (!/\bcirkel/i.test(line)) return;
    if (ALLOWED[f]?.line.test(line)) return;
    problems.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
}
for (const [f, { line }] of Object.entries(ALLOWED)) {
  let src = '';
  try { src = readFileSync(path.join(ROOT, f), 'utf8'); } catch { /* reported below */ }
  if (!src.split('\n').some((l) => line.test(l))) problems.push(`ALLOWED names ${f}, which no longer has that line — remove the allowance.`);
}
if (problems.length) {
  console.error(`✖ lint-kring-not-cirkel — "cirkel" where the word is "kring" (use the locale key):\n${problems.map((p) => `  • ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`✓ lint-kring-not-cirkel: no "cirkel" in ${files.length} shell/locale files (${Object.keys(ALLOWED).length} search synonym allowed).`);
