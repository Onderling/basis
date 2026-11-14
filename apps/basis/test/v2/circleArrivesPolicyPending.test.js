/**
 * A CIRCLE THAT ARRIVES WITHOUT ITS POLICY IS NOT PLAINTEXT. Besides a join, a circle reaches a device by the person's
 * own devices (a sibling's `device-circle-joined` carry), by an enrolment offer, and by a restore from a recovery file
 * (its circles stashed as an offer): all three run the one per-circle step `consumeCircleEntry`, which carries no policy.
 * It marks the circle's policy PENDING first, as the join's post-step does, so its posture is not known (writes refused)
 * until the circle's policy arrives.
 */
import { describe, it, expect, vi } from 'vitest';
import { consumeCircleEntry } from '../../src/v2/enrollOffer.js';

describe('a circle that arrives by the own devices, an enrolment or a restore', () => {
  it('is marked policy-pending first, before anything else is asked', async () => {
    const order = [];
    const markPolicyPending = vi.fn(async (cid) => { order.push(`mark:${cid}`); });
    const agent = {
      relays: { has: () => true }, addRelay: async () => {},
      persona: () => ({}),
    };
    const callSkill = vi.fn(async (_app, op) => { order.push(`call:${op}`); return {}; });
    await consumeCircleEntry(
      { agent, callSkill, sendPeerMessage: async () => ({}), markPolicyPending },
      { id: 'carried', address: 'addr-sibling', relays: [] },
    ).catch(() => null);
    expect(markPolicyPending).toHaveBeenCalledWith('carried');
    expect(order[0], `the mark comes first: ${JSON.stringify(order)}`).toBe('mark:carried');
  });

  it('a malformed entry marks nothing', async () => {
    const markPolicyPending = vi.fn();
    await consumeCircleEntry({ agent: {}, callSkill: async () => ({}), sendPeerMessage: async () => ({}), markPolicyPending }, { id: '', address: '' });
    expect(markPolicyPending).not.toHaveBeenCalled();
  });
});
