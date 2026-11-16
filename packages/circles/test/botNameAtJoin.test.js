import { describe, it, expect } from 'vitest';
import { verifyMembershipCodeForPeer } from '../src/circleMembershipWriters.js';

// A BOT'S NAME IS ITS OWN, at the front door too. People may share a name (2026-11-06), but a bot is addressed by its
// name in chat, so the roster fold refuses a member-props that takes a bot's name. A JOIN carries a name as well, and the
// fold does not check it: the admin, who holds the roster and the per-name lock, refuses a joiner named like a current
// bot (case-blind), with the existing 'handle-taken' so the join wizard reopens its name field.

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
const deps = (spine, store = fakeStore()) => ({
  store,
  members: { addMember: async () => {} },
  simulateSync: () => ({ synced: true }),
  grantKey: async () => {},
  emitSpine: async (s) => { spine.push(s); return s; },
  codeRedeemableNow: () => true,
  inviteRedemptionVerdict: async () => ({ allow: true, already: null }),
  INVITE_LIMIT_REACHED: 'invite-limit-reached',
  verifyCircleLink: () => false,
  withHandleClaim: async (_store, _group, _handle, fn) => fn(),
  botNamesIn: async (gid) => (gid === GROUP ? [{ webid: 'webid:bot', handle: 'Huisbot' }] : []),
});

describe('a joiner named like a current bot is refused at the redeem', () => {
  it('"huisbot" (any case) is refused with handle-taken, and nothing is written', async () => {
    const spine = [];
    const store = fakeStore();
    const r = await verifyMembershipCodeForPeer(deps(spine, store), { a: { groupId: GROUP, code: 'ABC', requesterWebid: 'webid:cee', peerDisplay: ' huisbot ' }, from: 'webid:anne' });
    expect(r.error).toBe('handle-taken');
    expect(store.items.filter((i) => i.type === 'membership-redemption')).toHaveLength(0);
    expect(spine.find((s) => s.kind === 'join')).toBeUndefined();
  });

  it('a joiner named like a PERSON is admitted (people may share a name)', async () => {
    const spine = [];
    const r = await verifyMembershipCodeForPeer(deps(spine), { a: { groupId: GROUP, code: 'ABC', requesterWebid: 'webid:cee', peerDisplay: 'Jan' }, from: 'webid:anne' });
    expect(r.error).toBeUndefined();
    expect(spine.find((s) => s.kind === 'join')?.payload?.peerDisplay).toBe('Jan');
  });
});
