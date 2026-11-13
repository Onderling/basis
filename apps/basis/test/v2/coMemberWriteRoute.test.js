/**
 * WRITING TO A CO-MEMBER CONTACTEN SHOWS, WHO IS NOT IN MY BOOK (the send gate's ruling, 2026-11-12).
 *
 * Contacten merges the peer graph into the book's rows, so a person I share a circle with (the inviter, say) is shown
 * though I hold no card of theirs. Writing to them must never leave on my person key (that links my circle self to my
 * person). It goes to THEIR circle address in a circle we share, as MY circle self: circle traffic. Where no shared
 * circle names a proven address for them, the row says why it cannot be written to, and nothing is sent.
 */
import { describe, it, expect } from 'vitest';
import { withCoMemberRoutes } from '../../src/v2/contactsSource.js';

const ANN = 'ANN-PERSON-KEY';
const rows = [
  { contactId: ANN, name: 'Ann', peerAddr: ANN, isBot: false },                                  // from the peer graph
  { contactId: 'BOB', name: 'Bob', peerAddr: 'BOB', isBot: false, source: 'contact' },          // in my book
  { contactId: 'BOT', name: 'Bot', peerAddr: 'BOT', isBot: true },                               // a bot
  { contactId: 'CAROL', name: 'Carol', peerAddr: 'CAROL', isBot: false },                        // peer graph, no shared circle
];
const circles = { buren: [{ webid: ANN, circleAddress: 'ANN-IN-BUREN' }, { webid: 'BOB', circleAddress: 'BOB-IN-BUREN' }] };

describe('withCoMemberRoutes', () => {
  it('a peer-graph person is written to at their circle address in a shared circle; a kept contact and a bot as before', async () => {
    const out = await withCoMemberRoutes(rows, { circleIds: async () => Object.keys(circles), membersOf: async (c) => circles[c] ?? [] });
    const by = Object.fromEntries(out.map((r) => [r.contactId, r]));
    expect(by[ANN].writeTo).toEqual({ peerAddr: 'ANN-IN-BUREN', circleId: 'buren' });
    expect(by.BOB.writeTo, 'a kept contact keeps its own route').toBeUndefined();
    expect(by.BOT.writeTo).toBeUndefined();
  });

  it('a co-member no shared circle shows an address for: the row says why, and has no address to write to', async () => {
    const withCarol = { buren: [...circles.buren, { webid: 'CAROL' }] };
    const out = await withCoMemberRoutes(rows, { circleIds: async () => Object.keys(withCarol), membersOf: async (c) => withCarol[c] ?? [] });
    expect(out.find((r) => r.contactId === 'CAROL').writeTo).toEqual({ blocked: 'no-circle-address' });
  });

  it('someone who is no co-member (they wrote first through a link or a card) keeps the row\'s own road', async () => {
    const out = await withCoMemberRoutes(rows, { circleIds: async () => Object.keys(circles), membersOf: async (c) => circles[c] ?? [] });
    expect(out.find((r) => r.contactId === 'CAROL').writeTo).toBeUndefined();
  });

  it('a pair circle is not a shared circle for this (it is the kept contact\'s own road)', async () => {
    const out = await withCoMemberRoutes([rows[0]], { circleIds: async () => ['pair-xyz'], membersOf: async () => [{ webid: ANN, circleAddress: 'ANN-IN-PAIR' }], isPairCircle: (c) => c.startsWith('pair-') });
    expect(out[0].writeTo, 'no shared (non-pair) circle: no co-member route').toBeUndefined();
  });
});
