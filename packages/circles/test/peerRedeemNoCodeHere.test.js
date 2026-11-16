import { describe, it, expect } from 'vitest';
import { verifyMembershipCodeForPeer } from '../src/circleMembershipWriters.js';

// A person's devices share one address, so a peer redeem reaches all of them. Only the device that minted the invite
// holds its code. A device holding NO code for the circle is not where the invite lives: it says so as 'no-code-here'
// (the handler then stays silent), so its answer cannot overtake the real answer of the device that holds the code.
// A device that does hold codes for the circle answers a wrong or expired code as before.

const GROUP = 'g1';
const deps = (codes) => ({
  store: {
    listOpen: async ({ type } = {}) => (type === 'membership-code' ? codes : []),
    addItems: async (arr) => arr.map((it, i) => ({ id: `id-${i}`, ...it })),
  },
  members: { addMember: async () => {} },
  simulateSync: () => ({ synced: true }),
  grantKey: async () => {},
  emitSpine: async (s) => s,
  codeRedeemableNow: () => true,
  inviteRedemptionVerdict: async () => ({ allow: true, already: null }),
  INVITE_LIMIT_REACHED: 'invite-limit-reached',
  verifyCircleLink: () => false,
  withHandleClaim: async (_s, _g, _h, fn) => fn(),
});
const redeem = (codes, code = 'ABC') => verifyMembershipCodeForPeer(deps(codes), {
  a: { groupId: GROUP, code, requesterWebid: 'webid:bea' }, from: 'webid:anne',
});
const codeFor = (groupId) => ({ id: `code-${groupId}`, source: { groupId, code: 'ABC', expiresAt: Date.now() + 60_000, issuedBy: 'webid:anne' } });

describe('a peer redeem on a device that holds no code for the circle', () => {
  it('a device with no code for this circle answers no-code-here (another circle\'s code does not count)', async () => {
    expect((await redeem([])).error).toBe('no-code-here');
    expect((await redeem([codeFor('other')])).error).toBe('no-code-here');
  });
  it('the device that holds the circle\'s codes still refuses a wrong code as invalid', async () => {
    expect((await redeem([codeFor(GROUP)], 'WRONG')).error).toBe('invalid-or-expired-code');
  });
  it('and admits the right one', async () => {
    expect((await redeem([codeFor(GROUP)])).error).toBeUndefined();
  });
});
