/**
 * Stoop γ-next.recipe — broadcastCircleRecipe skill.
 *
 * Mirror of sp-13-2-1-broadcastCircleMessage: fan a kring scherm recipe
 * out to every other member via chat.send (subtype
 * `kring-recipe-broadcast`).  Mocks chat.send so the test captures the
 * per-recipient envelope shape without the full NKN transport plumbing.
 *
 * Also includes the cross-agent journey: Anne broadcasts a recipe; the
 * captured envelope feeds basis's `makeKringRecipePeerHandler`,
 * and the pending-recipe store ends up with the broadcast recipe.
 * This is the end-to-end check the slice spec asks for.
 */

import { describe, it, expect, vi } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighborhoodAgent } from '../src/index.js';
// Receiver side substrate lives in basis; we import directly via
// relative path (the package wire is identical to how kringChatReceiver
// is referenced from basis-mobile).
import { makeKringRecipePeerHandler } from '../../basis/src/v2/kringRecipeReceiver.js';
import { createKringRecipePendingStore } from '../../basis/src/v2/kringRecipePending.js';

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

const SAMPLE_RECIPE = {
  id: 'r-1',
  name: 'Buurt scherm',
  blocks: [{ id: 'b1', type: 'tasks', config: {} }],
};

describe('Stoop γ-next.recipe — broadcastCircleRecipe', () => {
  it('fans the recipe envelope out to every other member via chat.send', async () => {
    const bundle = await buildBundle();
    await bundle.offeringMatch.start();
    const calls = [];
    bundle.chat.send = vi.fn(async (args) => { calls.push(args); return { ok: true }; });

    const r = await callSkill(bundle.agent, 'broadcastCircleRecipe', {
      groupId: 'oosterpoort',
      recipe:  SAMPLE_RECIPE,
      msgId:   'mr-1',
      ts:      1735_000_000_000,
    });
    expect(r.sent).toBe(2);
    expect(r.attempted).toBe(2);
    expect(r.errors).toEqual([]);

    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.toWebid).sort()).toEqual([BOB, CARLA].sort());
    for (const c of calls) {
      expect(c.subtype).toBe('kring-recipe-broadcast');
      expect(c.threadId).toBe('oosterpoort');
      expect(c.extras.circleId).toBe('oosterpoort');
      expect(c.extras.msgId).toBe('mr-1');
      expect(c.extras.ts).toBe(1735_000_000_000);
      expect(c.extras.recipe).toEqual(SAMPLE_RECIPE);
      expect(c.extras.fromActor).toBe(ANNE);
    }
  });

  it('skips the caller (does not echo back to self)', async () => {
    const bundle = await buildBundle();
    await bundle.offeringMatch.start();
    const calls = [];
    bundle.chat.send = vi.fn(async (args) => { calls.push(args); return { ok: true }; });
    await callSkill(bundle.agent, 'broadcastCircleRecipe',
      { groupId: 'oosterpoort', recipe: SAMPLE_RECIPE, msgId: 'mr-2' }, BOB);
    expect(calls.map((c) => c.toWebid).sort()).toEqual([ANNE, CARLA].sort());
  });

  it('counts per-recipient failures in errors[] but never throws', async () => {
    const bundle = await buildBundle();
    await bundle.offeringMatch.start();
    bundle.chat.send = vi.fn(async (args) => {
      if (args.toWebid === BOB) return { ok: false, reason: 'recipient-pubkey-unknown' };
      throw new Error('boom');
    });
    const r = await callSkill(bundle.agent, 'broadcastCircleRecipe',
      { groupId: 'oosterpoort', recipe: SAMPLE_RECIPE, msgId: 'mr-3' });
    expect(r.sent).toBe(0);
    expect(r.attempted).toBe(2);
    expect(r.errors).toHaveLength(2);
    const byWebid = Object.fromEntries(r.errors.map((e) => [e.webid, e.reason]));
    expect(byWebid[BOB]).toBe('recipient-pubkey-unknown');
    expect(byWebid[CARLA]).toBe('boom');
  });

  it('rejects when recipe is missing or non-object', async () => {
    const bundle = await buildBundle();
    await bundle.offeringMatch.start();
    expect(await callSkill(bundle.agent, 'broadcastCircleRecipe',
      { groupId: 'oosterpoort', msgId: 'm' })).toEqual({ error: 'recipe-required' });
    expect(await callSkill(bundle.agent, 'broadcastCircleRecipe',
      { groupId: 'oosterpoort', recipe: 'not an object', msgId: 'm' })).toEqual({ error: 'recipe-required' });
  });

  it('rejects missing msgId', async () => {
    const bundle = await buildBundle();
    await bundle.offeringMatch.start();
    expect(await callSkill(bundle.agent, 'broadcastCircleRecipe',
      { groupId: 'oosterpoort', recipe: SAMPLE_RECIPE })).toEqual({ error: 'msgId-required' });
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * Cross-agent journey — Anne broadcasts, Bob's pending-recipe store
 * lands the recipe.  Captures Anne's chat.send envelope, reconstructs
 * the wire payload makeKringRecipePeerHandler expects, and asserts
 * the per-kring cache holds the right entry.
 * ─────────────────────────────────────────────────────────────────── */

describe('Stoop γ-next.recipe — cross-agent: Anne → Bob.pendingStore', () => {
  it('Anne broadcasts; Bob caches the recipe in his pendingStore for the editor', async () => {
    const anne = await buildBundle([
      { webid: ANNE, role: 'member' },
      { webid: BOB,  role: 'member', stableId: 'sid-bob' },
    ]);
    await anne.offeringMatch.start();
    const captured = [];
    anne.chat.send = vi.fn(async (args) => { captured.push(args); return { ok: true }; });

    const r = await callSkill(anne.agent, 'broadcastCircleRecipe', {
      groupId: 'oosterpoort',
      recipe:  SAMPLE_RECIPE,
      msgId:   'cross-r-1',
      ts:      1735_000_000_000,
    });
    expect(r.sent).toBe(1);
    expect(captured).toHaveLength(1);

    // Build Bob's pending store from a simple in-memory IO + the
    // recipe peer handler.  Reconstruct the wire payload the way
    // basis's peer-router would feed it.
    const mem = new Map();
    const pending = createKringRecipePendingStore({
      load:   async (id) => mem.get(id) ?? null,
      save:   async (id, v) => { mem.set(id, v); },
      remove: async (id) => { mem.delete(id); },
    });
    const handler = makeKringRecipePeerHandler({ pendingStore: pending });

    const sent = captured[0];
    const wirePayload = {
      subtype:  'kring-recipe-broadcast',
      circleId: sent.extras.circleId,
      msgId:    sent.extras.msgId,
      ts:       sent.extras.ts,
      recipe:   sent.extras.recipe,
    };
    await handler('nkn-addr-anne', wirePayload);

    const cached = await pending.get('oosterpoort');
    expect(cached).toEqual(SAMPLE_RECIPE);
  });

  it('replay is idempotent — second arrival is dedup-skipped', async () => {
    const mem = new Map();
    const pending = createKringRecipePendingStore({
      load:   async (id) => mem.get(id) ?? null,
      save:   async (id, v) => { mem.set(id, v); },
      remove: async (id) => { mem.delete(id); },
    });
    const handler = makeKringRecipePeerHandler({ pendingStore: pending });
    const env = {
      subtype: 'kring-recipe-broadcast',
      circleId: 'oosterpoort', msgId: 'replay-1',
      ts: 1, recipe: SAMPLE_RECIPE,
    };
    await handler('a', env);
    await handler('a', { ...env, recipe: { ...SAMPLE_RECIPE, name: 'attempted overwrite' } });
    // dedup on msgId kept the first recipe.
    expect((await pending.get('oosterpoort')).name).toBe('Buurt scherm');
  });
});
