#!/usr/bin/env node
/**
 * lint-jsx-raw-text — no stray text straight inside a fragment or an opening tag in React Native code.
 *
 * JSX keeps whitespace that sits on ONE line between two tokens: `(<>   {/* note *\/}` gives the fragment a
 * text child of three spaces. On the web that is harmless; in React Native a fragment flattens into its parent
 * <View>, and a <View> may not hold text — the screen dies with "Text strings must be rendered within a <Text>
 * component". It cost every circle on mobile from 2026-09-08 to 2026-10-08: opening one painted the red
 * screen, and nothing failed (src/screens/** has no render coverage and eslint does not run in CI).
 *
 * Red on, per line, in the React Native sources:
 *   - `<>` followed on the same line by whitespace and then anything (`(<>   {/* … *\/}`, `<> <View>`);
 *   - an opening tag's `>` followed on the same line by whitespace and a JSX comment (`<View>  {/* … *\/}`).
 * The fix is always the same: put what follows on its own line, or drop the whitespace.
 * Baseline: empty — there is nothing here that is allowed to stay.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCOPE = [/^apps\/basis-mobile\/src\//, /^apps\/basis\/src\/rn\//];

const RULES = [
  { name: 'text after <> on the same line', re: /(^|[^\w<])<>[ \t]+\S/ },
  // `=>` is an arrow, not a tag — `() => {/* noop */}` is code.
  { name: 'whitespace then a JSX comment after an opening tag', re: /[^=\s-]>[ \t]+\{\/\*/ },
];

const isCommentLine = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

/** The hits in one file's source: [{ line, rule, text }]. Exported for the self-test. */
export function scanSource(src) {
  const hits = [];
  src.split('\n').forEach((text, i) => {
    if (isCommentLine(text)) return;
    const r = RULES.find((rule) => rule.re.test(text));   // one report per line, the first rule that names it
    if (r) hits.push({ line: i + 1, rule: r.name, text: text.trim() });
  });
  return hits;
}

function main() {
  const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  const files = execSync('git ls-files', { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .filter((f) => /\.[cm]?jsx?$|\.tsx$/.test(f) && SCOPE.some((s) => s.test(f)));
  const hits = [];
  for (const f of files) {
    let src;
    try { src = readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    for (const h of scanSource(src)) hits.push(`${f}:${h.line}  (${h.rule})  ${h.text}`);
  }
  if (hits.length) {
    console.error(`\n✗ lint:jsx-raw-text — ${hits.length} line(s) put text straight inside a fragment or tag:\n`);
    for (const h of hits) console.error(`   - ${h}`);
    console.error(`
In React Native that text lands in a <View> and the screen crashes ("Text strings must be rendered within a
<Text> component"). Move what follows the tag onto its own line.
`);
    process.exit(1);
  }
  console.log('✓ lint:jsx-raw-text: no stray text inside fragments or tags in the React Native sources.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
