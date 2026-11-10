/**
 * "Nieuw voor jou": one row per thing that came in for the person, from others, unread on all their devices.
 */
import { describe, it, expect } from 'vitest';
import { notificationRows } from '../../src/v2/notifications.js';
import { landingEntryFor } from '../../src/v2/itemLanding.js';

const t = (k, v = {}) => `${k.split('.').pop()}${Object.keys(v).length ? ` ${JSON.stringify(v)}` : ''}`;
const NOW = Date.UTC(2026, 10, 9, 12);
const circles = [{ id: 'c1', name: 'Straat' }];
const line = (id, actor, ts, landedAt, text = 'hoi') => ({ id, ts, landedAt, type: 'chat-message', actor, payload: { circleId: 'c1', text } });

describe('notificationRows', () => {
  it('a line, a landed post and a direct message from others are rows, newest arrival first; mine are not', () => {
    const post = { ...landingEntryFor({ circleId: 'c1', item: { id: 'p1', type: 'request', createdAt: NOW - 3000, source: { from: 'b' } }, now: NOW - 2000 }), landedAt: NOW - 2000 };
    const rows = notificationRows({
      events: [line('m1', 'b', NOW - 5000, NOW - 5000), line('m2', 'me', NOW - 4000, NOW - 4000), post],
      turns: [{ contactId: 'bea', origin: 'bot', ts: NOW - 1000, receivedAt: NOW - 1000, messageId: 'd1', text: 'hallo' }, { contactId: 'bea', origin: 'user', ts: NOW, messageId: 'd2', text: 'mine' }],
      circles, contactName: () => 'Bea', myRefs: ['me'], t, now: NOW,
    });
    expect(rows.map((r) => [r.kind, r.id])).toEqual([['dm', 'd1'], ['item', 'p1'], ['line', 'm1']]);
    expect(rows[0]).toMatchObject({ group: { kind: 'contact', id: 'bea', name: 'Bea' }, open: { kind: 'thread', id: 'bea' } });
    expect(rows[1].ids).toEqual([{ id: 'p1', at: NOW - 3000 }]);   // marked by the item's own time
  });
  it('read on any device, or older than the window, is no row', () => {
    const rows = notificationRows({ events: [line('m1', 'b', NOW - 1000, NOW - 1000), line('old', 'b', NOW - 30 * 86_400_000, NOW - 30 * 86_400_000)], circles, readIds: new Set(['m1']), t, now: NOW });
    expect(rows).toEqual([]);
  });
  it('a line delivered long after it was said says it came in later', () => {
    const [r] = notificationRows({ events: [line('m1', 'b', NOW - 3 * 3600_000, NOW - 1000)], circles, t, now: NOW });
    expect(r.late).toBe(true);
  });
  it('someone I admitted joining, and my own removal, are rows', () => {
    const join = { id: 's1', ts: NOW - 100, landedAt: NOW - 100, type: 'membership', circleId: 'c1', payload: { circleId: 'c1', body: { kind: 'join', subject: 'cas', author: 'me' } } };
    const evict = { id: 's2', ts: NOW - 50, landedAt: NOW - 50, type: 'membership', circleId: 'c1', payload: { circleId: 'c1', body: { kind: 'evict', subject: 'me', author: 'admin' } } };
    const rows = notificationRows({ events: [join, evict], circles, viewerIdIn: () => 'me', t, now: NOW });
    expect(rows.map((r) => r.kind)).toEqual(['removed', 'joined']);
  });
  it('more than three from one circle fold into one row with a count, carrying every id', () => {
    const ev = [1, 2, 3, 4].map((i) => line(`m${i}`, 'b', NOW - i * 1000, NOW - i * 1000));
    const rows = notificationRows({ events: ev, circles, t, now: NOW });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'many', count: 4 });
    expect(rows[0].ids.map((x) => x.id).sort()).toEqual(['m1', 'm2', 'm3', 'm4']);
  });
  it('a circle the host does not hand (muted) gives no rows', () => {
    expect(notificationRows({ events: [line('m1', 'b', NOW, NOW)], circles: [], t, now: NOW })).toEqual([]);
  });
});

describe('Today: "Nieuw voor jou" on top, only when it holds rows', () => {
  const page = { id: 's', name: 'Vandaag', circleFilter: null, blocks: [{ id: 'x', type: 'circlesUnread', config: {} }] };
  it('prepended when there is something; absent when there is not, or when the shell did not ask', async () => {
    const { materializeScreen } = await import('../../src/v2/userScreenBlocks.js');
    const log = { query: () => [line('m1', 'b', NOW, NOW)] };
    const asked = await materializeScreen({ screen: page, hostOps: { eventLog: log, circles, myRefs: [], forYou: true, t, now: () => NOW } });
    expect(asked.map((b) => b.type)).toEqual(['forYou', 'circlesUnread']);
    expect(asked[0].content.items[0].id).toBe('m1');
    const notAsked = await materializeScreen({ screen: page, hostOps: { eventLog: log, circles, myRefs: [], t, now: () => NOW } });
    expect(notAsked.map((b) => b.type)).toEqual(['circlesUnread']);
  });
  it('rows for EVERY persona on the device, ticked or not, each carrying the persona it is for', async () => {
    const { materializeScreen } = await import('../../src/v2/userScreenBlocks.js');
    const both = [{ id: 'c1', name: 'Straat' }, { id: 'c2', name: 'Werk Test' }];
    const lineIn = (id, cid, ts) => ({ id, ts, landedAt: ts, type: 'chat-message', actor: 'b', payload: { circleId: cid, text: 'hoi' } });
    const log = { query: () => [lineIn('m1', 'c1', NOW - 2000), lineIn('m2', 'c2', NOW - 1000)] };
    const blocks = await materializeScreen({ screen: page, hostOps: {
      eventLog: log, circles: [both[0]], allCircles: both, myRefs: [], forYou: true, t, now: () => NOW,
      selfSet: { on: ['default'], held: [{ id: 'default' }, { id: 'werk', name: 'Werk' }] },
      profileIdOf: (cid) => (cid === 'c2' ? 'werk' : 'default'),
    } });
    const rows = blocks[0].content.items;
    expect(rows.map((r) => [r.id, r.self?.id])).toEqual([['m2', 'werk'], ['m1', 'default']]);
    expect(rows[0].self).toMatchObject({ name: 'Werk' });
    // one persona on the device: no face to tell rows apart, so none is carried
    const one = await materializeScreen({ screen: page, hostOps: { eventLog: log, circles: both, myRefs: [], forYou: true, t, now: () => NOW } });
    expect(one[0].content.items.every((r) => r.self == null)).toBe(true);
  });
  it('a direct message is under the persona the contact is filed under (its pair circle\'s), else the default', async () => {
    const { materializeScreen } = await import('../../src/v2/userScreenBlocks.js');
    const turn = (contactId, messageId, ts) => ({ contactId, origin: 'bot', ts, receivedAt: ts, messageId, text: 'hoi' });
    const blocks = await materializeScreen({ screen: page, hostOps: {
      eventLog: { query: () => [] }, circles, myRefs: [], forYou: true, t, now: () => NOW,
      turns: [turn('bea', 'd1', NOW - 2000), turn('cas', 'd2', NOW - 1000)],
      selfSet: { on: ['default'], held: [{ id: 'default' }, { id: 'werk', name: 'Werk' }] },
      profileIdOf: (cid) => (cid === 'pair-bea' ? 'werk' : 'default'),
      contactCircleOf: (id) => (id === 'bea' ? 'pair-bea' : null),
    } });
    expect(blocks[0].content.items.map((r) => [r.id, r.self?.id])).toEqual([['d2', 'default'], ['d1', 'werk']]);
    const nothing = await materializeScreen({ screen: page, hostOps: { eventLog: { query: () => [] }, circles, myRefs: [], forYou: true, t, now: () => NOW } });
    expect(nothing.map((b) => b.type)).toEqual(['circlesUnread']);
  });
});

describe('a join I admitted, signed with my per-circle address', () => {
  it('is a row named by the handle the joiner presented', () => {
    const join = { id: 's3', ts: NOW - 10, landedAt: NOW - 10, type: 'membership', circleId: 'c1',
      payload: { circleId: 'c1', body: { kind: 'join', subject: 'webid:cas', author: 'addr-my-circle', payload: { peerDisplay: 'Cas' } } } };
    const rows = notificationRows({ events: [join], circles, viewerIdIn: () => 'webid:me', myRefs: ['addr-my-circle'], t, now: NOW });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'joined' });
    expect(rows[0].text).toContain('Cas');
  });
});
