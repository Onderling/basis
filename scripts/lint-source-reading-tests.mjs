#!/usr/bin/env node
/**
 * lint-source-reading-tests — a test that reads source code as TEXT is one rung 1 can find.
 *
 * Rung 1 of the verification ladder runs the tests a change reaches (`vitest related`, which follows imports) plus the
 * tests that read source as text, which `related` cannot follow: test/fitness, every *Parity.test.js, the guards'
 * self-tests, and every test tagged `@reads-source`. A text-reading test anywhere else is invisible to rung 1, and
 * its red shows only in CI (the retro of 2026-11-25: such tests were 11 of 24 reds that the first rung 1 would have
 * missed).
 *
 * Red: a test file outside those places that reads files with fs AND names a source path (a .js/.mjs/.jsx/.ts/.tsx
 * file, or a src/ folder) on a line that is not an import, without the `@reads-source` tag.
 * Fix: add `// @reads-source` near the top of the test (or move it into test/fitness).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const TAG = '@reads-source';

const READS_FILES = /\breadFileSync\s*\(|\breadFile\s*\(/;
const SOURCE_PATH = /['"`][^'"`\n]*(?:\.(?:m?jsx?|tsx?)['"`]|\/src\/|^['"`]src\/)/;
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;
const IMPORT_LINE = /^\s*(?:import\b|export\b[^\n]*\bfrom\b|\}\s*from\b)|\bimport\s*\(|\brequire\s*\(/;

/** Tests rung 1 already runs whole, so they need no tag. */
export function needsNoTag(rel) {
  return /(^|\/)test\/fitness\//.test(rel) || /Parity\.test\.js$/.test(rel) || /^scripts\/lint-[^/]*\.test\.mjs$/.test(rel);
}

/** The lines (1-based) where an untagged test names a source path it reads as text; [] when it is fine. */
export function untaggedSourceReads(rel, text) {
  if (needsNoTag(rel) || text.includes(TAG) || !READS_FILES.test(text)) return [];
  // A relay or box test boots the real box: it names scripts to SPAWN them (rung 2), so there only a source path on
  // the same line as a read counts as reading source.
  const spawnsTheBox = /\.(?:relay|box)\.test\.m?js$/.test(rel);
  const out = [];
  text.split('\n').forEach((l, i) => {
    if (IMPORT_LINE.test(l) || COMMENT_LINE.test(l)) return;
    if (spawnsTheBox && !READS_FILES.test(l)) return;
    if (SOURCE_PATH.test(l)) out.push({ line: i + 1 });
  });
  return out;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'apps', 'packages'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.test\.(m?js|jsx|tsx?)$/.test(f) && !f.includes('node_modules/'));
  const bad = [];
  for (const rel of files) {
    let text;
    try { text = readFileSync(path.join(ROOT, rel), 'utf8'); } catch { continue; }
    const hits = untaggedSourceReads(rel, text);
    if (hits.length) bad.push({ rel, line: hits[0].line, more: hits.length - 1 });
  }
  if (bad.length) {
    console.error(`✖ lint-source-reading-tests: ${bad.length} test(s) read source as text where rung 1 cannot find them:`);
    for (const b of bad) console.error(`  ${b.rel}:${b.line}${b.more ? ` (and ${b.more} more line(s))` : ''}`);
    console.error(`\n  Fix: add \`// ${TAG}\` near the top of each test, so rung 1 runs it (docs/conventions/verification-ladder.md),`);
    console.error('  or move it into test/fitness.');
    process.exit(1);
  }
  console.log(`lint-source-reading-tests: every test that reads source as text is one rung 1 runs (${files.length} tests scanned)`);
}
