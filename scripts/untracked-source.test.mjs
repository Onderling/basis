import { describe, it, expect } from 'vitest';
import { untrackedSource } from './untracked-source.mjs';

describe('the source files the guards cannot see yet', () => {
  it('names new code under apps, packages and scripts — not notes, not elsewhere, not node_modules', () => {
    expect(untrackedSource([
      'apps/basis/src/v2/newThing.js', 'packages/core/src/x.mjs', 'scripts/lint-new.mjs', 'apps/basis/src/locales/x.json',
      'notes.md', 'plans/x.js', 'apps/basis/node_modules/foo/index.js', 'tmp.log',
    ])).toEqual(['apps/basis/src/v2/newThing.js', 'packages/core/src/x.mjs', 'scripts/lint-new.mjs', 'apps/basis/src/locales/x.json']);
    expect(untrackedSource(null)).toEqual([]);
  });
});
