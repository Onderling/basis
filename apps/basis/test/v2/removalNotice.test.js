/**
 * Telling someone they are no longer in a circle — on their own device.
 *
 * The decision this pins is not "does a string exist"; it is WHEN a person is told, and the three ways
 * that can go wrong: telling someone who left of their own accord, telling someone because a roster
 * read came back empty, and not telling someone who was actually removed.
 */
import { describe, it, expect } from 'vitest';
import { removalNotice, evictionOfMe, REMOVAL_NOTICE_KEYS, sayRemovalNotice } from '../../src/v2/removalNotice.js';

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

/**
 * THE WRITE — 2026-08-29. The decision above was already shared; the DELIVERY was not, and that is the
 * whole of W23: on a phone that had just been removed, nothing appeared, while the admin's `removeMember`
 * reported `told: true`. Web computed the notice in its own paint code behind a `removalNoticeSaid`
 * boolean; mobile never computed it at all.
 *
 * `sayRemovalNotice` moves decision AND write into shared code both shells call, and makes the ENTRY ID
 * the memory: idempotent by construction, and it survives a reinstall in a way a module-scoped boolean
 * never could.
 */
describe('sayRemovalNotice — the shared write', () => {
  const fakeLog = () => {
    const entries = [];
    return { entries, append: (e) => { entries.push(e); return e; }, query: () => entries.slice() };
  };
  const t = (k) => `t:${k}`;
  const ME = 'me-ref';
  const OTHERS = [{ webid: 'admin-ref' }, { webid: 'someone-else' }];
  const EVICTED = [{ kind: 'evict', subject: ME, author: 'admin-ref' }];

  it('appends one bot line, addressed to this person only', () => {
    const eventLog = fakeLog();
    const r = sayRemovalNotice({ eventLog, circleId: 'kring-1', members: OTHERS, myRef: ME, statements: EVICTED, t });
    expect(r, 'a removed person is told').not.toBeNull();
    expect(eventLog.entries).toHaveLength(1);
    // The canonical chat-message shape (`toEventLogItem`): the same entry kind every other bot line is,
    // which is the point — both shells already paint it.
    const [e] = eventLog.entries;
    expect(e.id, 'the id is derived from the eviction, so it can be recognised again').toBe(r.msgId);
    expect(e.type).toBe('chat-message');
    expect(e.actor).toBe('bot');
    expect(e.payload.circleId).toBe('kring-1');
    expect(e.payload.text).toBe('t:circle.membership.you_were_removed');
    // `scope: 'self'` — the circle it concerns can no longer hear us, and it is one person's business.
    expect(e.payload.scope).toBe('self');
  });

  it('says it once — the entry id IS the memory, not a shell boolean', () => {
    const eventLog = fakeLog();
    const a = sayRemovalNotice({ eventLog, circleId: 'kring-1', members: OTHERS, myRef: ME, statements: EVICTED, t });
    const b = sayRemovalNotice({ eventLog, circleId: 'kring-1', members: OTHERS, myRef: ME, statements: EVICTED, t });
    expect(a).not.toBeNull();
    expect(b, 'the second call finds its own entry and says nothing').toBeNull();
    expect(eventLog.entries, 'exactly one line, however often the roster reloads').toHaveLength(1);
  });

  it('says nothing when the person is still in the circle', () => {
    const eventLog = fakeLog();
    const r = sayRemovalNotice({
      eventLog, circleId: 'kring-1', members: [...OTHERS, { webid: ME }], myRef: ME, statements: EVICTED, t,
    });
    expect(r).toBeNull();
    expect(eventLog.entries).toHaveLength(0);
  });

  it('says nothing on an empty roster (a read that has not landed is not a removal)', () => {
    const eventLog = fakeLog();
    expect(sayRemovalNotice({ eventLog, circleId: 'kring-1', members: [], myRef: ME, statements: EVICTED, t })).toBeNull();
    expect(eventLog.entries).toHaveLength(0);
  });
});
