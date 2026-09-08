#!/usr/bin/env node
/**
 * lint-web-buttons — no bare <button> in the web shell.
 *
 * Frits (2026-09-08): "the interface doesn't feel finished: there are still many default-html buttons".
 * A button created without a class renders in the browser's default look — grey, square, unrelated to
 * the bulletin identity every styled button wears (`.cc-btn` and its variants, or a BEM class the
 * stylesheet knows). This fails the build for a `createElement('button')` that is not given a className
 * within the next lines, so the default look cannot creep back one dialog at a time.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'apps/basis/web');
const files = [];
(function walk(d) { for (const e of readdirSync(d)) { const p = path.join(d, e); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } })(WEB);

const bare = [];
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const m = line.match(/(?:const|let)\s+(\w+)\s*=\s*document\.createElement\('button'\)/);
    if (!m) return;
    const v = m[1];
    // the class is usually set on the next line; a button built up over a screen (a confirm button that
    // several pickers reference) may set it later — so look at the rest of the file, scoped by the name
    const rest = lines.slice(i + 1).join('\n');
    if (new RegExp(`\\b${v}\\.className\\s*=|\\b${v}\\.classList\\.add\\(`).test(rest)) return;
    bare.push(`${path.relative(ROOT, f)}:${i + 1}  (${v})`);
  });
}
if (bare.length) {
  console.error(`✖ lint-web-buttons: ${bare.length} button(s) without a class — the browser's default look:\n  • ${bare.join('\n  • ')}\n  Give each a class: \`cc-btn cc-btn--primary\` (the action), \`cc-btn cc-btn--quiet\` (cancel/back), or the screen's own BEM class.`);
  process.exit(1);
}
console.log(`✓ lint-web-buttons: every <button> in the web shell carries a class (${files.length} files)`);
