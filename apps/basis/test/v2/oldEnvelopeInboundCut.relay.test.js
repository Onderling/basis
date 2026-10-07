/**
 * The old item-envelope wire is CUT inbound. A peer message carrying `__ntfyEnv` used to reach notify-envelope, which
 * writes its payload into the agent's local pseudo-pod at whatever `ref` it names, before anything checks it — the pod
 * that holds this agent's endorsements (read by the catalogue's trust). Nothing current sends that shape. So: it stops
 * at the router, is counted as refused, and nothing is written — from a member and from a stranger alike. Beside it, a
 * stranger's `__pairReq` must not make the agent hand it the circle's items.
 * Three real nodes on a real relay: two members, one stranger on the relay who is in no circle.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { startJourneyRelay } from '../support/testRelay.js';
import { bootAppCircle, untilTrue } from '../../../e2e-journeys/journeys/_app.mjs';

const CIRCLE = 'old-envelope-cut';
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

describe('the old envelope wire, inbound', () => {
  let relay; let circle;
  afterAll(async () => { await circle?.close?.(); await relay?.close?.(); });

  it('writes nothing for a member or a stranger, counts the refusal; a stranger\'s pair request gets no items', async () => {
    relay = await startJourneyRelay();
    circle = await bootAppCircle({ relayUrl: relay.url, circleId: CIRCLE, handles: ['anne', 'bram'], outsiders: ['eve'] });
    const [anne, bram] = circle.people;
    const [eve] = circle.outsiders;
    const ref = `pseudo-pod://${anne.pubKey}/public/endorsements`;
    const before = await anne.agent.readLocalPod(ref).catch(() => null);
    const envelope = (marker) => ({ __ntfyEnv: { v: 1, kind: 'item-upsert', timestamp: new Date().toISOString(), ref, payload: { forged: marker } } });

    // (a) a member sends it
    await bram.agent.sendPeerMessage(anne.pubKey, envelope('from-a-member'));
    // (b) a stranger on the relay sends it
    await eve.agent.sendPeerMessage(anne.pubKey, envelope('from-a-stranger'));
    expect(await untilTrue(async () => (anne.agent.inboundRefusals()['old-envelope'] ?? 0) >= 2, 15_000), `refusals: ${JSON.stringify(anne.agent.inboundRefusals())}`).toBe(true);
    const after = await anne.agent.readLocalPod(ref).catch(() => null);
    expect(JSON.stringify(after ?? null)).not.toMatch(/forged|from-a-/);
    expect(JSON.stringify(after ?? null)).toBe(JSON.stringify(before ?? null));

    // (d) a stranger's pair request is not honoured: the circle's peer list does not grow, no member gets a re-fan of
    // the circle's items, one refusal counted; a MEMBER's pair request still is
    await anne.agent.callSkill('tasks', 'addTask', { text: 'al-bestaand-item', circleId: CIRCLE });
    expect(await untilTrue(async () => JSON.stringify(await bram.agent.callSkill('tasks', 'listOpen', { circleId: CIRCLE })).includes('al-bestaand-item'), 20_000), 'bram has the item').toBe(true);
    const peersBefore = JSON.stringify(anne.agent.listHouseholdPeers(CIRCLE));
    const bramHeard = [];
    const bramLive = bram._routerRef.fn;
    bram._routerRef.fn = (env) => { bramHeard.push(JSON.stringify(env?.payload ?? null)); return bramLive?.(env); };
    await eve.agent.sendPeerMessage(anne.pubKey, { __pairReq: { addr: eve.pubKey, circleId: CIRCLE } });
    expect(await untilTrue(async () => (anne.agent.inboundRefusals()['pair-request-stranger'] ?? 0) >= 1, 15_000), `refusals: ${JSON.stringify(anne.agent.inboundRefusals())}`).toBe(true);
    await sleep(3000);
    expect(JSON.stringify(anne.agent.listHouseholdPeers(CIRCLE)), 'the peer list grew on a stranger\'s say-so').toBe(peersBefore);
    expect(bramHeard.filter((h) => /al-bestaand-item/.test(h)), 'a stranger made the box re-fan the circle').toEqual([]);
    bram._routerRef.fn = bramLive;
    await bram.agent.sendPeerMessage(anne.pubKey, { __pairReq: { addr: bram.pubKey, circleId: CIRCLE } });
    expect(await untilTrue(async () => anne.agent.listHouseholdPeers(CIRCLE).includes(bram.pubKey), 15_000), 'a member\'s pair request is honoured').toBe(true);

    // (c) a stranger's pair request, then a new item in the circle: nothing of the circle reaches the stranger
    const heard = [];
    const live = eve._routerRef.fn;
    eve._routerRef.fn = (env) => { heard.push(JSON.stringify(env?.payload ?? null)); return live?.(env); };
    await eve.agent.sendPeerMessage(anne.pubKey, { __pairReq: { addr: eve.pubKey, circleId: CIRCLE } });
    await sleep(3000);
    await anne.agent.callSkill('tasks', 'addTask', { text: 'de heg knippen-geheim', circleId: CIRCLE });
    await sleep(4000);
    expect(heard.filter((h) => /heg knippen-geheim/.test(h)), 'the circle\'s item reached the stranger').toEqual([]);
  }, 120_000);
});
