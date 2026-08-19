/**
 * reciprocity (chat-off consumer-side) tests.
 *
 * Map-backed IO drives the queue without touching real storage.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  isRecipientUnavailable, buildUnavailableNotice,
  createMessageQueue, RECIPROCITY_STORE_KEY,
} from '../../src/v2/reciprocity.js';

function makeIo(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    load: (k) => (map.has(k) ? map.get(k) : null),
    save: (k, v) => { map.set(k, v); },
  };
}

describe('isRecipientUnavailable', () => {
  it('returns available when getRecipientChatOff says false', async () => {
    const out = await isRecipientUnavailable({
      recipientId: 'bob', circleId: 'selwerd',
      getRecipientChatOff: async () => false,
    });
    expect(out).toEqual({ available: true, reason: null });
  });

  it('returns unavailable with reason=chat-off when getRecipientChatOff says true', async () => {
    const out = await isRecipientUnavailable({
      recipientId: 'bob', circleId: 'selwerd',
      getRecipientChatOff: async () => true,
    });
    expect(out).toEqual({ available: false, reason: 'chat-off' });
  });

  it('defaults to available when no accessor is wired (substrate missing)', async () => {
    const out = await isRecipientUnavailable({ recipientId: 'bob', circleId: 'c' });
    expect(out).toEqual({ available: true, reason: null });
  });

  it('treats a throwing accessor as available (fail-open per design)', async () => {
    const out = await isRecipientUnavailable({
      recipientId: 'bob', circleId: 'c',
      getRecipientChatOff: async () => { throw new Error('peer ping down'); },
    });
    expect(out).toEqual({ available: true, reason: null });
  });

  it('treats non-boolean response as available', async () => {
    const out = await isRecipientUnavailable({
      recipientId: 'bob', circleId: 'c',
      getRecipientChatOff: async () => 'maybe',
    });
    expect(out.available).toBe(true);
  });

  it('defaults to available when recipientId or circleId is missing', async () => {
    const a = await isRecipientUnavailable({ recipientId: '',    circleId: 'c', getRecipientChatOff: () => true });
    const b = await isRecipientUnavailable({ recipientId: 'bob', circleId: '',  getRecipientChatOff: () => true });
    expect(a).toEqual({ available: true, reason: null });
    expect(b).toEqual({ available: true, reason: null });
  });

  it('passes the query through to the accessor verbatim', async () => {
    const spy = vi.fn().mockResolvedValue(false);
    await isRecipientUnavailable({ recipientId: 'bob', circleId: 'selwerd', getRecipientChatOff: spy });
    expect(spy).toHaveBeenCalledWith({ recipientId: 'bob', circleId: 'selwerd' });
  });
});

describe('buildUnavailableNotice', () => {
  const t = (key, vars = {}) => {
    if (key === 'circle.reciprocity.unavailable')
      return `${vars.name} doesn't receive chat in ${vars.circle}.`;
    if (key === 'circle.reciprocity.unavailable_anon')
      return `This person doesn't receive chat in this circle.`;
    return key;
  };

  it('renders the named form when both name + circle are present', () => {
    const s = buildUnavailableNotice({ recipientName: 'Bob', circleName: 'Selwerd', t });
    expect(s).toBe(`Bob doesn't receive chat in Selwerd.`);
  });

  it('falls back to the anon form when name or circle is missing', () => {
    expect(buildUnavailableNotice({ recipientName: 'Bob', t })).toMatch(/This person/);
    expect(buildUnavailableNotice({ circleName: 'Selwerd', t })).toMatch(/This person/);
    expect(buildUnavailableNotice({ t })).toMatch(/This person/);
  });

  it('uses key identity when no translator is supplied', () => {
    const s = buildUnavailableNotice({ recipientName: 'Bob', circleName: 'Selwerd' });
    expect(s).toBe('circle.reciprocity.unavailable');
  });
});

describe('createMessageQueue', () => {
  it('throws when io is missing load/save', () => {
    expect(() => createMessageQueue({})).toThrow(/io must provide load \+ save/);
  });

  it('add → listFor round-trips a queued message scoped to (recipient, circle)', async () => {
    const io = makeIo();
    const q = createMessageQueue({ io });
    const m = await q.add({
      recipientId: 'bob', circleId: 'selwerd',
      text: 'Hoi Bob, ik wou je nog vragen of je morgenavond…',
      savedAt: 100,
    });
    expect(m.id).toMatch(/^wq-/);
    expect((await q.listFor('bob', 'selwerd')).map((m) => m.text)).toEqual([m.text]);
    expect(await q.listFor('bob', 'huisgenoten')).toEqual([]);  // scoping
    expect(await q.listFor('alice', 'selwerd')).toEqual([]);
  });

  it('trims input + rejects empty / non-string text', async () => {
    const q = createMessageQueue({ io: makeIo() });
    const m = await q.add({ recipientId: 'bob', circleId: 'c', text: '   hi   ' });
    expect(m.text).toBe('hi');
    await expect(q.add({ recipientId: 'bob', circleId: 'c', text: '   ' }))
      .rejects.toThrow(/non-empty text/);
    await expect(q.add({ recipientId: 'bob', circleId: 'c' }))
      .rejects.toThrow(/non-empty text/);
  });

  it('requires recipientId + circleId on add', async () => {
    const q = createMessageQueue({ io: makeIo() });
    await expect(q.add({ circleId: 'c', text: 'x' })).rejects.toThrow(/recipientId required/);
    await expect(q.add({ recipientId: 'bob', text: 'x' })).rejects.toThrow(/circleId required/);
  });

  it('listFor sorts oldest first', async () => {
    const q = createMessageQueue({ io: makeIo() });
    await q.add({ recipientId: 'bob', circleId: 'c', text: 'mid',   savedAt: 200 });
    await q.add({ recipientId: 'bob', circleId: 'c', text: 'old',   savedAt: 100 });
    await q.add({ recipientId: 'bob', circleId: 'c', text: 'fresh', savedAt: 300 });
    const list = await q.listFor('bob', 'c');
    expect(list.map((m) => m.text)).toEqual(['old', 'mid', 'fresh']);
  });

  it('remove drops by id and cleans up the bucket when empty', async () => {
    const io = makeIo();
    const q = createMessageQueue({ io });
    const a = await q.add({ recipientId: 'bob', circleId: 'c', text: 'a' });
    const b = await q.add({ recipientId: 'bob', circleId: 'c', text: 'b' });
    await q.remove(a.id);
    expect((await q.listFor('bob', 'c')).map((m) => m.id)).toEqual([b.id]);
    await q.remove(b.id);
    expect(await q.listFor('bob', 'c')).toEqual([]);
    expect(io.map.get(RECIPROCITY_STORE_KEY)?.['c:bob']).toBeUndefined();
  });

  it('countFor returns the bucket size', async () => {
    const q = createMessageQueue({ io: makeIo() });
    await q.add({ recipientId: 'bob', circleId: 'c', text: 'a' });
    await q.add({ recipientId: 'bob', circleId: 'c', text: 'b' });
    expect(await q.countFor('bob', 'c')).toBe(2);
    expect(await q.countFor('alice', 'c')).toBe(0);
  });

  it('flushFor returns + clears the bucket atomically', async () => {
    const io = makeIo();
    const q = createMessageQueue({ io });
    await q.add({ recipientId: 'bob', circleId: 'c', text: 'one', savedAt: 100 });
    await q.add({ recipientId: 'bob', circleId: 'c', text: 'two', savedAt: 200 });
    const flushed = await q.flushFor('bob', 'c');
    expect(flushed.map((m) => m.text)).toEqual(['one', 'two']);
    expect(await q.listFor('bob', 'c')).toEqual([]);
  });

  it('flushFor on empty bucket returns [] and doesn\'t write', async () => {
    const io = makeIo();
    const writeSpy = vi.spyOn(io, 'save');
    const q = createMessageQueue({ io });
    expect(await q.flushFor('bob', 'c')).toEqual([]);
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
