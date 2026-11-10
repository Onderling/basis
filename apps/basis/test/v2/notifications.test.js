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

describe('one rule for what is news: the tile and "Nieuw voor jou" agree', () => {
  it('every event the tile counts is a row; the only rows the tile does not count are a join I admitted and my removal', async () => {
    const { buildTilePreviews } = await import('../../src/v2/circleTilePreviews.js');
    const botLine = { id: 'b1', ts: NOW - 900, landedAt: NOW - 900, type: 'chat-message', actor: 'bot', payload: { circleId: 'c1', text: 'vuilnis is morgen' } };
    const myWizard = { id: 'b2', ts: NOW - 800, landedAt: NOW - 800, type: 'chat-message', actor: 'bot', payload: { circleId: 'c1', text: 'welkom', scope: 'self' } };
    const events = [botLine, myWizard, line('m1', 'b', NOW - 700, NOW - 700), line('m2', 'me', NOW - 600, NOW - 600)];
    const tile = buildTilePreviews({ events, circles, myRefs: ['me'] }).c1;
    const rows = notificationRows({ events, circles, myRefs: ['me'], t, now: NOW });
    expect(rows.map((r) => r.id).sort()).toEqual(tile.unreadIds.map((x) => x.id).sort());
    expect(rows.map((r) => r.id)).toContain('b1');   // a household bot's line raises the badge, so it is news here too
  });
});

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
  it('my removal is a row though the circle has already left my list (it opens Today, the circle is gone)', () => {
    // as the two-browser walk found it: the evict about me lands, the circle leaves listMyCircles at once
    const evict = { id: 's3', ts: NOW - 50, landedAt: NOW - 50, type: 'membership', circleId: 'gone', payload: { circleId: 'gone', body: { kind: 'evict', subject: 'B-key', author: 'admin' } } };
    const lineThere = { ...line('m9', 'x', NOW - 40, NOW - 40), payload: { circleId: 'gone', text: 'na je vertrek' } };
    const rows = notificationRows({ events: [evict, lineThere], circles, myRefs: ['me', 'B-key'], t, now: NOW });
    expect(rows.map((r) => [r.kind, r.open])).toEqual([['removed', null]]);
    expect(rows[0].text).toMatch(/a_circle/);
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

describe('the person\'s table decides what is a row: banner > list > off', () => {
  it('banner and list keep the row on Today; off drops it from "Nieuw voor jou"', async () => {
    const { forYouRows } = await import('../../src/v2/userScreenBlocks.js');
    const turns = [{ contactId: 'bea', origin: 'bot', ts: NOW - 1000, receivedAt: NOW - 1000, messageId: 'd1', text: 'hallo' }];
    const rows = (policy) => forYouRows({ eventLog: { query: () => [] }, circles, turns, myRefs: [], t, now: () => NOW, notifyPolicyOf: (k) => (k === 'dm' ? policy : undefined) });
    expect(rows('banner').map((r) => r.id)).toEqual(['d1']);
    expect(rows('list').map((r) => r.id)).toEqual(['d1']);
    expect(rows('off').map((r) => r.id)).toEqual([]);
  });
});

describe('a setting someone else changed is a row ("Een beheerder zette … uit")', () => {
  const pu = (id, author, version, policy, at) => ({ id, ts: at, landedAt: at, type: 'governance', circleId: 'c1',
    payload: { circleId: 'c1', body: { kind: 'policy-update', author, payload: { policy, version } } } });
  it('the change between two versions, in the settings screen\'s own words; the first version and my own changes are no row', () => {
    const v1 = pu('p1', 'admin', 1, { features: { roster: true }, revealPolicy: 'pairwise' }, NOW - 3000);
    const v2 = pu('p2', 'admin', 2, { features: { roster: false }, revealPolicy: 'pairwise' }, NOW - 2000);
    const mine = pu('p3', 'me', 3, { features: { roster: false }, revealPolicy: 'open' }, NOW - 1000);
    const rows = notificationRows({ events: [v1, v2, mine], circles, myRefs: ['me'], t, now: NOW });
    expect(rows.map((r) => [r.kind, r.id])).toEqual([['setting', 'p2']]);
    expect(rows[0].text).toMatch(/^setting .*change_off/);
    expect(rows[0].open).toEqual({ kind: 'circle', id: 'c1' });
  });
});

describe('my open question in the room is a row while it is open (the way back to it)', () => {
  it('one row per live ask, saying how many heard it, opening Nearby; gone when it is no longer live', () => {
    const asks = [{ ask: { id: 'a1', text: 'wie heeft een ladder?', createdAt: NOW - 60_000, expiresAt: NOW + 60_000 }, heard: 2 },
      { ask: { id: 'a0', text: 'oud', createdAt: NOW - 9e6, expiresAt: NOW - 1 }, heard: 1 }];
    const rows = notificationRows({ asks, circles, t, now: NOW });
    expect(rows.map((r) => [r.kind, r.id, r.open])).toEqual([['ask', 'ask:a1', { kind: 'nearby', id: 'room' }]]);
    expect(rows[0].text).toMatch(/^ask .*ladder.*"heard":2/);
  });
});
