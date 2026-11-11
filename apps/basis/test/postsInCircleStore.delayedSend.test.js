/**
 * The circle post crosses even when the sends are a moment slower (L800).
 *
 * `postsInCircleStore.test.js` passed only on timing: with ONE extra microtask in front of each wire send, the founder's
 * envelope from her CIRCLE address reached a joiner before the joiner had bound that address to her key, and the
 * SecurityLayer refused it as UNKNOWN_SENDER and DROPPED it (the member list had already vouched for the key a step
 * earlier). A drop never enters the stale-roster park, so nothing re-judged it and the post never arrived. An envelope
 * addressed to one of MY circle addresses now parks instead, and is re-judged through the full check once a roster
 * read binds the sender's key. Same three people as the original; every node's wire send is delayed by one microtask.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, bindCircleAddresses, until, teardown,
} from './support/pairRealAgents.js';

function wireInboundLikeShell(node) {
  const shellRouter = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    try { if (node.agent.householdSync.handleInbound(env?.from, env?.payload)) return; }
    catch { /* fall through to the shell router */ }
    return shellRouter?.(env);
  };
}

/** One microtask in front of every wire send of this node (the timing that exposed the drop). */
function delayWireSends(node) {
  const peer = node.agent.sa.peer;
  const send = peer.sendTo.bind(peer);
  peer.sendTo = async (to, payload, opts) => { await null; return send(to, payload, opts); };
}

const G = 'posts-delayed';
const board = async (node) => ((await node.agent.callSkill('pinboard', 'listOpenRequests', { groupId: G }))?.items ?? []);

describe('a circle post crosses with slower sends (an early envelope from a not-yet-bound member address is parked)', () => {
  let ann, bob, carol;
  beforeAll(async () => {
    [ann, bob, carol] = await Promise.all(['ann', 'bob', 'carol'].map((l) => bootRealAgentNode(l, { itemsLane: true, redeemTimeoutMs: 30_000 })));
    for (const n of [ann, bob, carol]) delayWireSends(n);
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

  it('Ann\'s post reaches Bob and Carol', async () => {
    const made = await ann.agent.callSkill('pinboard', 'postRequest', { intent: 'ask', text: 'wie heeft een ladder?', groupId: G });
    const id = made?.itemId ?? made?.id ?? made?.item?.id;
    expect(id, JSON.stringify(made)).toBeTruthy();
    for (const n of [bob, carol]) {
      const seen = await until(async () => ((await board(n)).some((i) => i.id === id) ? true : null), { timeout: 30_000, step: 500 });
      expect(seen, `${n.label} never saw the post; park ${JSON.stringify(n.agent.sa.parkStats ?? null)}`).toBe(true);
    }
  }, 120_000);
});
