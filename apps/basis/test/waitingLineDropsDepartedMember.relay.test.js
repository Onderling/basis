/**
 * A LINE THAT WAITS FOR A MEMBER WHO THEN LEAVES THE CIRCLE STOPS WAITING FOR THEM.
 *
 * A circle line sent while one member had no address yet says, on the sender's log, that it waits for them ('Sent to
 * N of M; the rest follows'). If that member leaves or is removed before their address arrives, nothing will ever
 * reach them, and the bubble must not keep saying the rest follows: the departed member is dropped from the wait.
 *
 * The only seam, as in lineWaitsForAddressAcrossRestart: the sender's inbound router holds back the announcements
 * carrying the late member's address.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { startRelay } from '@onderling/relay';
import { bootPeople, untilTrue } from '../../e2e-journeys/journeys/_app.mjs';
import { createCircle, joinExistingCircle, bindCircleAddresses, sendCircleChat, teardown } from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { DELIVERY_WAITING_ENTRY } from '../src/v2/deliveryState.js';

const GROUP = 'waiting-drops-departed';
const MSG = `${GROUP}-1`;
const newestWaiting = (node) => node.chatEventLog.query({})
  .find((e) => e?.type === 'delivery-state' && e?.payload?.msgId === MSG && e?.payload?.state === DELIVERY_WAITING_ENTRY)?.payload?.waiting ?? null;

describe('a line waiting for a member who leaves', () => {
  let relay = null; const nodes = [];
  afterAll(async () => { await teardown(...nodes); await relay?.stop?.(); });

  it('drops the departed member from the wait', async () => {
    relay = await startRelay({ port: 0 });
    const relayUrl = `ws://127.0.0.1:${relay.port}`;
    const [F, S, R, L] = await bootPeople({ relayUrl, handles: ['founder', 'sender', 'receiver', 'late'] });
    nodes.push(F, S, R, L);
    await createCircle(F, { groupId: GROUP, name: 'Weg' });
    await bindCircleAddresses([F], GROUP);
    for (const [n, h] of [[S, 'sender'], [R, 'receiver']]) {
      expect((await joinExistingCircle(F, n, { groupId: GROUP, handle: h }))?.joined?.ok, `${h} joined`).toBe(true);
      await bindCircleAddresses([n], GROUP);
    }
    const lateAddr = () => L.agent.circleAddressFor(GROUP);
    const live = S._routerRef.fn;
    S._routerRef.fn = (env) => {
      const s = env?.payload?.subtype === 'circle-address-announce' ? JSON.stringify(env.payload) : '';
      return lateAddr() && s.includes(lateAddr()) ? undefined : live(env);
    };
    expect((await joinExistingCircle(F, L, { groupId: GROUP, handle: 'late' }))?.joined?.ok, 'late joined').toBe(true);
    await bindCircleAddresses([L], GROUP);
    for (const n of [F, S, R, L]) await bindCircleAddressKeysFor({ agent: n.agent, circleId: GROUP });
    await untilTrue(async () => ((await S.agent.callSkill('pinboard', 'listGroupMembers', { groupId: GROUP }))?.members ?? []).some((m) => m.webid === L.pubKey), 15000, 200);

    const sent = await sendCircleChat(S, { groupId: GROUP, msgId: MSG, text: 'wacht', ts: Date.now() });
    expect(sent?.error ?? null).toBeNull();
    expect(newestWaiting(S), 'the line waits for the late member').toEqual([L.pubKey]);

    // the founder removes the late member; the sender's roster follows
    const removed = await F.agent.callSkill('pinboard', 'removeMember', { groupId: GROUP, memberWebid: L.pubKey });
    expect(removed?.error ?? null, `removed: ${JSON.stringify(removed)}`).toBeNull();
    const gone = await untilTrue(async () => !((await S.agent.callSkill('pinboard', 'listGroupMembers', { groupId: GROUP }))?.members ?? []).some((m) => m.webid === L.pubKey), 15000, 200);
    expect(gone, 'the sender\'s roster no longer holds the late member').toBe(true);

    expect(await untilTrue(() => (newestWaiting(S) ?? []).length === 0, 10000, 200), `the wait drops them (newest: ${JSON.stringify(newestWaiting(S))})`).toBe(true);
  }, 240000);
});
