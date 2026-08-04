/**
 * GUARD — the shell ENTRY file parses.
 *
 * Why this exists: on 2026-08-04 a stray `},` shipped in App.js (wave-1 batch 3) and 705 mobile tests
 * stayed green, because no test imports App.js — the one file every real launch goes through was the
 * one file nothing parsed. Metro would have caught it on the next device run, i.e. days later, as a
 * red screen. This is the cheapest possible stand-in: parse (not execute) the entry with the same
 * Babel the bundler uses. A parse guard catches exactly the class that slipped; it proves nothing
 * about behaviour — the suites do that for what they import.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseSync } from '@babel/core';

const ROOT = path.resolve(__dirname, '..');

describe('GUARD — shell entry parses', () => {
  it('App.js parses under the project Babel config', () => {
    const file = path.join(ROOT, 'App.js');
    const src = readFileSync(file, 'utf8');
    // parseSync throws with a line/column on any syntax error — that throw IS the finding.
    const ast = parseSync(src, { filename: file, cwd: ROOT });
    expect(ast?.type).toBe('File');
  });
});
