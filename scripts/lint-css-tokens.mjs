#!/usr/bin/env node
/**
 * lint-css-tokens — every `var(--name)` in ANY web file (all of apps/basis/web: style.css, inline `cssText` in the JS) is one a web stylesheet DEFINES; `theme-tokens` covers circle.css + the theme file only.
 *
 * A token nobody defines falls back to its literal (`var(--surface, #fff)` is just `#fff`), and a literal does not
 * follow the theme: the "+" sheet on Vandaag stayed white in dark mode (Frits, 2026-10-20) because `--surface` was never
 * part of the theme. Six such tokens had collected. Nothing failed when one was added; this does.
 *
 *   node scripts/lint-css-tokens.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCOPE = /^apps\/basis\/web\/.*\.(js|css)$/;

/** The tokens a stylesheet defines (`--name: …`). Exported for the self-test. */
export function definedTokens(css) { return new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])); }
/** The tokens a source uses, with their lines: [{ token, line }]. */
export function usedTokens(src) {
  const out = [];
  src.split('\n').forEach((text, i) => { for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) out.push({ token: m[1], line: i + 1 }); });
  return out;
}

function main() {
  const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  const files = execSync('git ls-files', { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter((f) => SCOPE.test(f));
  const read = (f) => { try { return readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } };
  const defined = definedTokens(files.filter((f) => f.endsWith('.css')).map(read).join('\n'));
  // a token set at run time by the code itself (`el.style.setProperty('--x', …)`) is defined too
  for (const f of files.filter((x) => x.endsWith('.js'))) for (const m of read(f).matchAll(/setProperty\(\s*['"](--[\w-]+)['"]/g)) defined.add(m[1]);
  const misses = [];
  for (const f of files) for (const u of usedTokens(read(f))) if (!defined.has(u.token)) misses.push(`${f}:${u.line}  ${u.token}`);
  if (misses.length) {
    console.error(`\n✗ lint:css-tokens — ${misses.length} use(s) of a token no web stylesheet defines (it falls back to a literal, which ignores the theme and dark mode):\n`);
    for (const m of misses) console.error(`   - ${m}`);
    console.error('\nUse a theme token (web/v2/theme.css: --card, --paper-2, --ink, --danger, …), or define the new one in the theme.\n');
    process.exit(1);
  }
  console.log(`✓ lint:css-tokens: every web var(--…) is defined (${defined.size} tokens).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
