/**
 * THE CONTACT DOOR NEVER DROPS A TURN SILENTLY (Fable's ruling, 2026-11-14, after the phone walk lost a member's second
 * message): a co-member the person never answered, after "people in my circles may write to me" went off, is held as a
 * request WITHOUT a card, shown by their name in the circle; and a turn the hold refuses for any other reason is held
 * anyway, its refusal written to the refusal log with its reason code.
 */
import { describe, it, expect } from 'vitest';
import { createMessageRequestDoor } from '../../src/v2/messageRequestDoor.js';
import { refusalCode } from '../../src/v2/refusalLog.js';

const base = (over = {}) => {
  const holds = []; const refusals = [];
  const door = createMessageRequestDoor({
    isKnown: () => false,
    isMember: () => false,
    hold: async (turn) => { holds.push(turn); return { held: true }; },
    refusal: (reason) => refusals.push(reason),
    now: () => 1_000,
    ...over({ holds, refusals }),
  });
  return { door, holds, refusals };
};
const turn = { contactId: 'cas', fromAddr: 'cas-addr', text: 'tweede', messageId: 'cas-2', ts: 900 };

describe('the contact door never drops a turn silently', () => {
  it('a co-member who may not write first (the switch went off) is held without a card, named as in the circle', async () => {
    const { door, holds } = base(() => ({ coMember: async () => ({ name: 'Cas' }) }));
    expect(await door(turn)).toBe('held');
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ from: 'cas', messageId: 'cas-2', memberName: 'Cas' });
    expect(holds[0].card).toBeUndefined();
  });

  it('a stranger is not named as a member', async () => {
    const { door, holds } = base(() => ({ coMember: async () => null }));
    expect(await door(turn)).toBe('held');
    expect(holds[0].memberName).toBeUndefined();
  });

  it('a refused hold is held again as the fallback, and the refusal is logged with its reason', async () => {
    const { door, holds, refusals } = base(({ holds: h }) => ({
      hold: async (t) => { h.push(t); return t.refused ? { held: true } : { held: false, reason: 'made-up' }; },
    }));
    expect(await door(turn)).toBe('held');
    expect(holds).toHaveLength(2);
    expect(holds[1]).toMatchObject({ from: 'cas', messageId: 'cas-2', text: 'tweede', refused: 'made-up' });
    expect(refusals).toEqual(['made-up']);
  });

  it('a hold that throws is a refusal too, never nothing', async () => {
    const { door, holds, refusals } = base(({ holds: h }) => ({
      hold: async (t) => { h.push(t); if (!t.refused) throw new Error('boom'); return { held: true }; },
    }));
    expect(await door(turn)).toBe('held');
    expect(holds[1].refused).toBe('hold-threw');
    expect(refusals).toEqual(['hold-threw']);
  });

  it('when even the fallback cannot hold it (no self to hold it for), it is dropped and both refusals are logged', async () => {
    const { door, refusals } = base(() => ({ hold: async () => ({ held: false, reason: 'no-self' }) }));
    expect(await door(turn)).toBe('dropped');
    expect(refusals).toEqual(['no-self', 'no-self']);
  });

  it('the hold\'s reasons are codes the refusal log writes, not "other"', () => {
    for (const r of ['no-card', 'malformed-card', 'card-not-sender', 'file-on-request', 'turn-too-large', 'no-self', 'no-contacts', 'invalid', 'no-answer', 'hold-threw']) {
      expect(refusalCode(r).reason, r).toBe(r);
    }
  });
});
