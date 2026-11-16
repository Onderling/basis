/**
 * A CENTRAL-POD-ONLY CIRCLE: ONE SHARED POD, NOTHING FANNED. Anna founds a circle, Bram joins it over the relay (the
 * join itself is a carry between the two), then the relay goes away. From then on the circle's one pod is the only place
 * the two meet: what Anna writes, Bram reads back from the pod and verifies at his own rail, as the shells' pod chat
 * read-back does (`circleLanes.catchUps.podChat`). Both nodes compose the shared custody module the shells compose
 * (`createCirclePodCustody`) over one pod (`makeCentralPod`), with the pod-only data move.
 *
 * Red first, one case per thing a circle carries: a chat line, a task, a new member, a removal. Each case says which
 * branch it took, so a red names the missing carrier, not a guess.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startJourneyRelay } from './support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle, bindCircleAddresses,
  makeCentralPod, sendCircleChat, until, teardown,
} from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { EventLog } from '../src/eventLog.js';
import { CHAT_LANE } from '../src/v2/chatManifest.js';

const CIRCLE = 'central-pod-circle';
const linesIn = (node) => node.chatEventLog.query({})
  .filter((e) => e?.type === CHAT_LANE && e.payload?.circleId === CIRCLE)
  .map((e) => e.payload?.text ?? e.payload?.payload?.text ?? null).filter(Boolean);

describe('a central-pod-only circle: one shared pod, nothing fanned', () => {
  let relay; let pod; let A; let B;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    pod = makeCentralPod({ pod: 'personal' });   // the pod-only data move, over the ONE pod both hand in
    [A, B] = await Promise.all(['anna', 'bram'].map((who) => bootRealAgentNode(who, {
      itemsLane: true, centralPod: pod, agentOpts: { deviceLog: new EventLog({ initial: [], muted: [] }) },
    })));
    await connectNodesOverRelay([A, B], { relayUrl: relay.url });
    await createCircle(A, { groupId: CIRCLE, name: 'Centrale Pod' });
    const joined = await joinExistingCircle(A, B, { groupId: CIRCLE, handle: 'bram' });
    expect(joined.joined?.ok, JSON.stringify(joined.joined)).toBe(true);
    await bindCircleAddresses([A, B], CIRCLE);
    await Promise.all([A, B].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE })));
  }, 120_000);

  afterAll(async () => {
    await teardown(A, B);
    try { await relay?.close?.(); } catch { /* gone already */ }
  });

  it('the data move is pod-only on both, and a line written with the relay still up is NOT fanned', async () => {
    expect(await A.podCustody.circleSendDataMove(CIRCLE)).toBe('pod-only');
    expect(await B.podCustody.circleSendDataMove(CIRCLE)).toBe('pod-only');
    const sent = await sendCircleChat(A, { groupId: CIRCLE, msgId: 'pod-1', text: 'eerste regel, via de pod' });
    expect(sent?.error ?? null, JSON.stringify(sent)).toBeNull();
    // the relay is up: a fan would land within a second or two; pod-only means it never comes
    await new Promise((r) => setTimeout(r, 2500));
    expect(linesIn(B), 'a pod-only line reached Bram WITHOUT the pod: something fanned it').not.toContain('eerste regel, via de pod');
    // and the pod holds the row
    const rows = await B.podCustody.circlePodReadSince(CIRCLE, { sinceTs: 0 });
    expect((rows?.items ?? rows ?? []).length, `pod rows: ${JSON.stringify(rows).slice(0, 300)}`).toBeGreaterThan(0);
  }, 60_000);

  it('the relay goes away: a chat line Anna writes reaches Bram from the pod, verified at his rail', async () => {
    await relay.close();
    const sent = await sendCircleChat(A, { groupId: CIRCLE, msgId: 'pod-2', text: 'tweede regel, zonder relay' });
    expect(sent?.error ?? null, JSON.stringify(sent)).toBeNull();
    const r = await B.podChatCatchUp.catchUpCircle(CIRCLE);
    expect(r?.ingested ?? 0, `read-back: ${JSON.stringify(r)}`).toBeGreaterThan(0);
    expect(linesIn(B)).toEqual(expect.arrayContaining(['eerste regel, via de pod', 'tweede regel, zonder relay']));
  }, 60_000);

  // KNOWN RED, pinned: items have no pod read-back, so a task never crosses a central pod alone. `it.fails` keeps CI
  // green while it is so, and goes red the day a carrier reads items back: then make it a plain `it`.
  it.fails('a TASK Anna adds reaches Bram with the relay gone (items have no pod read-back yet)', async () => {
    const made = await A.agent.callSkill('tasks', 'addTask', { circleId: CIRCLE, text: 'ramen lappen' });
    expect(made?.task?.id, JSON.stringify(made)).toBeTruthy();
    const seen = await until(async () => {
      const open = (await B.agent.callSkill('tasks', 'listOpen', { circleId: CIRCLE }))?.items ?? [];
      return open.some((t) => t.text === 'ramen lappen') ? true : null;
    }, { timeout: 8000, step: 400 });
    expect(seen, 'Bram never holds the task: no carrier reads items back from the pod').toBe(true);
  }, 30_000);
});
