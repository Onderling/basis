import { describe, it, expect } from 'vitest';
import { redeemMembershipCode, verifyMembershipCodeForPeer } from '../src/circleMembershipWriters.js';

// The handle a joiner chose is recorded on the redemption row — which only the admitting device holds. The
// signed join is what every member folds, so the handle has to ride it too (both paths: the joiner's own
// device redeeming, and the admin's device confirming a remote joiner). Walked 2026-09-14: without this, only
// the admin ever saw a member's handle.

const GROUP = 'g1';
const fakeStore = () => {
  const items = [];
  return {
    items,
    listOpen: async ({ type } = {}) => (type === 'membership-code'
      ? [{ id: 'code-1', source: { groupId: GROUP, code: 'ABC', expiresAt: Date.now() + 60_000, issuedBy: 'webid:anne' } }]
      : []),
    addItems: async (arr, opts) => arr.map((it) => { const rec = { id: `id-${items.length}`, ...it, _actor: opts?.actor }; items.push(rec); return rec; }),
  };
};
const deps = (spine) => ({
  store: fakeStore(),
  members: { addMember: async () => {} },
  simulateSync: () => ({ synced: true }),
  grantKey: async () => {},
  emitSpine: async (s) => { spine.push(s); return s; },
  codeRedeemableNow: () => true,
  inviteRedemptionVerdict: async () => ({ allow: true, already: null }),
  INVITE_LIMIT_REACHED: 'invite-limit-reached',
  verifyCircleLink: () => false,
  withHandleClaim: async (_store, _group, _handle, fn) => fn(),
  collectCircleHandles: async () => [],
  findHandleCollision: () => false,
});

describe('the signed join carries the handle the joiner chose', () => {
  it('the joiner\'s own redeem emits join with peerDisplay', async () => {
    const spine = [];
    const r = await redeemMembershipCode(deps(spine), { a: { groupId: GROUP, code: 'ABC', peerDisplay: 'bee' }, from: 'webid:bob' });
    expect(r.error).toBeUndefined();
    const join = spine.find((s) => s.kind === 'join');
    expect(join?.subject).toBe('webid:bob');
    expect(join?.payload?.peerDisplay).toBe('bee');
  });

  it('the admin confirming a remote joiner emits join with the joiner\'s peerDisplay', async () => {
    const spine = [];
    const r = await verifyMembershipCodeForPeer(deps(spine), { a: { groupId: GROUP, code: 'ABC', requesterWebid: 'webid:cee', peerDisplay: 'cee' }, from: 'webid:anne' });
    expect(r.error).toBeUndefined();
    const join = spine.find((s) => s.kind === 'join');
    expect(join?.subject).toBe('webid:cee');
    expect(join?.payload?.peerDisplay).toBe('cee');
  });

  it('no handle claimed → no peerDisplay on the join (absent, not empty)', async () => {
    const spine = [];
    await redeemMembershipCode(deps(spine), { a: { groupId: GROUP, code: 'ABC' }, from: 'webid:bob' });
    expect('peerDisplay' in (spine.find((s) => s.kind === 'join')?.payload ?? {})).toBe(false);
  });
});
