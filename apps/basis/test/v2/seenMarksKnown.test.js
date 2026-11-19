/**
 * The seen-marks: never written from a map that was not loaded (ledger L1085), and "not known yet" through the
 * projections (no unread count, never "everything unread"). Then sealed at rest (ledger L1083).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { groupKeyStrategy } from '@onderling/pod-client';
import { setShellContentSeal } from '../../src/v2/localStoreSeal.js';
import { createCircleSeenMarks, circleSeenMarksIo } from '../../src/v2/circleSeenMarks.js';
import { bumpSeenAt, buildTilePreviews } from '../../src/v2/circleTilePreviews.js';
import { buildContactUnread, sealedContactSeenStore } from '../../src/v2/contactUnread.js';
import { createCirclePinStore, localStoragePinIo } from '../../src/v2/circlePinStore.js';
import { materializeScreen } from '../../src/v2/userScreenBlocks.js';

afterEach(() => setShellContentSeal(null));
const KEY = Buffer.from(new Uint8Array(32).fill(9)).toString('base64url');
const seal = () => setShellContentSeal(groupKeyStrategy({ groupKey: KEY }));
function storage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, _m: m };
}

describe('L1085: a mark is never written from a map that was not loaded', () => {
  it('the old inline shape loses the stored marks (what the phone did): bump({}, id) written over them', () => {
    const stored = { a: 100, b: 200 };
    const heldBeforeLoad = {};                       // the phone's initial state
    const written = bumpSeenAt(heldBeforeLoad, 'c', 300);
    expect(written).toEqual({ c: 300 });             // a and b are gone from what would be written
    expect(Object.keys(written)).not.toContain('a');
    expect(stored.a).toBe(100);
  });

  it('an open before the load is remembered, applied to the loaded map, and nothing is written before', async () => {
    const saves = [];
    const marks = createCircleSeenMarks({ load: async () => ({ a: 100, b: 200 }), save: async (m) => { saves.push(m); } });
    expect(marks.current()).toBeNull();
    expect(await marks.open('c', 300)).toBeNull();
    expect(saves).toEqual([]);
    expect(await marks.load()).toEqual({ a: 100, b: 200, c: 300 });
    expect(saves).toEqual([{ a: 100, b: 200, c: 300 }]);
  });

  it('a load with nothing pending writes nothing; an open after the load bumps the loaded map', async () => {
    const saves = [];
    const marks = createCircleSeenMarks({ load: async () => ({ a: 100 }), save: async (m) => { saves.push(m); } });
    await marks.load();
    expect(saves).toEqual([]);
    await marks.open('b', 400);
    expect(saves).toEqual([{ a: 100, b: 400 }]);
  });
});

describe('not known yet, through the projections', () => {
  const events = [{ id: 'e1', ts: 500, landedAt: 500, type: 'chat-message', actor: 'addr-b', payload: { circleId: 'c1', text: 'hoi' } }];
  it('buildTilePreviews: seenAt null gives no unread; {} keeps today\'s behaviour', () => {
    const unknown = buildTilePreviews({ events, circles: [{ id: 'c1' }], seenAt: null, myRefs: ['me'] });
    expect(unknown.c1.unread).toBe(0);
    expect(unknown.c1.unreadIds).toEqual([]);
    const known = buildTilePreviews({ events, circles: [{ id: 'c1' }], seenAt: {}, myRefs: ['me'] });
    expect(known.c1.unread).toBe(1);
  });

  it('Today\'s circles-with-news block: seenAt null lists nothing and says nothing; {} lists the circle', async () => {
    const hostOps = (seenAt) => ({ circles: [{ id: 'c1', name: 'Huis' }], eventLog: { query: () => events }, seenAt, myRefs: ['me'], myWebid: 'me' });
    const screen = { blocks: [{ id: 'n', type: 'circlesUnread' }] };
    const [unknown] = await materializeScreen({ screen, hostOps: hostOps(null) });
    expect(unknown.content.items).toEqual([]);
    expect(unknown.content.marksNotKnown).toBe(true);
    expect(unknown.content.quiet).toBeUndefined();   // not "nothing new in Huis" either
    const [known] = await materializeScreen({ screen, hostOps: hostOps({}) });
    expect(known.content.items.map((r) => r.circleId)).toEqual(['c1']);
  });

  it('buildContactUnread: seenAt null gives no unread; {} keeps today\'s behaviour', () => {
    const turns = [{ contactId: 'k1', origin: 'peer', ts: 500, messageId: 'm1' }];
    expect(buildContactUnread({ turns, seenAt: null }).k1.unread).toBe(0);
    expect(buildContactUnread({ turns, seenAt: {} }).k1.unread).toBe(1);
  });
});

describe('sealed at rest', () => {
  it('cc.circleSeenAt: not readable as stored; read back with the key', async () => {
    seal();
    const s = storage();
    const marks = createCircleSeenMarks(circleSeenMarksIo(s));
    await marks.load();
    await marks.open('circle-of-henk', 1);
    expect([...s._m.values()].join()).not.toContain('circle-of-henk');
    expect(await createCircleSeenMarks(circleSeenMarksIo(s)).load()).toEqual({ 'circle-of-henk': 1 });
  });

  it('cc.contactSeenAt: not readable as stored; before the key a read is null (not "nothing seen") and a mark waits', async () => {
    seal();
    const s = storage();
    await sealedContactSeenStore(s).mark('contact-henk', 5);
    const before = s._m.get('cc.contactSeenAt');
    expect(before).not.toContain('contact-henk');
    setShellContentSeal(null);
    expect(await sealedContactSeenStore(s).read()).toBeNull();
    const m = sealedContactSeenStore(s).mark('contact-piet', 6);
    await new Promise((res) => { setTimeout(res, 20); });
    expect(s._m.get('cc.contactSeenAt')).toBe(before);   // nothing written before the key
    seal();
    await m;
    expect(await sealedContactSeenStore(s).read()).toEqual({ 'contact-henk': 5, 'contact-piet': 6 });
  });

  it('cc.circlePinned: not readable as stored; a read before the key waits', async () => {
    seal();
    const s = storage();
    await createCirclePinStore(localStoragePinIo(s)).toggle?.('circle-of-henk') ?? createCirclePinStore(localStoragePinIo(s)).set?.('circle-of-henk', true);
    expect([...s._m.values()].join()).not.toContain('circle-of-henk');
    setShellContentSeal(null);
    let pins = null;
    const r = createCirclePinStore(localStoragePinIo(s)).get().then((v) => { pins = v; });
    await new Promise((res) => { setTimeout(res, 20); });
    expect(pins).toBeNull();
    seal();
    await r;
    expect(pins['circle-of-henk']).toBe(true);
  });
});
