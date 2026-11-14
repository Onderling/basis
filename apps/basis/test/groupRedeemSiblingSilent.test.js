/**
 * A person's devices share one address, so a joiner's peer redeem reaches every one of them, and the joiner takes the
 * FIRST reply. Only the device that minted the invite holds its code; a sibling without it answered "invalid or expired
 * code", and when that reply came first the join failed (a phone inviting while the person's box is on). A device that
 * holds no code for the circle now stays silent, so the reply that arrives is the code holder's.
 */
import { describe, it, expect } from 'vitest';
import { makeHandleGroupRedeemRequest } from '../src/core/handlers/groupRedeem.js';

const QUIET = { warn() {}, info() {}, debug() {} };
const handlerWith = (result, sent) => makeHandleGroupRedeemRequest({
  callSkill: async () => result,
  sendPeer: async (to, payload) => { sent.push({ to, payload }); },
  logger: QUIET,
});
const REQ = { requestId: 'r1', groupId: 'g1', code: 'ABC' };

describe('the redeem reply of a device that holds no code for the circle', () => {
  it('sends nothing: the sibling that holds the code answers', async () => {
    const sent = [];
    await handlerWith({ error: 'no-code-here' }, sent)('pk-bea', REQ);
    expect(sent).toEqual([]);
  });
  it('a device that holds the circle\'s codes still answers a wrong code', async () => {
    const sent = [];
    await handlerWith({ error: 'invalid-or-expired-code' }, sent)('pk-bea', REQ);
    expect(sent.map((s) => s.payload.error)).toEqual(['invalid-or-expired-code']);
  });
});
