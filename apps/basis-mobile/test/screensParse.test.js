/**
 * Fitness guard — every mobile screen must PARSE AS AN ES MODULE.
 *
 * Real incident (2026-07-29, found by running the app on a phone, not by any test): a duplicate
 * function parameter sat in `CircleLauncherScreen.js` for a day. The app could not boot at all —
 * `SyntaxError: Argument name clash` — while every suite stayed green.
 *
 * Two blind spots lined up:
 *   1. `src/screens/**` has no test coverage (no JSX loader), so nothing imported the file; and
 *   2. **`node --check` treats a `.js` file as CommonJS — sloppy mode — where duplicate parameters are
 *      LEGAL.** Only ES-module strict mode rejects them. So the syntax gate used while editing these
 *      files could not catch the one error that actually mattered.
 *
 * esbuild parses with JSX + ESM semantics, which is what Metro does, so it catches this class and
 * anything else that is a syntax error only under a module goal.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { transform } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
/**
 * Every JSX tree with no test coverage — not just this app's screens.
 *
 * `apps/basis/src/rn/**` is the shared React-Native half (the wizards both shells' mobile builds mount).
 * It has the same property that made this guard necessary: JSX, so a plain `node --check` cannot read it,
 * and no test imports it. Adding the pod-host disclosure to the create wizard on 2026-07-30 is what
 * surfaced the gap — I referenced a style key that did not exist and had to check the parse by hand.
 */
const ROOTS = [
  path.join(here, '..', 'src', 'screens'),
  path.join(here, '..', '..', 'basis', 'src', 'rn'),
];

function jsFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...jsFilesUnder(full));
    else if (entry.endsWith('.js') || entry.endsWith('.jsx')) out.push(full);
  }
  return out;
}

describe('every mobile screen parses as an ES module', () => {
  const files = ROOTS.flatMap((root) => jsFilesUnder(root));

  it('found screens to check (the guard is not vacuously green)', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('covers the SHARED rn tree too, not only this app', () => {
    expect(files.some((f) => f.includes(path.join('basis', 'src', 'rn')))).toBe(true);
  });

  for (const file of files) {
    const rel = path.relative(path.join(here, '..', '..'), file);
    it(`${rel} parses`, async () => {
      const source = readFileSync(file, 'utf-8');
      // `format: 'esm'` is the point: sloppy-mode CommonJS would accept a duplicate parameter.
      await expect(
        transform(source, { loader: 'jsx', format: 'esm', sourcefile: rel }),
      ).resolves.toBeTruthy();
    });
  }
});
