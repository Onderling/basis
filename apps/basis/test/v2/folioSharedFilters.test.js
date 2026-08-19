/**
 * basis v2 — "Shared by me / Shared with me" filter tests.
 */
import { describe, it, expect } from 'vitest';
import {
  FOLIO_SHARE_FILTERS, isSharedByMe, isSharedWithMe,
  buildSharedFiles, sharedFilesFromListFiles,
} from '../../src/v2/folioSharedFilters.js';

const ME = 'webid:alice';
const BOB = 'webid:bob';

const mineShared   = { id: 'm1', name: 'M1', owner: ME,  circleId: 'circle-A', updatedAt: 200 };
const minePrivate  = { id: 'm2', name: 'M2', owner: ME,                       updatedAt: 100 };
const bobInMyCircle = { id: 'b1', name: 'B1', owner: BOB, circleId: 'circle-A', updatedAt: 300 };
const bobOutsideMe = { id: 'b2', name: 'B2', owner: BOB, circleId: 'circle-Z', updatedAt: 50  };
const orphanShared = { id: 'o1', name: 'O1',             circleId: 'circle-A', updatedAt: 25  };

const MY_CIRCLES = ['circle-A', { id: 'circle-B' }];

describe('FOLIO_SHARE_FILTERS', () => {
  it('exposes both filter modes', () => {
    expect(FOLIO_SHARE_FILTERS).toEqual(['shared-by-me', 'shared-with-me']);
  });
});

describe('isSharedByMe', () => {
  it('matches my items that are in a circle', () => {
    expect(isSharedByMe(mineShared, ME)).toBe(true);
  });
  it('rejects my private (no-circle) items', () => {
    expect(isSharedByMe(minePrivate, ME)).toBe(false);
  });
  it("rejects someone else's items", () => {
    expect(isSharedByMe(bobInMyCircle, ME)).toBe(false);
  });
  it('rejects orphan-owned items even if shared', () => {
    expect(isSharedByMe(orphanShared, ME)).toBe(false);
  });
});

describe('isSharedWithMe', () => {
  it('matches others items in a circle I am in', () => {
    expect(isSharedWithMe(bobInMyCircle, ME, MY_CIRCLES)).toBe(true);
  });
  it('rejects others items in circles I am not in', () => {
    expect(isSharedWithMe(bobOutsideMe, ME, MY_CIRCLES)).toBe(false);
  });
  it('rejects my own items (those go under shared-by-me)', () => {
    expect(isSharedWithMe(mineShared, ME, MY_CIRCLES)).toBe(false);
  });
  it('rejects circle-less items', () => {
    expect(isSharedWithMe(minePrivate, ME, MY_CIRCLES)).toBe(false);
  });
  it('rejects orphan-owned items (no owner → cannot attribute)', () => {
    expect(isSharedWithMe(orphanShared, ME, MY_CIRCLES)).toBe(false);
  });
});

describe('buildSharedFiles', () => {
  const FILES = [mineShared, minePrivate, bobInMyCircle, bobOutsideMe, orphanShared];

  it('shared-by-me lists mine-with-circle, newest first', () => {
    const rows = buildSharedFiles({ files: FILES, myId: ME, myCircles: MY_CIRCLES, filter: 'shared-by-me' });
    expect(rows.map((r) => r.id)).toEqual(['m1']);
    expect(rows[0]).toMatchObject({ circleId: 'circle-A', owner: ME });
  });

  it('shared-with-me lists others-in-my-circles, newest first', () => {
    const rows = buildSharedFiles({ files: FILES, myId: ME, myCircles: MY_CIRCLES, filter: 'shared-with-me' });
    expect(rows.map((r) => r.id)).toEqual(['b1']);
    expect(rows[0]).toMatchObject({ circleId: 'circle-A', owner: BOB });
  });

  it('accepts circle objects in myCircles too', () => {
    const objCircles = [{ id: 'circle-A' }, { id: 'circle-B' }];
    const rows = buildSharedFiles({ files: FILES, myId: ME, myCircles: objCircles, filter: 'shared-with-me' });
    expect(rows.map((r) => r.id)).toEqual(['b1']);
  });

  it('returns [] for unknown filter', () => {
    expect(buildSharedFiles({ files: FILES, myId: ME, myCircles: MY_CIRCLES, filter: 'nope' })).toEqual([]);
    expect(buildSharedFiles({ files: FILES, myId: ME, myCircles: MY_CIRCLES })).toEqual([]);
  });

  it('returns [] when no circles match for shared-with-me', () => {
    const rows = buildSharedFiles({ files: [bobOutsideMe], myId: ME, myCircles: ['circle-A'], filter: 'shared-with-me' });
    expect(rows).toEqual([]);
  });
});

describe('sharedFilesFromListFiles', () => {
  it('unwraps {items} and applies the filter', () => {
    const out = sharedFilesFromListFiles(
      { items: [mineShared, bobInMyCircle] },
      { myId: ME, myCircles: ['circle-A'], filter: 'shared-with-me' },
    );
    expect(out.map((r) => r.id)).toEqual(['b1']);
  });
  it('tolerates junk', () => {
    expect(sharedFilesFromListFiles(null, { myId: ME, filter: 'shared-by-me' })).toEqual([]);
  });
});
