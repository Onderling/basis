import { describe, it, expect } from 'vitest';
import { sep } from 'node:path';

import { PathMap } from '../src/PathMap.js';

const LOCAL = '/home/alice/notes';
const POD   = 'https://alice.example/notes/';

function p(...segs) { return [LOCAL, ...segs].join(sep); }

describe('PathMap — construction', () => {
  it('throws when localRoot is missing', () => {
    expect(() => new PathMap({ podRoot: POD })).toThrow(/localRoot/);
  });
  it('throws when podRoot is missing', () => {
    expect(() => new PathMap({ localRoot: LOCAL })).toThrow(/podRoot/);
  });
  it('appends trailing slash to podRoot if missing', () => {
    const m = new PathMap({ localRoot: LOCAL, podRoot: 'https://x.example/notes' });
    expect(m.podRoot).toBe('https://x.example/notes/');
  });
  it('strips trailing slash from localRoot', () => {
    const m = new PathMap({ localRoot: `${LOCAL}/`, podRoot: POD });
    expect(m.localRoot).toBe(LOCAL);
  });
});

describe('PathMap — local↔pod round-trip', () => {
  const m = new PathMap({ localRoot: LOCAL, podRoot: POD });

  it('maps simple paths', () => {
    const local = p('recipes', 'cake.md');
    const pod   = m.localToPod(local);
    expect(pod).toBe('https://alice.example/notes/recipes/cake.md');
    expect(m.podToLocal(pod)).toBe(local);
  });

  it('maps deeply nested paths', () => {
    const local = p('a', 'b', 'c', 'd', 'e.md');
    const pod   = m.localToPod(local);
    expect(pod).toBe('https://alice.example/notes/a/b/c/d/e.md');
    expect(m.podToLocal(pod)).toBe(local);
  });

  it('handles paths with spaces', () => {
    const local = p('tax 2024', 'receipts and notes.md');
    const pod   = m.localToPod(local);
    expect(pod).toBe('https://alice.example/notes/tax%202024/receipts%20and%20notes.md');
    expect(m.podToLocal(pod)).toBe(local);
  });

  it('handles unicode paths', () => {
    const local = p('日記', '今日.md');
    const pod   = m.localToPod(local);
    expect(pod).toMatch(/notes\/.*\/.*\.md$/);
    expect(m.podToLocal(pod)).toBe(local);
  });

  it('maps the root itself', () => {
    expect(m.localToPod(LOCAL)).toBe(POD);
    expect(m.podToLocal(POD)).toBe(LOCAL);
  });

  it('throws when local path is outside root', () => {
    expect(() => m.localToPod('/etc/passwd')).toThrow(/under root/);
  });
  it('throws when pod URI is outside root', () => {
    expect(() => m.podToLocal('https://other.example/foo.md')).toThrow(/under pod root/);
  });
});

describe('PathMap.aclFor', () => {
  const m = new PathMap({ localRoot: LOCAL, podRoot: POD });

  it("returns 'public' for shared/...", () => {
    expect(m.aclFor('shared/blog-2026-04-15.md')).toBe('public');
    expect(m.aclFor('shared/nested/deeper.md')).toBe('public');
  });
  it("returns 'private' for anything else", () => {
    expect(m.aclFor('recipes/cake.md')).toBe('private');
    expect(m.aclFor('tax-2024/receipts.md')).toBe('private');
    expect(m.aclFor('top.md')).toBe('private');
  });
  it('treats empty path as private (defensive default)', () => {
    expect(m.aclFor('')).toBe('private');
  });
});

describe('PathMap.shouldSync / shouldSkipDir', () => {
  const m = new PathMap({ localRoot: LOCAL, podRoot: POD });

  it('skips dotfiles', () => {
    expect(m.shouldSync('.gitignore')).toBe(false);
    expect(m.shouldSync('.hidden/notes.md')).toBe(false);
    expect(m.shouldSync('recipes/.draft.md')).toBe(false);
  });
  it('skips .onderling/ metadata dir', () => {
    expect(m.shouldSync('.onderling/notes-sync-state.json')).toBe(false);
    expect(m.shouldSkipDir('.onderling')).toBe(true);
  });
  it('skips OS noise', () => {
    expect(m.shouldSync('.DS_Store')).toBe(false);
    expect(m.shouldSync('Thumbs.db')).toBe(false);
    expect(m.shouldSync('subdir/.DS_Store')).toBe(false);
  });
  it('keeps normal files', () => {
    expect(m.shouldSync('notes/today.md')).toBe(true);
    expect(m.shouldSync('shared/blog.md')).toBe(true);
  });
  it('treats empty / root as not-syncable', () => {
    expect(m.shouldSync('')).toBe(false);
  });
});
