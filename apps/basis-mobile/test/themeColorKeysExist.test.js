/**
 * Every colour a mobile screen names is one the theme has. `theme.color.terracotta` (the retired linen theme's) had no
 * value, so My data's "Opslaan & verbinden" and "Verbindingspunten" buttons painted with no background — dark text on
 * dark in the dark theme, near-invisible (an emulator walk, 2026-10-09). An unknown key is undefined, and undefined
 * paints nothing, silently: so it is checked here, against both themes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEME, THEME_DARK } from '../../basis/src/v2/theme.js';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const files = (dir) => readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  return statSync(p).isDirectory() ? files(p) : (/\.jsx?$/.test(f) ? [p] : []);
});

describe('the colours mobile names', () => {
  it('are keys of both themes', () => {
    const unknown = [];
    for (const f of files(SRC)) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\btheme\.color\.([A-Za-z_$][\w$]*)/g)) {
        if (!(m[1] in THEME.color) || !(m[1] in THEME_DARK.color)) unknown.push(`${path.relative(SRC, f)}: ${m[1]}`);
      }
    }
    expect([...new Set(unknown)]).toEqual([]);
  });
});
