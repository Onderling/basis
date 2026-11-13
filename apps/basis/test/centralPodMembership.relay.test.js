/**
 * A CENTRAL-POD-ONLY CIRCLE: WHAT A JOIN AND A REMOVAL DO. The circle's chat crosses on its one pod with nothing fanned
 * (`centralPodCircle.relay.test.js`). Membership is a different lane: this walk measures how a join and a removal reach
 * the other member there, and whether they travel member to member (which tells members each other's addresses) or on
 * the pod. Anna founds the circle, Bram joins, both on one shared pod with the pod-only data move.
 *
 *   relay up:   Cas joins → does Bram's roster gain Cas, and did that cross the pod or a member-to-member fan?
 *               Anna removes Cas → does Bram's roster lose him?
 *   relay gone: Anna removes Bram's fellow member Dirk → does Bram ever learn it? (pinned: no carrier)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startJourneyRelay } from './support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle, bindCircleAddresses,
  makeCentralPod, readRoster, until, teardown,
} from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { EventLog } from '../src/eventLog.js';

const CIRCLE = 'central-pod-members';
const boot = (who, pod) => bootRealAgentNode(who, { itemsLane: true, centralPod: pod, agentOpts: { deviceLog: new EventLog({ initial: [], muted: [] }) } });
/** Every address a member is known by in Bram's roster (person key, circle self, circle address). */
const addressesIn = async (node) => (await readRoster(node, CIRCLE)).flatMap((m) => [m?.webid, m?.pubKey, m?.circleAddress, m?.addr].filter(Boolean));
const addressesOf = (n) => [n.pubKey, n.agent.circleSelf?.(CIRCLE)?.webid, n.agent.circleAddressFor?.(CIRCLE)].filter(Boolean);
const knows = async (node, other) => { const mine = new Set(await addressesIn(node)); return addressesOf(other).some((a) => mine.has(a)); };

describe('a central-pod-only circle: a join and a removal', () => {
  let relay; let pod; let A; let B; let C; let D;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    pod = makeCentralPod({ pod: 'personal' });
    [A, B, C, D] = await Promise.all(['anna', 'bram', 'cas', 'dirk'].map((w) => boot(w, pod)));
    await connectNodesOverRelay([A, B, C, D], { relayUrl: relay.url });
    await createCircle(A, { groupId: CIRCLE, name: 'Centrale Pod Leden' });
    for (const [n, handle] of [[B, 'bram'], [D, 'dirk']]) {
      const j = await joinExistingCircle(A, n, { groupId: CIRCLE, handle });
      expect(j.joined?.ok, JSON.stringify(j.joined)).toBe(true);
    }
    await bindCircleAddresses([A, B, D], CIRCLE);
    await Promise.all([A, B, D].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE })));
    expect(await B.podCustody.circleSendDataMove(CIRCLE)).toBe('pod-only');
  }, 180_000);

  afterAll(async () => {
    await teardown(A, B, C, D);
    try { await relay?.close?.(); } catch { /* gone already */ }
  });

  it('relay up: Cas joins, and Bram learns it member to member (the pod carries no membership row)', async () => {
    const podRowsBefore = (await B.podCustody.circlePodReadSince(CIRCLE, { sinceTs: 0 })).items.length;
    const j = await joinExistingCircle(A, C, { groupId: CIRCLE, handle: 'cas' });
    expect(j.joined?.ok, JSON.stringify(j.joined)).toBe(true);
    await bindCircleAddresses([C], CIRCLE);
    await bindCircleAddressKeysFor({ agent: C.agent, circleId: CIRCLE });
    const learned = await until(async () => ((await knows(B, C)) ? true : null), { timeout: 20_000, step: 400 });
    const podRowsAfter = (await B.podCustody.circlePodReadSince(CIRCLE, { sinceTs: 0 })).items.length;
    console.info('[measure] join:', JSON.stringify({ bramKnowsCas: !!learned, podRowsBefore, podRowsAfter }));
    expect(learned, "Bram's roster never gained Cas").toBe(true);
    // the measurement: the join did not travel on the pod (no new pod row), so it crossed member to member
    expect(podRowsAfter).toBe(podRowsBefore);
  }, 60_000);

  it('relay up: Anna removes Cas, and Bram learns it', async () => {
    const r = await A.agent.callSkill('pinboard', 'removeMember', { groupId: CIRCLE, memberWebid: C.agent.circleSelf?.(CIRCLE)?.webid ?? C.pubKey });
    console.info('[measure] remove result:', JSON.stringify(r).slice(0, 300));
    const gone = await until(async () => ((await knows(B, C)) ? null : true), { timeout: 20_000, step: 400 });
    expect(gone, "Bram's roster still has Cas after Anna removed him").toBe(true);
  }, 60_000);

  // KNOWN RED, pinned: membership has no pod carrier, so with the relay gone a removal never reaches Bram. `it.fails`
  // goes red the day a carrier reads membership back from the pod: then make it a plain `it`.
  it.fails('relay gone: Anna removes Dirk, and Bram learns it from the pod alone', async () => {
    expect(await knows(B, D), 'precondition: Bram knows Dirk').toBe(true);
    await relay.close();
    await A.agent.callSkill('pinboard', 'removeMember', { groupId: CIRCLE, memberWebid: D.agent.circleSelf?.(CIRCLE)?.webid ?? D.pubKey });
    await B.podChatCatchUp.catchUpCircle(CIRCLE);
    const gone = await until(async () => ((await knows(B, D)) ? null : true), { timeout: 8_000, step: 400 });
    expect(gone, "Bram still has Dirk: nothing carried the removal").toBe(true);
  }, 60_000);
});
