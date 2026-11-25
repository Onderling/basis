/**
 * A TORN SEEN-MARKS MAP IS KEPT: a mark does not write a one-contact map over it.
 *
 * The contact seen-marks read a value that did not parse as `{}`, and the next `mark` wrote a map holding only the
 * contact just opened over every other mark: every other conversation unread again. Now the value is kept, the mark
 * writes nothing, and it is said (kind messages).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { notReadableStores, resetNotReadableStores } from '@onderling/local-store';
import { makeContactSeenStore, CONTACT_SEEN_KEY } from '../../src/v2/contactUnread.js';

describe('the contact seen-marks keep a torn map', () => {
  beforeEach(() => resetNotReadableStores());
  it('a mark over a torn map writes nothing, and it is said', async () => {
    const m = new Map([[CONTACT_SEEN_KEY, '{"anna": 1700000000000, "be']]);
    const io = { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, v); } };
    const seen = makeContactSeenStore(io);
    await seen.mark('carla', 1800000000000);
    expect(m.get(CONTACT_SEEN_KEY)).toBe('{"anna": 1700000000000, "be');
    expect(notReadableStores().map((s) => s.kind)).toEqual(['messages']);
  });
  it('a readable map marks as before', async () => {
    const m = new Map([[CONTACT_SEEN_KEY, '{"anna": 1}']]);
    const io = { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, v); } };
    await makeContactSeenStore(io).mark('carla', 5);
    expect(JSON.parse(m.get(CONTACT_SEEN_KEY))).toEqual({ anna: 1, carla: 5 });
  });
});
