/**
 * storageFunctions — matcher + var substitution + uri join.
 */

import { describe, it, expect } from 'vitest';
import { matchMapping, substituteVars, joinUriTail, CANONICAL_STORAGE_FUNCTIONS } from '../src/storageFunctions.js';

describe('matchMapping', () => {
  it('returns exact match when present', () => {
    const m = matchMapping('sharing/profile-public', {
      'sharing/profile-public': '<a>/sharing/public/profile-card',
      'sharing/*':              '<a>/sharing/',
    });
    expect(m).toEqual({
      pattern: 'sharing/profile-public',
      uri:     '<a>/sharing/public/profile-card',
      tail:    '',
    });
  });

  it('falls back to longest-prefix glob', () => {
    const m = matchMapping('sharing/tasks/abc', {
      'sharing/*': '<a>/sharing/',
      'private/*': '<a>/private/',
    });
    expect(m).toEqual({ pattern: 'sharing/*', uri: '<a>/sharing/', tail: 'tasks/abc' });
  });

  it('prefers longer prefix when multiple globs match', () => {
    const m = matchMapping('group/circle-abc/tasks/x', {
      'group/*':            '<a>/group/',
      'group/circle-abc/*':  '<anne>/sharing/stoop/abc/',
    });
    expect(m.pattern).toBe('group/circle-abc/*');
    expect(m.tail).toBe('tasks/x');
  });

  it('returns null on no match', () => {
    expect(matchMapping('weird/path', { 'sharing/*': '/x/' })).toBe(null);
  });

  it('rejects bad input', () => {
    expect(matchMapping('', { 'a/*': '/' })).toBe(null);
    expect(matchMapping(null, { 'a/*': '/' })).toBe(null);
    expect(matchMapping('a/b', null)).toBe(null);
  });
});

describe('substituteVars', () => {
  it('substitutes a single var', () => {
    expect(substituteVars('<a>/x', { a: 'foo' })).toBe('foo/x');
  });

  it('substitutes multiple vars', () => {
    expect(substituteVars('<a>/<b>/<a>', { a: '1', b: '2' })).toBe('1/2/1');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(substituteVars('<a>/<b>', { a: 'x' })).toBe('x/<b>');
  });

  it('returns non-string templates verbatim', () => {
    expect(substituteVars(42, {})).toBe(42);
    expect(substituteVars(null, {})).toBe(null);
  });
});

describe('joinUriTail', () => {
  it('joins with single slash when base ends with slash', () => {
    expect(joinUriTail('https://x/y/', 'a/b')).toBe('https://x/y/a/b');
  });

  it('inserts slash when base has none', () => {
    expect(joinUriTail('https://x/y', 'a/b')).toBe('https://x/y/a/b');
  });

  it('returns base verbatim for empty tail', () => {
    expect(joinUriTail('https://x/y/', '')).toBe('https://x/y/');
    expect(joinUriTail('https://x/y', undefined)).toBe('https://x/y');
  });
});

describe('CANONICAL_STORAGE_FUNCTIONS', () => {
  it('lists all seven canonical functions', () => {
    expect(CANONICAL_STORAGE_FUNCTIONS).toEqual([
      'private/identity-vault',
      'private/state',
      'private/drafts',
      'sharing/profile-public',
      'sharing',
      'group',
      'personal-in-group',
    ]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(CANONICAL_STORAGE_FUNCTIONS)).toBe(true);
  });
});
