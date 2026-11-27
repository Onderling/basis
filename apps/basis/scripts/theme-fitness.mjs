#!/usr/bin/env node
// theme-fitness.mjs — the design system's drift guards:
//   1. web/v2/theme.css matches src/v2/theme.js (regeneration-clean);
//   2. every var(--x) used in circle.css is DEFINED in theme.css — catches
//      the --paper2/--muted/--serif/--surface class of bug, where a typo'd
//      var silently falls back to a stale hardcoded colour;
//   3. no live hex colours in circle.css — colours come from tokens; hex is
//      allowed only as a dead var() fallback or inside a comment.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = false;

// 1 — regeneration-clean
const gen = spawnSync(process.execPath, [path.join(ROOT, 'scripts/theme-css.mjs'), '--check'], { stdio: 'inherit' });
if (gen.status !== 0) failed = true;

const themeCss = fs.readFileSync(path.join(ROOT, 'web/v2/theme.css'), 'utf8');
const circleCss = fs.readFileSync(path.join(ROOT, 'web/v2/circle.css'), 'utf8');

// 2 — all used custom properties are defined
const defined = new Set([...themeCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const used = new Set([...circleCss.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
const undef = [...used].filter((v) => !defined.has(v));
if (undef.length) {
  console.error('✗ circle.css uses undefined vars (each falls back to a hardcoded colour that ignores the theme):');
  const cssLines = circleCss.split('\n');
  for (const v of undef) {
    cssLines.forEach((l, i) => { if (l.includes(`var(${v}`)) console.error(`   apps/basis/web/v2/circle.css:${i + 1}: ${v}`); });
  }
  console.error('  Fix: use a token web/v2/theme.css defines instead (--card, --paper-2, --ink, …), or add the new one to src/v2/theme.js and regenerate.');
  failed = true;
} else {
  console.log(`✓ all ${used.size} custom properties used in circle.css are defined`);
}

// 3 — no live hex (strip comments and var() fallbacks first)
const stripped = circleCss
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/var\(--[a-z0-9-]+\s*,\s*#[0-9a-fA-F]{3,8}\)/g, 'var(--x)');
const liveHex = stripped.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
if (liveHex.length) {
  console.error('✗ live hex colours in circle.css:');
  const hexes = new Set(liveHex);
  circleCss.split('\n').forEach((l, i) => {
    const code = l.replace(/\/\*.*?\*\//g, '').replace(/var\(--[a-z0-9-]+\s*,\s*#[0-9a-fA-F]{3,8}\)/g, '');
    const here = (code.match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter((h) => hexes.has(h));
    if (here.length) console.error(`   apps/basis/web/v2/circle.css:${i + 1}: ${here.join(' ')}`);
  });
  console.error('  Fix: use a theme token, var(--…), instead of the hex value.');
  failed = true;
} else {
  console.log('✓ no live hex colours in circle.css — all colour comes from tokens');
}

// 4 — no live hex in web inline-style JS. Comments are stripped (they carry
//     issue refs like "#180"); a line may keep a literal colour only with an
//     explicit `// hex-ok: <reason>` marker (QR canvases, fixed overlays).
const jsFiles = [
  ...fs.readdirSync(path.join(ROOT, 'web/v2')).filter((f) => f.endsWith('.js')).map((f) => `web/v2/${f}`),
  ...fs.readdirSync(path.join(ROOT, 'src/web')).filter((f) => f.endsWith('.js')).map((f) => `src/web/${f}`),
];
const offenders = [];
for (const rel of jsFiles) {
  const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  // strip block comments file-wide (issue refs like "#180" live there),
  // keeping line numbers intact
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  src.split('\n').forEach((line, i) => {
    if (line.includes('hex-ok:')) return;
    const cleaned = line
      .replace(/\/\/.*$/, '')
      .replace(/var\(--[a-z0-9-]+\s*,\s*#[0-9a-fA-F]{3,8}\)/g, 'var(--x)'); // dead fallbacks
    const hex = cleaned.match(/['"`{[(;:\s](#[0-9a-fA-F]{3,8})\b/g);
    if (hex) offenders.push(`${rel}:${i + 1} ${hex.map((h) => h.trim()).join(' ')}`);
  });
}
if (offenders.length) {
  console.error(`✗ live hex colours in web JS:`);
  offenders.forEach((o) => console.error('   ' + o));
  console.error("  Fix: use var(--token) instead, or mark the line '// hex-ok: <reason>' when the hex is deliberate.");
  failed = true;
} else {
  console.log(`✓ no live hex colours in ${jsFiles.length} web JS files`);
}

process.exit(failed ? 1 : 0);
