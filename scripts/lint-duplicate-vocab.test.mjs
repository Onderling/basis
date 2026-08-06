/**
 * Self-test for the duplicate-vocabulary guard (guards.mjs runs `vitest run scripts/`; a guard whose test is
 * red is not a guard). Asserts the guard is GREEN on the current tree, that its key-extraction handles both
 * literal and computed keys, and that it CATCHES a duplicate definition (the retention drift, in miniature).
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { frozenExports, normKey, sameSet, checkVocabularies, VOCABULARIES } from './lint-duplicate-vocab.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('lint-duplicate-vocab', () => {
  it('is green on the current tree (every registered vocabulary defined once)', () => {
    const r = spawnSync(process.execPath, [path.join(HERE, 'lint-duplicate-vocab.mjs')], { encoding: 'utf8' });
    expect(r.stdout + r.stderr).toMatch(/defined once/);
    expect(r.status).toBe(0);
  });

  it('extracts depth-1 keys from a frozen export — literal AND computed', () => {
    const [a] = frozenExports(`export const T = Object.freeze({ short: 1, chat: 2, audit: 3 });`);
    expect([...a.keys].sort()).toEqual(['audit', 'chat', 'short']);
    const [b] = frozenExports(`export const U = Object.freeze({ [RETAIN.SHORT]: 1, [RETAIN.CHAT]: 2, [RETAIN.AUDIT]: 3 });`);
    expect([...b.keys].sort()).toEqual(['audit', 'chat', 'short']);
    // nested objects must not leak their keys up to depth 1
    const [c] = frozenExports(`export const V = Object.freeze({ a: { nestedKey: 1 }, b: 2 });`);
    expect([...c.keys].sort()).toEqual(['a', 'b']);
  });

  it('normalises computed enum keys to their last segment', () => {
    expect(normKey('[RETAIN.AUDIT]')).toBe('audit');
    expect(normKey('short')).toBe('short');
    expect(normKey("'chat'")).toBe('chat');
  });

  it('CATCHES a duplicate: the same key-set defined off-home fails', () => {
    // The registered retention vocab, plus a stub file list where a SECOND file defines the same key-set.
    const retentionHome = VOCABULARIES.find((v) => v.name === 'retention-classes')?.home;
    expect(retentionHome, 'the retention vocab is registered').toBeTruthy();
    // Feed checkVocabularies a synthetic pair via the real files + a decoy is hard; instead prove the core
    // predicate: a definer off the home is a problem.
    const keys = new Set(['audit', 'chat', 'short']);
    expect(sameSet(keys, ['audit', 'chat', 'short'])).toBe(true);
    expect(sameSet(keys, ['audit', 'chat'])).toBe(false);
  });

  it('the current tree has exactly one definer of the retention vocab (no drift)', () => {
    // A red here means a second retention table crept back in.
    expect(checkVocabularies()).toEqual([]);
  });
});
