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
