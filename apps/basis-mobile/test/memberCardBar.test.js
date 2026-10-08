/**
 * The member card's top line keeps its two actions apart.
 *
 * The bar held "← circles" and "Report member" in a row with no gap and no spacing, so on a phone it read as one
 * phrase — "← circlesReport member" (found 2026-10-08 on a real phone). Back sits left, the report action right.
 * `src/screens/**` cannot be rendered under vitest, so the paint is pinned as source text.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../src/screens/v2/CircleMemberCardScreen.js', import.meta.url)), 'utf8');

describe('the member card bar', () => {
  it('spaces back and report apart instead of running them together', () => {
    expect(src).toMatch(/bar:\s*\{[^}]*justifyContent:\s*'space-between'/);
  });
});
