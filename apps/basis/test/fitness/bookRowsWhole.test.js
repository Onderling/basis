/**
 * A `listContacts` reply is read WHOLE (2026-09-24). The waist returns the book's rows as `contacts` and a trimmed
 * chat projection as `items`; a reader that takes `items` first sees no `persona`, `revealPreset`, `hidden` or
 * `deletedAt` on any row. That is how the pair roster founded every pair circle with no release while its test
 * (which faked `items`) stayed green. Read through `bookRowsOf` (`src/v2/contactsSource.js`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOTS = ['src', 'web', 'bin', '../basis-mobile/src'].map((r) => path.resolve(__dirname, '../..', r));
function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(m?js)$/.test(name)) yield p;
  }
}

describe('fitness — no reader takes the trimmed `items` before the book\'s rows', () => {
  it('finds no `items ?? … contacts` read', () => {
    const hits = [];
    for (const root of ROOTS) for (const f of files(root)) {
      const src = readFileSync(f, 'utf8');
      if (/\.items\s*\?\?\s*[\w?.]*\.contacts/.test(src)) hits.push(path.relative(path.resolve(__dirname, '../..'), f));
    }
    expect(hits, 'read a listContacts reply with bookRowsOf(reply)').toEqual([]);
  });
});
