/**
 * Who a bubble says it is from.
 *
 * The rule under test is not cosmetic: the app writes bubbles too (a command reply, a caretaker notice,
 * "an admin removed you"), and those carried the same "unknown member" label as a person the roster
 * cannot vouch for. So the circle spoke to people as a stranger nobody could place — worst exactly where
 * the sentence underneath matters most.
 */
import { describe, it, expect } from 'vitest';
import { stampSenderLabels, BOT_ACTOR } from '../../src/v2/circleStream.js';

const ME = 'webid:me';
const THEM = 'webid:them';
const members = [{ id: THEM, webid: THEM, handle: 'frits' }];

const stamp = (rows) => stampSenderLabels(rows, { members, viewerId: ME, policy: 'open' });

describe('sender labels', () => {
  it('gives the app its own voice, never the unknown-member label', () => {
    const [row] = stamp([{ actor: BOT_ACTOR, text: 'je bent verwijderd' }]);
    expect(row.senderLabelKey).toBe('circle.chat.app_sender');
    expect(row.senderSelf, 'an app line is not the viewer\'s own — it must not right-align').toBe(false);
  });

  it('recognises the app actor on the EVENT too, not only the row', () => {
    const [row] = stamp([{ event: { actor: BOT_ACTOR }, text: 'hoi' }]);
    expect(row.senderLabelKey).toBe('circle.chat.app_sender');
  });

  it('still says "unknown" for a PERSON the roster cannot vouch for', () => {
    // This is the protective case and must survive: a name off the wire is never shown.
    const [row] = stamp([{ actor: 'webid:stranger', text: 'hallo' }]);
    expect(row.senderLabelKey).toBe('circle.chat.unknown_sender');
  });

  it('the app and an unresolvable member can never render the same', () => {
    const [bot, stranger] = stamp([{ actor: BOT_ACTOR }, { actor: 'webid:stranger' }]);
    expect(bot.senderLabelKey).not.toBe(stranger.senderLabelKey);
  });

  it('leaves a resolved member and the viewer alone', () => {
    const [them, mine] = stamp([{ actor: THEM }, { actor: ME }]);
    expect(them.senderLabel).toBe('@frits');
    expect(mine.senderSelf).toBe(true);
  });
});

describe('one member, every address they can speak from (Frits 2026-09-03: keyed by identity)', () => {
  // A member may hold several PROVEN per-circle addresses, and their canonical key still reaches them.
  // Indexing only the address recorded first made the same person read as `unknown_sender` the moment
  // they spoke from another of their own — the circle-side face of the two-threads bug walked on a phone.
  const member = {
    id: 'webid:anna', webid: 'webid:anna', handle: 'anna', pubKey: 'key-anna', stableId: 'stable-anna',
    circleAddress: 'circle-addr-1', circleAddresses: ['circle-addr-1', 'circle-addr-2'],
  };
  const stampAnna = (actor) =>
    stampSenderLabels([{ actor, text: 'hoi' }], { members: [member], viewerId: ME, policy: 'open' })[0];

  it('labels her the same however she reaches the circle', () => {
    for (const actor of ['webid:anna', 'circle-addr-1', 'circle-addr-2', 'key-anna', 'stable-anna']) {
      const row = stampAnna(actor);
      expect(row.senderLabelKey, `${actor} did not resolve to a member`).toBe(null);
      expect(row.senderLabel).toBe(stampAnna('webid:anna').senderLabel);
    }
  });

  it('still says unknown for someone the roster cannot place', () => {
    expect(stampAnna('addr-of-a-stranger').senderLabelKey).toBe('circle.chat.unknown_sender');
  });
});
