/**
 * Three people, one circle, one post (in process, inbound routed as the shells route it) — the noticeboard post lives in the circle's own store and its lane carries it.
 * Ann posts; Bob and Carol see it on their boards with no copy and no bridge. Bob answers: Ann's board knows it was
 * Bob, and neither Bob's nor Carol's device ever holds who answered (the circle store, the part that syncs, carries
 * no responders).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, bindCircleAddresses, until, teardown,
} from './support/pairRealAgents.js';

/** Inbound as the shells route it: the household sync's door first (the lane a circle store rides), then the rest. */
function wireInboundLikeShell(node) {
  const shellRouter = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    try { if (node.agent.householdSync.handleInbound(env?.from, env?.payload)) return; }
    catch { /* fall through to the shell router */ }
    return shellRouter?.(env);
  };
}

const G = 'posts-in-circle';
const board = async (node) => ((await node.agent.callSkill('pinboard', 'listOpenRequests', { groupId: G }))?.items ?? []);

describe('posts live in the circle store (three devices)', () => {
  let ann, bob, carol;
  beforeAll(async () => {
    [ann, bob, carol] = await Promise.all(['ann', 'bob', 'carol'].map((l) => bootRealAgentNode(l, { itemsLane: true, redeemTimeoutMs: 30_000 })));
    await connectNodesOverBus([ann, bob, carol]);
    await createCircle(ann, { groupId: G, name: 'Buurt', purpose: 'samen' });
    for (const [n, h] of [[bob, 'bob'], [carol, 'carol']]) {
      const j = await joinExistingCircle(ann, n, { groupId: G, handle: h });
      expect(j.joined?.ok, JSON.stringify(j.joined)).toBe(true);
    }
    await bindCircleAddresses([ann, bob, carol], G);
    for (const n of [ann, bob, carol]) { wireInboundLikeShell(n); await n.agent.ensureCircleSync?.(G); }
  }, 180_000);
  afterAll(async () => { await teardown(ann, bob, carol); });

  it('a post crosses to both members through the circle store; who answered stays on the poster\'s device', async () => {
    const made = await ann.agent.callSkill('pinboard', 'postRequest', { intent: 'ask', text: 'wie heeft een ladder?', groupId: G });
    const id = made?.itemId ?? made?.id ?? made?.item?.id;
    expect(id, JSON.stringify(made)).toBeTruthy();
    expect(await ann.agent.circleStoreFor(G).get(id), 'in the circle\'s own store').toBeTruthy();
    for (const n of [bob, carol]) {
      const seen = await until(async () => ((await board(n)).some((i) => i.id === id) ? true : null), { timeout: 30_000, step: 500 });
      expect(seen, `${n.label} never saw the post`).toBe(true);
    }
    // Bob answered (his 1:1 answer reached Ann; the host records it, as the contact channel does)
    const rec = await ann.agent.callSkill('pinboard', 'recordResponse', { requestId: id, senderAddress: bob.pubKey });
    expect(rec?.recorded, JSON.stringify(rec)).toBe(true);
    const mine = (await board(ann)).find((i) => i.id === id);
    expect(mine?.source?.responders ?? mine?.responders, 'Ann\'s board knows Bob answered').toBeTruthy();
    await new Promise((r) => setTimeout(r, 2000));   // give the lane its chance to carry anything it would
    for (const n of [ann, bob, carol]) {
      const row = await n.agent.circleStoreFor(G).get(id);
      expect(row?.source?.responders, `${n.label}'s circle store holds who answered`).toBeUndefined();
    }
  }, 120_000);
});
