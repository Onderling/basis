/**
 * Fitness guard — every name the mobile screens import from '@onderling-app/basis' must actually be
 * exported by that entry.
 *
 * The failure class this pins: `src/screens/**` has no test coverage (no JSX loader), and Metro's ESM→CJS
 * interop turns a MISSING named export into `undefined` instead of a load error — so a screen importing a
 * name the basis index forgot to export crashes only when that screen is opened on a device. Exactly this
 * shipped: the launcher imported `adoptExistingRelay` + `asyncStorageConnectionPointsIo`, the index didn't
 * export them, and the connection-points screen was a silent runtime crash (found 2026-07-28).
 *
 * Static on both sides (parse the screens' import lists, parse the index's export statements) so no JSX
 * loader and no RN modules are needed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const screensDir = path.join(here, '..', 'src', 'screens', 'v2');
const basisIndex = path.join(here, '..', '..', 'basis', 'src', 'index.js');

/** Named imports from '@onderling-app/basis' in one source file. */
function basisImportsOf(source) {
  const names = [];
  const re = /import\s*\{([^}]*)\}\s*from\s*['"]@onderling-app\/basis['"]/g;
  for (const m of source.matchAll(re)) {
    // Strip line comments BEFORE splitting — a comment containing a comma would otherwise shred names.
    const list = m[1].replace(/\/\/[^\n]*/g, '');
    for (const raw of list.split(',')) {
      const clean = raw.trim();
      if (!clean) continue;
      // `orig as alias` → the ORIGINAL name is what must be exported.
      names.push(clean.split(/\s+as\s+/)[0].trim());
    }
  }
  return names.filter(Boolean);
}

/** Every name the basis index exports (export { a, b as c } from … / export function|const d). */
function basisIndexExports(source) {
  const names = new Set();
  for (const m of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    const list = m[1].replace(/\/\/[^\n]*/g, '');
    for (const raw of list.split(',')) {
      const clean = raw.trim();
      if (!clean) continue;
      const asMatch = clean.split(/\s+as\s+/);
      names.add((asMatch[1] ?? asMatch[0]).trim());   // `a as b` exports b
    }
  }
  for (const m of source.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]);
  }
  return names;
}

describe('mobile screens × the @onderling-app/basis entry', () => {
  const exported = basisIndexExports(readFileSync(basisIndex, 'utf-8'));
  const screenFiles = readdirSync(screensDir).filter((f) => f.endsWith('.js'));

  it('found screens and a non-trivial export surface (the guard is not vacuously green)', () => {
    expect(screenFiles.length).toBeGreaterThan(0);
    expect(exported.size).toBeGreaterThan(50);
  });

  for (const f of screenFiles) {
    it(`${f} — every basis import resolves to a real export`, () => {
      const wanted = basisImportsOf(readFileSync(path.join(screensDir, f), 'utf-8'));
      const missing = wanted.filter((n) => !exported.has(n));
      expect(missing).toEqual([]);
    });
  }
});
