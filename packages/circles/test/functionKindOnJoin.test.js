import { describe, it, expect } from 'vitest';
import { redeemMembershipCode, verifyMembershipCodeForPeer } from '../src/circleMembershipWriters.js';

// A function profile (a bot's node) is a roster fact only when the ADMITTING ADMIN states it on the signed join, and
// only for a code that admin minted for a bot. The redeemer's say-so alone, on an ordinary code or on its own
// device's redeem, writes nothing.

const GROUP = 'g1';
const store = (forFunction) => ({
  listOpen: async ({ type } = {}) => (type === 'membership-code'
    ? [{ id: 'code-1', source: { groupId: GROUP, code: 'ABC', expiresAt: Date.now() + 60_000, issuedBy: 'webid:anne', ...(forFunction ? { forFunction: true } : {}) } }]
    : []),
  addItems: async (arr) => arr.map((it, i) => ({ id: `id-${i}`, ...it })),
});
const deps = (spine, forFunction) => ({
  store: store(forFunction),
  members: { addMember: async () => {} },
  simulateSync: () => ({ synced: true }),
  grantKey: async () => {},
  emitSpine: async (s) => { spine.push(s); return s; },
  codeRedeemableNow: () => true,
  inviteRedemptionVerdict: async () => ({ allow: true, already: null }),
  INVITE_LIMIT_REACHED: 'invite-limit-reached',
  verifyCircleLink: () => false,
  withHandleClaim: async (_s, _g, _h, fn) => fn(),
  collectCircleHandles: async () => [],
  findHandleCollision: () => false,
});
const admit = async ({ forFunction, profileKind }) => {
  const spine = [];
  const r = await verifyMembershipCodeForPeer(deps(spine, forFunction), {
    a: { groupId: GROUP, code: 'ABC', requesterWebid: 'webid:bot', ...(profileKind ? { profileKind } : {}) }, from: 'webid:anne',
  });
  expect(r.error).toBeUndefined();
  return spine.find((s) => s.kind === 'join')?.payload ?? {};
};

describe('the admin-signed join states a function profile', () => {
  it('a bot invite + a function-profile redeemer → kind: function on the join', async () => {
    expect((await admit({ forFunction: true, profileKind: 'function' })).kind).toBe('function');
  });
  it('an ordinary invite ignores the redeemer\'s claim', async () => {
    expect('kind' in await admit({ forFunction: false, profileKind: 'function' })).toBe(false);
  });
  it('a bot invite redeemed by a person node writes no kind', async () => {
    expect('kind' in await admit({ forFunction: true, profileKind: 'person' })).toBe(false);
  });
  it('the joiner\'s own redeem never carries a kind, whatever it claims', async () => {
    const spine = [];
    await redeemMembershipCode(deps(spine, true), { a: { groupId: GROUP, code: 'ABC', profileKind: 'function', kind: 'function' }, from: 'webid:bot' });
    expect('kind' in (spine.find((s) => s.kind === 'join')?.payload ?? {})).toBe(false);
  });
});
