/**
 * An item landing: one silent reference entry per fresh row from someone else, read by the one news projection.
 */
import { describe, it, expect } from 'vitest';
import { landingEntryFor, landingKindOf, isItemLanding, ITEM_LANDED } from '../../src/v2/itemLanding.js';
import { buildTilePreviews } from '../../src/v2/circleTilePreviews.js';
import { entryKind, LANE } from '@onderling/item-store';

const post = { id: 'p1', type: 'request', body: 'fp1:sealedwords', source: { from: 'addr-b' } };

describe('landingEntryFor', () => {
  it('a fresh post from someone else is one reference: circle, item, kind, author; no words, no envelope', () => {
    const e = landingEntryFor({ circleId: 'c1', item: post, fresh: true, self: 'addr-a', now: 500 });
    expect(e).toMatchObject({ type: ITEM_LANDED, circleId: 'c1', actor: 'addr-b', ts: 500, silent: true,
      payload: { circleId: 'c1', itemId: 'p1', kind: 'ask' } });
    expect(JSON.stringify(e)).not.toContain('fp1:');
    expect(isItemLanding(e)).toBe(true);
  });
  it('an update, my own row, a row without an author, or a system document is no landing', () => {
    expect(landingEntryFor({ circleId: 'c1', item: post, fresh: false })).toBeNull();
    expect(landingEntryFor({ circleId: 'c1', item: post, self: 'addr-b' })).toBeNull();
    expect(landingEntryFor({ circleId: 'c1', item: { id: 'p2', type: 'request' } })).toBeNull();
    expect(landingEntryFor({ circleId: 'c1', item: { id: 'r', type: 'group-rules', createdBy: 'addr-b' } })).toBeNull();
  });
  it('an appointment and a lend land by their own kind', () => {
    expect(landingKindOf({ id: 'e', type: 'calendar-event' })).toBe('calendar-event');
    expect(landingKindOf({ id: 'l', type: 'offer', kind: 'lend' })).toBe('lend');
  });
  it('the dictionary knows the kind: system lane, never painted as conversation', () => {
    expect(entryKind(ITEM_LANDED).lane).toBe(LANE.SYSTEM);
    expect(entryKind(ITEM_LANDED).registered ?? true).toBe(true);
  });
});

describe('the news projection reads landings', () => {
  const circles = [{ id: 'c1' }];
  const chat = { id: 'm1', ts: 100, type: 'chat-message', actor: 'addr-b', payload: { circleId: 'c1', text: 'hallo' } };
  const landed = landingEntryFor({ circleId: 'c1', item: post, self: 'addr-a', now: 200 });
  const notice = { id: 'n1', ts: 300, app: 'pinboard', type: 'notification', actor: 'addr-b',
    payload: { groupId: 'c1', circleId: 'c1', message: '📥 borrow in c1: fp1:sealedwords' } };

  it('a landed post counts as news beside a chat line, by the log time it landed', () => {
    const out = buildTilePreviews({ events: [chat, landed], circles, seenAt: { c1: 50 }, myRefs: ['addr-a'] });
    expect(out.c1.unread).toBe(2);
    expect(buildTilePreviews({ events: [chat, landed], circles, seenAt: { c1: 150 }, myRefs: ['addr-a'] }).c1.unread).toBe(1);
  });
  it('a landing of my own (another device of mine) is not news', () => {
    const out = buildTilePreviews({ events: [landed], circles, seenAt: {}, myRefs: ['addr-b'] });
    expect(out.c1.unread).toBe(0);
  });
  it('the tile subtitle never reads a system row: no notification message, no ids, no envelope', () => {
    const out = buildTilePreviews({ events: [chat, landed, notice], circles, seenAt: {}, myRefs: [] });
    expect(out.c1.subtitle ?? '').not.toMatch(/fp1:|📥|c1/);
    expect(out.c1.ts).toBe(200);
  });
});

describe('one landing per row, and a removed row leaves the news', () => {
  it('the device log keeps one landing per circle+item, and a removal mark takes it out of the count', async () => {
    const { EventLog } = await import('../../src/eventLog.js');
    const { landingIdOf, markLandingRemoved } = await import('../../src/v2/itemLanding.js');
    const log = new EventLog();
    const e = landingEntryFor({ circleId: 'c1', item: post });
    log.append(e);
    expect(log.query().filter((x) => x.id === landingIdOf('c1', 'p1'))).toHaveLength(1);
    const count = () => buildTilePreviews({ events: log.query(), circles: [{ id: 'c1' }], seenAt: {}, myRefs: [] }).c1.unread;
    expect(count()).toBe(1);
    log.compactEntries([landingIdOf('c1', 'p1')], markLandingRemoved);
    expect(count()).toBe(0);
  });
});

describe('a row of news carries what is new by kind', () => {
  it('a chat line and a landed ask: both kinds, as the vocabulary icons', async () => {
    const { newsKindIcons } = await import('../../src/v2/embedChips.js');
    const chat = { id: 'm1', ts: 100, type: 'chat-message', actor: 'addr-b', payload: { circleId: 'c1', text: 'hallo' } };
    const landed = landingEntryFor({ circleId: 'c1', item: post, now: 200 });
    const out = buildTilePreviews({ events: [chat, landed], circles: [{ id: 'c1' }], seenAt: {}, myRefs: [] });
    expect(out.c1.kinds).toEqual(['ask', 'chat-message']);
    expect(newsKindIcons(out.c1.kinds)).toBe('🙋 💬');
    expect(newsKindIcons(['circle-post', 'chat-message', 'message'])).toBe('💬');
  });
});

describe('an appointment written on its maker\'s device says "me": the statement names the author', () => {
  it('a local stamp names nobody; the snapshot\'s author address does', () => {
    const appt = { id: 'e1', type: 'calendar-event', createdBy: 'me' };
    expect(landingEntryFor({ circleId: 'c1', item: appt })).toBeNull();
    expect(landingEntryFor({ circleId: 'c1', item: appt, authorRef: 'addr-b' })).toMatchObject({ actor: 'addr-b', payload: { kind: 'calendar-event' } });
    expect(landingEntryFor({ circleId: 'c1', item: appt, authorRef: 'addr-a', self: 'addr-a' })).toBeNull();
  });
});
