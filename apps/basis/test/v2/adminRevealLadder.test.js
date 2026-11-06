/**
 * THE ADMIN PAGE SEES WHAT THE REVEAL LADDER LETS IT SEE. Its rows and its "… was removed" / role confirm texts read
 * the raw roster row, whose display name is UNGATED: an unreleased member's real name showed there (walk rows 67/68),
 * while the members list beside it showed their handle. Both now go through one projection (`rosterRowShown`).
 */
import { describe, it, expect } from 'vitest';
import { rosterRowShown } from '../../src/v2/circleViewAs.js';
import { memberShown } from '../../src/v2/personLabel.js';

const KEY = 'PflwUn2aVLieLdb-DW-0VkmQH6ZMMq4WRRGlBolrrtw';
const t = (k) => (k === 'circle.reply.who_someone' ? 'iemand' : k);

describe('the admin page and the reveal ladder', () => {
  it('an unreleased member with a handle shows the handle, never their raw display name', () => {
    const raw = { webid: KEY, handle: 'ada', displayName: 'Ada Lovelace' };
    expect(rosterRowShown(raw, { viewerId: 'me', policy: 'pairwise', t })).toBe('@ada');
    // the old read, for contrast — this is what the admin page painted
    expect(memberShown(raw, t)).toBe('Ada Lovelace');
  });

  it('an unreleased member without a handle is "iemand", never their raw name and never their key', () => {
    const w = rosterRowShown({ webid: KEY, displayName: 'Ada Lovelace' }, { viewerId: 'me', policy: 'pairwise', t });
    expect(w).toBe('iemand');
  });

  it("the admin's own row still shows their own name", () => {
    const w = rosterRowShown({ webid: 'me', displayName: 'Bea' }, { viewerId: 'me', policy: 'pairwise', t });
    expect(w).not.toBe('iemand');
  });
});
