/**
 * The phone's version comes from the tag of the tree being built, through the build — never typed. A clean build that
 * is not exactly a release says the release before it plus how far past it and which commit (a bare nearest tag would
 * claim a release it is not); a dirty tree says none (the screen then says "dev"). An env override (a pipeline's) counts only when it names a tag that points at
 * the tree; a pipeline cannot type one either.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveAppVersion } = require('../appVersion.cjs');

/** A fake `git`: what the tree's tags at HEAD are, whether it is dirty. */
const fakeGit = ({ tags = [], dirty = false, after = null } = {}) => (args) => {
  const cmd = args.join(' ');
  if (cmd === "describe --tags --match v[0-9]* --long HEAD") { if (!after) throw new Error('no release tag'); return `${after}\n`; }
  if (cmd === 'status --porcelain') return dirty ? ' M src/x.js\n' : '';
  if (cmd === 'describe --tags --exact-match HEAD') { if (!tags.length) throw new Error('no tag'); return `${tags[0]}\n`; }
  if (cmd === 'tag --points-at HEAD') return tags.join('\n') + (tags.length ? '\n' : '');
  throw new Error(`unexpected git ${cmd}`);
};

describe('resolveAppVersion', () => {
  it('a clean tree at a release tag: that tag', () => {
    expect(resolveAppVersion({ env: {}, git: fakeGit({ tags: ['v0.1.70-alpha'] }) })).toBe('v0.1.70-alpha');
  });
  it('a DIRTY tree on a tagged commit: none', () => {
    expect(resolveAppVersion({ env: {}, git: fakeGit({ tags: ['v0.1.70-alpha'], dirty: true }) })).toBe(null);
  });
  it('an untagged tree: none when no release tag is behind it', () => {
    expect(resolveAppVersion({ env: {}, git: fakeGit({ tags: [] }) })).toBe(null);
  });
  it('an untagged clean tree after a release: the release WITH its distance and commit, never the bare tag', () => {
    const v = resolveAppVersion({ env: {}, git: fakeGit({ tags: [], after: 'v0.1.72-alpha-80-gf6480e13a' }) });
    expect(v).toBe('v0.1.72-alpha-80-gf6480e13a');
    expect(v).not.toBe('v0.1.72-alpha');
  });
  it('a describe that comes back without distance and commit is refused (it would claim the release)', () => {
    expect(resolveAppVersion({ env: {}, git: fakeGit({ tags: [], after: 'v0.1.72-alpha' }) })).toBe(null);
  });
  it('APP_VERSION naming a tag at the tree: that tag; naming anything else: refused (none)', () => {
    expect(resolveAppVersion({ env: { APP_VERSION: 'v0.1.70-alpha' }, git: fakeGit({ tags: ['v0.1.70-alpha'] }) })).toBe('v0.1.70-alpha');
    expect(resolveAppVersion({ env: { APP_VERSION: 'v9.9.9' }, git: fakeGit({ tags: ['v0.1.70-alpha'] }) })).toBe(null);
    expect(resolveAppVersion({ env: { APP_VERSION: 'v0.1.70-alpha' }, git: fakeGit({ tags: [] }) })).toBe(null);
  });
  it('no git at all (a build outside a checkout): none, never a throw', () => {
    expect(resolveAppVersion({ env: {}, git: () => { throw new Error('not a git repo'); } })).toBe(null);
  });
});
