/**
 * Stoop γ-next.policy — broadcastCirclePolicy skill.
 *
 * Mirror of sp-gamma-next-rules-broadcastCircleRules: fan a circle
 * circlePolicy document out to every other member via chat.send (subtype
 * `circle-policy-broadcast`).  Mocks chat.send so the test captures the
 * per-recipient envelope shape without the full NKN transport plumbing.
 *
 * Also includes the cross-agent journey: Anne broadcasts a policy doc;
 * the captured envelope feeds basis's `makeCirclePolicyPeerHandler`,
 * and the pending-policy store ends up with the broadcast doc.
 */

import { describe, it, expect, vi } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighborhoodAgent } from '../src/index.js';
// Receiver side substrate lives in basis; we import directly via
// relative path (the package wire is identical to how circleRulesReceiver
// is referenced from this same test file's sibling).
import { makeCirclePolicyPeerHandler } from '../../basis/src/v2/circlePolicyReceiver.js';
import { createCirclePolicyPendingStore } from '../../basis/src/v2/circlePolicyPending.js';

const ANNE  = 'https://id.example/anne';
const BOB   = 'https://id.example/bob';
const CARLA = 'https://id.example/carla';

async function callSkill(agent, skillId, args, fromWebid = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

async function buildBundle(members) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  return createNeighborhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:    members ?? [
      { webid: ANNE,  role: 'member' },
      { webid: BOB,   role: 'member', stableId: 'sid-bob' },
      { webid: CARLA, role: 'member', stableId: 'sid-carla' },
    ],
  });
}

const SAMPLE_POLICY = {
  features: {
    chat: true, noticeboard: false, tasks: true, lists: false,
    calendar: false, notes: false, houseRules: true, memberDirectory: true,
  },
  view:               'screen',
  llmTool:            'off',
  agents:             'admin-approval',
  revealPolicy:       'pairwise',
  pod:                'none',
  catchUpChooserMode: 'auto',
  admins:             ['anne'],
  consensusRequired:  false,
};

describe('Stoop γ-next.policy — broadcastCirclePolicy', () => {
  it('fans the policy envelope out to every other member via chat.send', async () => {
    const bundle = await buildBundle();
    await bundle.offeringMatch.start();
    const calls = [];
    bundle.chat.send = vi.fn(async (args) => { calls.push(args); return { ok: true }; });

    const r = await callSkill(bundle.agent, 'broadcastCirclePolicy', {
      groupId: 'oosterpoort',
      policy:  SAMPLE_POLICY,
      msgId:   'mp-1',
      ts:      1735_000_000_000,
    });
    expect(r.sent).toBe(2);
    expect(r.attempted).toBe(2);
    expect(r.errors).toEqual([]);

    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.toWebid).sort()).toEqual([BOB, CARLA].sort());
    for (const c of calls) {
      expect(c.subtype).toBe('circle-policy-broadcast');
      expect(c.threadId).toBe('oosterpoort');
      expect(c.extras.circleId).toBe('oosterpoort');
      expect(c.extras.msgId).toBe('mp-1');
      expect(c.extras.ts).toBe(1735_000_000_000);
      expect(c.extras.policy).toEqual(SAMPLE_POLICY);
      expect(c.extras.fromActor).toBe(ANNE);
    }
  });

  it('skips the caller (does not echo back to self)', async () => {
    const bundle = await buildBundle();
    await bundle.offeringMatch.start();
    const calls = [];
    bundle.chat.send = vi.fn(async (args) => { calls.push(args); return { ok: true }; });
    await callSkill(bundle.agent, 'broadcastCirclePolicy',
      { groupId: 'oosterpoort', policy: SAMPLE_POLICY, msgId: 'mp-2' }, BOB);
    expect(calls.map((c) => c.toWebid).sort()).toEqual([ANNE, CARLA].sort());
  });

  it('counts per-recipient failures in errors[] but never throws', async () => {
    const bundle = await buildBundle();
    await bundle.offeringMatch.start();
    bundle.chat.send = vi.fn(async (args) => {
      if (args.toWebid === BOB) return { ok: false, reason: 'recipient-pubkey-unknown' };
      throw new Error('boom');
    });
    const r = await callSkill(bundle.agent, 'broadcastCirclePolicy',
      { groupId: 'oosterpoort', policy: SAMPLE_POLICY, msgId: 'mp-3' });
    expect(r.sent).toBe(0);
    expect(r.attempted).toBe(2);
    expect(r.errors).toHaveLength(2);
    const byWebid = Object.fromEntries(r.errors.map((e) => [e.webid, e.reason]));
    expect(byWebid[BOB]).toBe('recipient-pubkey-unknown');
    expect(byWebid[CARLA]).toBe('boom');
  });

  it('rejects when policy is missing or non-object', async () => {
    const bundle = await buildBundle();
    await bundle.offeringMatch.start();
    expect(await callSkill(bundle.agent, 'broadcastCirclePolicy',
      { groupId: 'oosterpoort', msgId: 'm' })).toEqual({ error: 'policy-required' });
    expect(await callSkill(bundle.agent, 'broadcastCirclePolicy',
      { groupId: 'oosterpoort', policy: 'not an object', msgId: 'm' })).toEqual({ error: 'policy-required' });
  });

  it('rejects missing msgId', async () => {
    const bundle = await buildBundle();
    await bundle.offeringMatch.start();
    expect(await callSkill(bundle.agent, 'broadcastCirclePolicy',
      { groupId: 'oosterpoort', policy: SAMPLE_POLICY })).toEqual({ error: 'msgId-required' });
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * Cross-agent journey — Anne broadcasts, Bob's pending-policy store
 * lands the policy doc.  Captures Anne's chat.send envelope, reconstructs
 * the wire payload makeCirclePolicyPeerHandler expects, and asserts
 * the per-circle cache holds the right entry.
 * ─────────────────────────────────────────────────────────────────── */

describe('Stoop γ-next.policy — cross-agent: Anne → Bob.pendingStore', () => {
  it('Anne broadcasts; Bob caches the policy in his pendingStore for the editor', async () => {
    const anne = await buildBundle([
      { webid: ANNE, role: 'member' },
      { webid: BOB,  role: 'member', stableId: 'sid-bob' },
    ]);
    await anne.offeringMatch.start();
    const captured = [];
    anne.chat.send = vi.fn(async (args) => { captured.push(args); return { ok: true }; });

    const r = await callSkill(anne.agent, 'broadcastCirclePolicy', {
      groupId: 'oosterpoort',
      policy:  SAMPLE_POLICY,
      msgId:   'cross-p-1',
      ts:      1735_000_000_000,
    });
    expect(r.sent).toBe(1);
    expect(captured).toHaveLength(1);

    const mem = new Map();
    const pending = createCirclePolicyPendingStore({
      load:   async (id) => mem.get(id) ?? null,
      save:   async (id, v) => { mem.set(id, v); },
      remove: async (id) => { mem.delete(id); },
    });
    const handler = makeCirclePolicyPeerHandler({ pendingStore: pending });

    const sent = captured[0];
    const wirePayload = {
      subtype:  'circle-policy-broadcast',
      circleId: sent.extras.circleId,
      msgId:    sent.extras.msgId,
      ts:       sent.extras.ts,
      policy:   sent.extras.policy,
    };
    await handler('nkn-addr-anne', wirePayload);

    const cached = await pending.get('oosterpoort');
    expect(cached).toEqual(SAMPLE_POLICY);
  });

  it('replay is idempotent — second arrival is dedup-skipped', async () => {
    const mem = new Map();
    const pending = createCirclePolicyPendingStore({
      load:   async (id) => mem.get(id) ?? null,
      save:   async (id, v) => { mem.set(id, v); },
      remove: async (id) => { mem.delete(id); },
    });
    const handler = makeCirclePolicyPeerHandler({ pendingStore: pending });
    const env = {
      subtype: 'circle-policy-broadcast',
      circleId: 'oosterpoort', msgId: 'replay-1',
      ts: 1, policy: SAMPLE_POLICY,
    };
    await handler('a', env);
    await handler('a', { ...env, policy: { ...SAMPLE_POLICY, view: 'chat' } });
    // dedup on msgId kept the first policy doc.
    expect((await pending.get('oosterpoort')).view).toBe('screen');
  });
});
