/**
 * circleCreate — the §8c slice-a lift of the zero-key circle-creation writers. Proves `createGroupWithRules`
 * behaves byte-identically to its pre-lift stoop skill body: a `group-rules` typed-item write over the
 * injected store, honest refusals on bad args, no key operation.
 */
import { describe, it, expect } from 'vitest';

import { createGroupWithRules, createGroupV2, redeemInviteWithGate } from '../src/circleCreate.js';

const fakeStore = () => {
  const items = [];
  return {
    items,
    addItems: async (arr, opts) => arr.map((it) => {
      const rec = { id: `id-${items.length}`, ...it, _actor: opts?.actor };
      items.push(rec);
      return rec;
    }),
  };
};
const simulateSync = () => ({ synced: true });

describe('createGroupWithRules — zero-key circle-creation writer (§8c slice-a lift)', () => {
  it('persists a group-rules item and returns {rulesId, groupId, _sync}', async () => {
    const store = fakeStore();
    const r = await createGroupWithRules(
      { store, simulateSync },
      { a: { groupId: 'g1', name: 'Circle', rules: { quorum: 2 } }, from: 'webid:anne' },
    );
    expect(r.rulesId).toBeTruthy();
    expect(r.groupId).toBe('g1');
    expect(r._sync).toEqual({ synced: true });
    expect(store.items).toHaveLength(1);
    expect(store.items[0]).toMatchObject({
      type: 'group-rules', text: 'Circle',
      source: { groupId: 'g1', rules: { quorum: 2 }, version: 1 },
      visibility: 'household', _actor: 'webid:anne',
    });
  });

  it('refuses missing groupId / name / rules (honest error, no write)', async () => {
    const store = fakeStore();
    expect(await createGroupWithRules({ store, simulateSync }, { a: { name: 'x', rules: {} } })).toEqual({ error: 'groupId required' });
    expect(await createGroupWithRules({ store, simulateSync }, { a: { groupId: 'g', rules: {} } })).toEqual({ error: 'name required' });
    expect(await createGroupWithRules({ store, simulateSync }, { a: { groupId: 'g', name: 'n', rules: null } })).toEqual({ error: 'rules object required' });
    expect(store.items).toHaveLength(0);
  });
});

describe('createGroupV2 — zero-key self-create writer (§8c slice-a lift)', () => {
  const deps = (store, members, calls) => ({
    store, members,
    metrics: { record: (k) => calls.metrics.push(k) },
    simulateSync: () => ({ synced: true }),
    clampInviteMaxRedemptions: (v, cap) => Math.min(v ?? cap, cap),
    INVITE_REDEMPTION_SYSTEM_CAP: 100,
    validateStoragePolicy: () => null,
    buildStoragePolicy: (p) => ({ policy: p ?? 'no-pod' }),
    freshMembershipCode: () => 'CODE-123',
    setCirclePolicy: (gid, storage) => { calls.policy.push([gid, storage]); },
  });

  it('persists group-rules + membership-code, promotes the caller to admin, returns the code once', async () => {
    const store = fakeStore();
    const added = [];
    const members = { resolveByWebid: async () => null, addMember: async (m) => added.push(m) };
    const calls = { metrics: [], policy: [] };
    const r = await createGroupV2(deps(store, members, calls), { a: { groupId: 'g1', name: 'Circle', rules: { q: 1 } }, from: 'webid:anne' });

    expect(r).toMatchObject({ groupId: 'g1', code: 'CODE-123', keyRotationMode: 'admin-only', rotationDays: 30, storage: { policy: 'no-pod' } });
    expect(r.rulesId).toBeTruthy();
    expect(r.codeId).toBeTruthy();
    expect(r._sync).toEqual({ synced: true });
    // two typed-item writes: group-rules then membership-code
    expect(store.items.map((i) => i.type)).toEqual(['group-rules', 'membership-code']);
    // admin promotion + best-effort policy push + metric
    expect(added[0]).toMatchObject({ webid: 'webid:anne', role: 'admin' });
    expect(calls.policy).toEqual([['g1', { policy: 'no-pod' }]]);
    expect(calls.metrics).toEqual(['group-create-v2']);
  });

  it('refuses a bad storage policy and writes nothing', async () => {
    const store = fakeStore();
    const calls = { metrics: [], policy: [] };
    const d = { ...deps(store, null, calls), validateStoragePolicy: () => 'bad-storage-policy' };
    expect(await createGroupV2(d, { a: { groupId: 'g', name: 'n', rules: {} }, from: 'x' })).toEqual({ error: 'bad-storage-policy' });
    expect(store.items).toHaveLength(0);
  });
});

describe('redeemInviteWithGate — zero-key join rules-gate (§8c slice-a lift)', () => {
  it('persists a rules-accept record when privacy + rules are accepted', async () => {
    const store = fakeStore();
    const r = await redeemInviteWithGate(
      { store },
      { a: { invite: { groupId: 'g1' }, privacyAccepted: true, rulesAccepted: true }, from: 'webid:bob' },
    );
    expect(r).toMatchObject({ ok: true, groupId: 'g1' });
    expect(r.acceptanceId).toBeTruthy();
    expect(store.items).toHaveLength(1);
    expect(store.items[0]).toMatchObject({
      type: 'rules-accept', source: { groupId: 'g1', acceptedBy: 'webid:bob', gateVersion: 'phase-17' },
      _actor: 'webid:bob',
    });
  });

  it('refuses without invite / privacy / rules acceptance (honest error, no write)', async () => {
    const store = fakeStore();
    expect(await redeemInviteWithGate({ store }, { a: {} })).toEqual({ error: 'invite required' });
    expect(await redeemInviteWithGate({ store }, { a: { invite: { groupId: 'g' }, privacyAccepted: false, rulesAccepted: true } })).toEqual({ error: 'privacy-not-accepted' });
    expect(await redeemInviteWithGate({ store }, { a: { invite: { groupId: 'g' }, privacyAccepted: true, rulesAccepted: false } })).toEqual({ error: 'rules-not-accepted' });
    expect(await redeemInviteWithGate({ store }, { a: { invite: {}, privacyAccepted: true, rulesAccepted: true } })).toEqual({ error: 'invite missing groupId' });
    expect(store.items).toHaveLength(0);
  });
});
