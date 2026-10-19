#!/usr/bin/env node
// theme-css.mjs — generate web/v2/theme.css from the canonical tokens in
// src/v2/theme.js, so the web mirror can never drift from the shared THEME
// (the old file said "keep the values in sync" — this script IS the sync).
//
//   node scripts/theme-css.mjs           write web/v2/theme.css
//   node scripts/theme-css.mjs --check   fail if the file on disk differs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEME, THEME_DARK } from '../src/v2/theme.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'web/v2/theme.css');

// token key → CSS custom-property name (kebab, matching circle.css usage)
const NAME = {
  ink: '--ink', inkSoft: '--ink-soft', paper: '--paper', paper2: '--paper-2',
  line: '--line', accent: '--accent', accentContrast: '--accent-contrast',
  accentInk: '--accent-ink', card: '--card', meBg: '--me-bg',
  botBg: '--bot-bg', botLine: '--bot-line', consentBg: '--consent-bg',
  green: '--green', greenBg: '--green-bg', blue: '--blue', blueBg: '--blue-bg',
  amber: '--amber', amberBg: '--amber-bg', danger: '--danger', dangerBg: '--danger-bg',
  trackOff: '--track-off', white: '--white',
};

function colorVars(colors, indent) {
  return Object.entries(colors)
    .map(([k, v]) => {
      if (!NAME[k]) throw new Error(`theme-css: no CSS var name for color token "${k}"`);
      return `${indent}${NAME[k]}: ${v};`;
    })
    .join('\n');
}

const r = THEME.radius, f = THEME.font;
const staticVars = `
  --radius-sm: ${r.sm}px;
  --radius:    ${r.md}px;
  --radius-lg: ${r.lg}px;

  --font-serif: ${f.serif};
  --font-sans:  ${f.sans};
  --font-mono:  ${f.mono};`;

const css = `/* basis v2 — Onderling design tokens (web).
 *
 * GENERATED from src/v2/theme.js by scripts/theme-css.mjs — do not edit by
 * hand; edit the tokens and re-run \`node scripts/theme-css.mjs\`.
 * Component + screen styles live in web/v2/circle.css. */

:root {
  /* the browser draws its NATIVE controls (select menus, date pickers, dialogs, scrollbars) in the page's scheme —
     without this they stay light in a dark app */
  color-scheme: light dark;
${colorVars(THEME.color, '  ')}
${staticVars}
}

/* dark — follows the OS unless data-theme overrides (set by the shell) */
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
${colorVars(THEME_DARK.color, '    ')}
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
${colorVars(THEME_DARK.color, '  ')}
}
:root[data-theme="light"] {
  color-scheme: light;
${colorVars(THEME.color, '  ')}
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
`;

if (process.argv.includes('--check')) {
  const onDisk = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (onDisk !== css) {
    console.error('✗ theme.css is stale — run `node scripts/theme-css.mjs`');
    process.exit(1);
  }
  console.log('✓ theme.css matches src/v2/theme.js');
} else {
  fs.writeFileSync(OUT, css);
  console.log('✓ wrote web/v2/theme.css from src/v2/theme.js');
}
