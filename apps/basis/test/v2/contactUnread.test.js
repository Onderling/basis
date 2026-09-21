/**
 * Unread on Contacten (Frits 2026-09-21: "maybe add some 'new message' visual to the contacts frame too — right now I
 * have to check each contact all the time"). One shared builder, as the circle tiles have: per contact, the inbound
 * turns newer than the moment the person last opened that thread; the tab shows the sum. The seen-marks live on the
 * device (a view fact), read through an injected io so web (localStorage) and mobile (AsyncStorage) share the code.
 */
import { describe, it, expect } from 'vitest';
import { buildContactUnread, totalUnread, makeContactSeenStore, CONTACT_SEEN_KEY } from '../../src/v2/contactUnread.js';

const turns = [
  { contactId: 'bea', origin: 'bot',  ts: 100 },
  { contactId: 'bea', origin: 'user', ts: 150 },   // mine — never unread
  { contactId: 'bea', origin: 'bot',  ts: 200 },
  { contactId: 'cas', origin: 'bot',  ts: 50 },
  { contactId: 'cas', origin: 'bot',  ts: 60, returned: true },
  { origin: 'bot', ts: 999 },                        // no contact — ignored
];

describe('buildContactUnread', () => {
  it('counts the inbound turns newer than the contact\'s seen-mark; a never-opened thread counts them all', () => {
    expect(buildContactUnread({ turns, seenAt: { bea: 120 } })).toEqual({ bea: { unread: 1, lastTs: 200 }, cas: { unread: 2, lastTs: 60 } });
    expect(buildContactUnread({ turns, seenAt: { bea: 200, cas: 60 } })).toEqual({ bea: { unread: 0, lastTs: 200 }, cas: { unread: 0, lastTs: 60 } });
    expect(buildContactUnread({ turns: [], seenAt: {} })).toEqual({});
  });
  it('the tab shows the sum', () => {
    expect(totalUnread(buildContactUnread({ turns, seenAt: {} }))).toBe(4);
    expect(totalUnread({})).toBe(0);
  });
});

describe('makeContactSeenStore — the seen-marks on the device, one code for both shells', () => {
  const memIo = () => { const m = new Map(); return { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, v); } }; };
  it('reads an empty map, marks a contact seen at a moment, keeps the newest mark, survives a bad value', async () => {
    const io = memIo(); const store = makeContactSeenStore(io);
    expect(await store.read()).toEqual({});
    await store.mark('bea', 200);
    await store.mark('bea', 150);   // older news never moves the mark back
    await store.mark('cas', 60);
    expect(await store.read()).toEqual({ bea: 200, cas: 60 });
    expect(JSON.parse(await io.getItem(CONTACT_SEEN_KEY))).toEqual({ bea: 200, cas: 60 });
    await io.setItem(CONTACT_SEEN_KEY, 'not json');
    expect(await store.read()).toEqual({});
  });
  it('works over a SYNC io (web localStorage) too', async () => {
    const m = new Map(); const store = makeContactSeenStore({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } });
    await store.mark('bea', 5);
    expect(await store.read()).toEqual({ bea: 5 });
  });
});
