/**
 * FITNESS: every wire-message constant is a kebab-case SUBTYPE, matching the peer router.
 *
 * Added 2026-07-28 after the same bug twice in one day: `makePeerRouter` dispatches on `payload.subtype`
 * (kebab-case, like `circle-chat-message`), and both the delivery receipt and all five Nearby messages were
 * written as `kind: 'x.y'` — payloads no router would ever dispatch, failing silently. The convention now
 * has a guard instead of relying on the next author having read the router.
 */
import { describe, it, expect } from 'vitest';
import { ASK_MESSAGE, ANSWER_MESSAGE } from '../../src/v2/nearbyAskChannel.js';
import { CARD_MESSAGE, CHAT_MESSAGE } from '../../src/v2/nearbyRoom.js';
import { INVITE_MESSAGE } from '../../src/v2/nearbyInvites.js';
import { RECEIPT_MESSAGE } from '../../src/v2/deliveryState.js';

const WIRE_SUBTYPES = { ASK_MESSAGE, ANSWER_MESSAGE, CARD_MESSAGE, CHAT_MESSAGE, INVITE_MESSAGE, RECEIPT_MESSAGE };

describe('FITNESS: wire subtypes follow the router convention', () => {
  for (const [name, value] of Object.entries(WIRE_SUBTYPES)) {
    it(`${name} is kebab-case with no dots (= dispatchable by makePeerRouter)`, () => {
      expect(value).toMatch(/^[a-z0-9]+(-[a-z0-9]+)+$/);
    });
  }

  it('no two wire subtypes collide', () => {
    const values = Object.values(WIRE_SUBTYPES);
    expect(new Set(values).size).toBe(values.length);
  });
});
