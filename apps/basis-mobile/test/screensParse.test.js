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
const screensRoot = path.join(here, '..', 'src', 'screens');

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
  const files = jsFilesUnder(screensRoot);

  it('found screens to check (the guard is not vacuously green)', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    const rel = path.relative(screensRoot, file);
    it(`${rel} parses`, async () => {
      const source = readFileSync(file, 'utf-8');
      // `format: 'esm'` is the point: sloppy-mode CommonJS would accept a duplicate parameter.
      await expect(
        transform(source, { loader: 'jsx', format: 'esm', sourcefile: rel }),
      ).resolves.toBeTruthy();
    });
  }
});
