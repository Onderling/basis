/**
 * Vandaag's two news blocks split by WHAT a thing is (Frits 2026-11-19, option B): "Nieuw voor jou" holds only what is
 * addressed to the person, and ordinary conversation in a circle is counted only in "Kringen met nieuws". One predicate
 * decides "addressed to me" per row kind (`isAddressedToMe`, beside the notification projection), and both blocks read
 * the one "read on any device" rule (`unreadOnAnyDevice`), so no thing shows in both and marking it read clears it in both.
 */
import { describe, it, expect } from 'vitest';
import { isAddressedToMe, newsKindOf } from '../../src/v2/notifications.js';
import { unreadOnAnyDevice } from '../../src/v2/circleTilePreviews.js';
import { materializeScreen } from '../../src/v2/userScreenBlocks.js';
import { assignedEntryFor, landingEntryFor } from '../../src/v2/itemLanding.js';

const t = (k, v = {}) => `${k.split('.').pop()}${Object.keys(v).length ? ` ${JSON.stringify(v)}` : ''}`;
const NOW = Date.UTC(2026, 10, 20, 12);
const circles = [{ id: 'c1', name: 'Straat' }];
const line = (id, actor, at) => ({ id, ts: at, landedAt: at, type: 'chat-message', actor, payload: { circleId: 'c1', text: 'hoi' } });
const pu = (id, version, policy, at) => ({ id, ts: at, landedAt: at, type: 'governance', circleId: 'c1',
  payload: { circleId: 'c1', body: { kind: 'policy-update', author: 'admin', payload: { policy, version } } } });

describe('isAddressedToMe: the rule per row kind', () => {
  it('a direct message, something assigned to me, my ask, a join I admitted, my removal and my role change are mine', () => {
    for (const kind of ['dm', 'assigned', 'ask', 'joined', 'removed', 'role']) expect(isAddressedToMe({ kind }), kind).toBe(true);
  });
  it('a changed setting only when it changes what I may do (a feature or a rule), not a name or a colour', () => {
    expect(isAddressedToMe({ kind: 'setting', mayDo: true })).toBe(true);
    expect(isAddressedToMe({ kind: 'setting', mayDo: false })).toBe(false);
  });
  it('an ordinary line and an item in a circle are conversation: "Kringen met nieuws" counts them', () => {
    expect(isAddressedToMe({ kind: 'line' })).toBe(false);
    expect(isAddressedToMe({ kind: 'item' })).toBe(false);
    expect(isAddressedToMe(null)).toBe(false);
  });
  it('the row kind of a counted circle event: an assignment, an item, a line', () => {
    const assigned = assignedEntryFor({ circleId: 'c1', item: { id: 't1', type: 'task', assignees: ['me'] }, self: 'me', authorRef: 'bea', now: NOW });
    expect(assigned, 'the fixture is an assignment').toBeTruthy();
    expect(newsKindOf(assigned)).toBe('assigned');
    expect(newsKindOf(landingEntryFor({ circleId: 'c1', item: { id: 'p1', type: 'request', createdAt: NOW, source: { from: 'b' } }, now: NOW }))).toBe('item');
    expect(newsKindOf(line('m1', 'b', NOW))).toBe('line');
  });
});

describe('the read rule both blocks read', () => {
  it('unread = landed inside the window and read on none of my devices', () => {
    expect(unreadOnAnyDevice({ id: 'x', landedAt: NOW }, { readIds: new Set(), since: NOW - 1 })).toBe(true);
    expect(unreadOnAnyDevice({ id: 'x', landedAt: NOW }, { readIds: new Set(['x']) })).toBe(false);
    expect(unreadOnAnyDevice({ id: 'x', landedAt: NOW - 10 }, { since: NOW })).toBe(false);
    expect(unreadOnAnyDevice({ id: 'x', landedAt: NOW })).toBe(true);
  });
});

describe('Vandaag: no thing in both blocks, and read clears it in both', () => {
  const assigned = { ...assignedEntryFor({ circleId: 'c1', item: { id: 't1', type: 'task', assignees: ['me'] }, self: 'me', authorRef: 'bea', now: NOW - 3000 }), landedAt: NOW - 3000 };
  const events = [
    line('m1', 'bea', NOW - 1000),                                   // conversation
    assigned,                                                        // addressed to me, and an item landing the tile counts
    pu('p1', 1, { features: { roster: true }, name: 'Straat' }, NOW - 5000),
    pu('p2', 2, { features: { roster: true }, name: 'De straat' }, NOW - 4000),   // a name: not what I may do
    pu('p3', 3, { features: { roster: false }, name: 'De straat' }, NOW - 2000),  // a feature off: what I may do
  ];
  const turns = [{ contactId: 'bea', origin: 'bot', ts: NOW - 500, receivedAt: NOW - 500, messageId: 'd1', text: 'hallo' }];
  const page = { id: 's', name: 'Vandaag', circleFilter: null, blocks: [{ id: 'x', type: 'circlesUnread', config: {} }] };
  const read = async (readIds) => {
    const blocks = await materializeScreen({ screen: page, hostOps: {
      eventLog: { query: () => events }, circles, turns, myRefs: ['me'], readIds, seenAt: {}, forYou: true, t, now: () => NOW, selfIn: () => 'me',
    } });
    const forYou = blocks.find((b) => b.type === 'forYou')?.content.items ?? [];
    const circlesBlock = blocks.find((b) => b.type === 'circlesUnread');
    return { forYou, circlesBlock };
  };

  it('"Nieuw voor jou" holds the message, the assignment and the setting that changes what I may do; the circle block the line', async () => {
    const { forYou, circlesBlock } = await read(new Set());
    expect(forYou.map((r) => [r.kind, r.id]).sort()).toEqual([['assigned', assigned.id], ['dm', 'd1'], ['setting', 'p3']]);
    const [row] = circlesBlock.content.items;
    expect(row.unread, 'the line only: the assignment is "Nieuw voor jou"\'s').toBe(1);
    const inCircles = new Set(row.unreadIds.map((x) => x.id));
    expect(forYou.flatMap((r) => r.ids.map((x) => x.id)).filter((id) => inCircles.has(id))).toEqual([]);
  });

  it('marking each read (on any device) clears it from the block it was in, and it appears in no other', async () => {
    const { forYou, circlesBlock } = await read(new Set(['m1', assigned.id, 'd1', 'p3']));
    expect(forYou).toEqual([]);
    expect(circlesBlock.status).toBe('empty');
  });
});

describe('my role changed is a row of its own', () => {
  it('someone made me admin: a "role" row, addressed to me; a role change about another member is no row', async () => {
    const { notificationRows } = await import('../../src/v2/notifications.js');
    const role = (id, subject, role) => ({ id, ts: NOW - 100, landedAt: NOW - 100, type: 'membership', circleId: 'c1',
      payload: { circleId: 'c1', body: { kind: 'role', subject, author: 'admin', payload: { role } } } });
    const rows = notificationRows({ events: [role('r1', 'me', 'admin'), role('r2', 'cas', 'admin')], circles, viewerIdIn: () => 'me', myRefs: ['me'], t, now: NOW });
    expect(rows.map((r) => [r.kind, r.id])).toEqual([['role', 'r1']]);
    expect(isAddressedToMe(rows[0])).toBe(true);
    expect(rows[0].text).toMatch(/you_are_now_admin/);
  });
});
