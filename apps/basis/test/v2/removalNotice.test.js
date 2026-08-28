/**
 * L51 — a removed member is told, on their own device.
 *
 * The decision this pins is not "does a string exist"; it is WHEN a person is told, and the three ways
 * that can go wrong: telling someone who left of their own accord, telling someone because a roster
 * read came back empty, and not telling someone who was actually removed.
 */
import { describe, it, expect } from 'vitest';
import { removalNotice, evictionOfMe, REMOVAL_NOTICE_KEYS } from '../../src/v2/removalNotice.js';

const ME = 'webid:me';
const ADMIN = 'webid:admin';
const rows = (...refs) => refs.map((webid) => ({ webid, role: webid === ADMIN ? 'admin' : 'member' }));

describe('removalNotice', () => {
  it('says nothing while I am still in the circle', () => {
    expect(removalNotice({ members: rows(ADMIN, ME), myRef: ME })).toBe(null);
  });

  it('tells me when I am gone from a circle that still has people in it', () => {
    const n = removalNotice({ members: rows(ADMIN), myRef: ME });
    expect(n?.key).toBe(REMOVAL_NOTICE_KEYS.removed);
  });

  it('says NOTHING on an empty roster — a read that has not loaded is not an eviction', () => {
    // The worst possible false positive: telling someone they were thrown out of a circle because a
    // projection came back empty.
    expect(removalNotice({ members: [], myRef: ME })).toBe(null);
    expect(removalNotice({ members: null, myRef: ME })).toBe(null);
  });

  it('does not tell someone who LEFT that they were removed', () => {
    const statements = [
      { kind: 'join',  subject: ME, author: ME },
      { kind: 'leave', subject: ME, author: ME },     // self-authored — a departure
    ];
    expect(removalNotice({ members: rows(ADMIN), myRef: ME, statements })).toBe(null);
  });

  it('tells someone an ADMIN removed, and says by whom', () => {
    const statements = [
      { kind: 'join',  subject: ME, author: ME },
      { kind: 'evict', subject: ME, author: ADMIN },
    ];
    const n = removalNotice({ members: rows(ADMIN), myRef: ME, statements });
    expect(n?.key).toBe(REMOVAL_NOTICE_KEYS.removed);
    expect(n?.by).toBe(ADMIN);
  });

  it('does not depend on statement ORDER — the bug this test used to encode', () => {
    // A real device returned ["evict:admin→me", "join:admin→me"] for someone who joined and was THEN
    // evicted: the original join arrived later, over catch-up. An earlier version read the last match
    // as "most recent", called it a re-join, and told the person nothing.
    const evictFirst = [{ kind: 'evict', subject: ME, author: ADMIN }, { kind: 'join', subject: ME, author: ADMIN }];
    const joinFirst  = [{ kind: 'join', subject: ME, author: ADMIN }, { kind: 'evict', subject: ME, author: ADMIN }];
    expect(evictionOfMe(evictFirst, ME)?.by).toBe(ADMIN);
    expect(evictionOfMe(joinFirst, ME)?.by).toBe(ADMIN);
  });

  it('a RE-JOIN is handled by the ROSTER, not by ordering statements', () => {
    // Being let back in puts me in the roster, and the roster check returns before the statements are
    // ever consulted. That is why this module needs no ordering: the fold already decided.
    const statements = [{ kind: 'evict', subject: ME, author: ADMIN }];
    expect(removalNotice({ members: rows(ADMIN, ME), myRef: ME, statements })).toBe(null);
  });

  it('withholds the reason — the 2026-08-28 decision, pinned so a flip is deliberate', () => {
    const statements = [{ kind: 'evict', subject: ME, author: ADMIN }];
    const n = removalNotice({ members: rows(ADMIN), myRef: ME, statements, reason: 'negeert de bin rota' });
    expect(n?.key, 'the reason key must not be reached while the flag is false')
      .toBe(REMOVAL_NOTICE_KEYS.removed);
    expect(n?.reason).toBeUndefined();
  });

  it('still says something when the statements are not at hand', () => {
    // Degrade toward telling: a person owed a notice is worse served by silence than by a line that
    // does not name a cause.
    const n = removalNotice({ members: rows(ADMIN), myRef: ME, statements: null });
    expect(n?.key).toBe(REMOVAL_NOTICE_KEYS.removed);
    expect(n?.by).toBe(null);
  });

  it('refuses to guess without a ref', () => {
    expect(removalNotice({ members: rows(ADMIN), myRef: null })).toBe(null);
  });
});
