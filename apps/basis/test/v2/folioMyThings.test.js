/**
 * basis v2 — "My things" notes-list tests.
 */
import { describe, it, expect } from 'vitest';
import {
  itemOwner, isMyPrivateItem, buildMyThings, myThingsFromListFiles,
} from '../../src/v2/folioMyThings.js';

const ME = 'webid:alice';
const OTHER = 'webid:bob';

const mineNote      = { id: 'a', name: 'A', owner: ME,    updatedAt: 100 };
const mineSharedNote= { id: 'b', name: 'B', owner: ME,    updatedAt: 200, circleId: 'circle-1' };
const theirsNote    = { id: 'c', name: 'C', owner: OTHER, updatedAt: 300 };
const orphanNote    = { id: 'd', name: 'D',               updatedAt: 50  };

describe('itemOwner', () => {
  it('reads owner / ownerId / authorId in priority order', () => {
    expect(itemOwner({ owner: ME })).toBe(ME);
    expect(itemOwner({ ownerId: ME })).toBe(ME);
    expect(itemOwner({ authorId: ME })).toBe(ME);
    expect(itemOwner({ owner: ME, ownerId: OTHER })).toBe(ME);
  });
  it('returns null for items without owner info', () => {
    expect(itemOwner({})).toBe(null);
    expect(itemOwner(null)).toBe(null);
    expect(itemOwner(undefined)).toBe(null);
  });
});

describe('isMyPrivateItem', () => {
  it('keeps mine + circle-less items', () => {
    expect(isMyPrivateItem(mineNote, ME)).toBe(true);
  });
  it('drops items scoped to a circle (even if mine)', () => {
    expect(isMyPrivateItem(mineSharedNote, ME)).toBe(false);
  });
  it('drops items owned by someone else', () => {
    expect(isMyPrivateItem(theirsNote, ME)).toBe(false);
  });
  it('keeps orphan items (legacy / no owner) regardless of myId', () => {
    expect(isMyPrivateItem(orphanNote, ME)).toBe(true);
    expect(isMyPrivateItem(orphanNote, null)).toBe(true);
  });
  it('with myId=null treats only orphans as mine', () => {
    expect(isMyPrivateItem(mineNote, null)).toBe(false);
    expect(isMyPrivateItem(orphanNote, null)).toBe(true);
  });
  it('rejects non-object input safely', () => {
    expect(isMyPrivateItem(null, ME)).toBe(false);
    expect(isMyPrivateItem('not-a-file', ME)).toBe(false);
  });
});

describe('buildMyThings', () => {
  it('returns mine + circle-less items, newest first', () => {
    const rows = buildMyThings({
      files: [theirsNote, mineSharedNote, orphanNote, mineNote],
      myId: ME,
    });
    expect(rows.map((r) => r.id)).toEqual(['a', 'd']);
  });
  it('returns [] for non-array input', () => {
    expect(buildMyThings({ files: null, myId: ME })).toEqual([]);
    expect(buildMyThings()).toEqual([]);
  });
  it('normalises kind/size defaults', () => {
    const rows = buildMyThings({ files: [mineNote], myId: ME });
    expect(rows[0]).toMatchObject({ id: 'a', name: 'A', kind: 'file', size: null });
  });
});

describe('myThingsFromListFiles', () => {
  it('unwraps {items} shape', () => {
    const out = myThingsFromListFiles({ items: [mineNote, theirsNote] }, ME);
    expect(out.map((r) => r.id)).toEqual(['a']);
  });
  it('unwraps {files} shape', () => {
    const out = myThingsFromListFiles({ files: [orphanNote] }, ME);
    expect(out.map((r) => r.id)).toEqual(['d']);
  });
  it('unwraps bare array shape', () => {
    const out = myThingsFromListFiles([mineNote], ME);
    expect(out.map((r) => r.id)).toEqual(['a']);
  });
  it('tolerates junk input', () => {
    expect(myThingsFromListFiles(null, ME)).toEqual([]);
    expect(myThingsFromListFiles('nope', ME)).toEqual([]);
  });
});
