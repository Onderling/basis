#!/usr/bin/env node
/**
 * lint-mobile-buttons — the phone's twin of lint-unstyled-buttons: a button on the phone wears the one button family
 * (`Btn`, screens/v2/Btn.js, the twin of web's `.cc-btn`), not a Pressable styled anew on each screen.
 *
 * In October 2026 Vandaag's "+" sheet showed two looks side by side: its Me actions on `Btn` (pills) and its own acts
 * and Done on a hand-made `styles.btn` (square boxes). The web guard could not see it, since it scans web only.
 *
 * "Hand-styled" = a `<Pressable` whose `style` names a button-like style (btn · button · chip · pill). Red when a file
 * holds MORE of them than its baseline (`scripts/mobile-buttons.baseline.json`). The baseline only shrinks: `--update`
 * writes the current counts and refuses a larger number. A Pressable that is not a button (a row, a card) uses its own
 * style names and is not counted.
 *
 *   node scripts/lint-mobile-buttons.mjs            # check
 *   node scripts/lint-mobile-buttons.mjs --update   # shrink the baseline to the current counts
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCOPE = /^apps\/basis-mobile\/src\/.*\.js$/;
const EXEMPT = new Set(['apps/basis-mobile/src/screens/v2/Btn.js']);
const BASELINE = 'scripts/mobile-buttons.baseline.json';
const BUTTONISH = /\bstyles\.\w*(?:btn|button|chip|pill)\w*/i;

/** The hand-styled button Pressables in one file's source: [{ line }]. Exported for the self-test. */
export function scanSource(src) {
  const out = [];
  const re = /<Pressable\b/g;
  let m;
  while ((m = re.exec(src))) {
    // the opening tag's props: up to the first `>` that closes the tag (props hold arrow functions, so skip `=>`)
    let i = m.index + m[0].length; let depth = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    const props = src.slice(m.index, i);
    const style = /\bstyle=\{/.exec(props);
    if (!style) continue;
    if (BUTTONISH.test(props.slice(style.index))) out.push({ line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => SCOPE.test(f) && !EXEMPT.has(f));
  const counts = {};
  for (const f of files) {
    let src; try { src = readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
    const n = scanSource(src).length;
    if (n) counts[f] = n;
  }
  const basePath = path.join(ROOT, BASELINE);
  const base = existsSync(basePath) ? JSON.parse(readFileSync(basePath, 'utf8')) : {};
  if (process.argv.includes('--update')) {
    const grew = Object.entries(counts).filter(([f, n]) => n > (base[f] ?? 0));
    if (grew.length && existsSync(basePath)) {
      console.error(`lint-mobile-buttons: refusing to grow the baseline:\n${grew.map(([f, n]) => `  ${f}: ${base[f] ?? 0} → ${n}`).join('\n')}`);
      process.exit(1);
    }
    writeFileSync(basePath, `${JSON.stringify(Object.fromEntries(Object.entries(counts).sort()), null, 2)}\n`);
    console.log(`lint-mobile-buttons: baseline written (${Object.values(counts).reduce((a, b) => a + b, 0)} in ${Object.keys(counts).length} files)`);
    process.exit(0);
  }
  const over = Object.entries(counts).filter(([f, n]) => n > (base[f] ?? 0));
  if (over.length) {
    console.error('lint-mobile-buttons: hand-styled buttons beyond the baseline — use Btn (screens/v2/Btn.js):');
    for (const [f, n] of over) console.error(`  ${f}: ${n} (baseline ${base[f] ?? 0})`);
    process.exit(1);
  }
  const shrunk = Object.entries(base).filter(([f, n]) => (counts[f] ?? 0) < n);
  console.log(`lint-mobile-buttons: ok (${Object.values(counts).reduce((a, b) => a + b, 0)} hand-styled, none new)${shrunk.length ? ` — ${shrunk.length} file(s) improved; run --update` : ''}`);
}
