/**
 * AN ADMISSION ON A FOUNDER PHONE THAT HAS NOT OPENED THE CIRCLE SINCE ITS RESTART (a normal sealed circle, no pod).
 * Every circle the wizard makes is sealed. The key owner's device builds a circle's producer when the circle is opened;
 * after a restart nothing is open. Anna's phone founds a circle, restarts (a real restart of the phone in Node: its disk
 * kept, a fresh process), and admits Bram without opening the circle. Then a line each way, nothing reloaded: Anna's
 * phone reads what Bram's posts and Bram's reads what Anna's posts. Two phones on one relay, no pod.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { startJourneyRelay } from '../../basis/test/support/testRelay.js';
import { createCircle, joinExistingCircle, until } from '../../basis/test/support/pairRealAgents.js';
import { circleChatMessageEvent, broadcastCircleFanOut } from '@onderling/kring-host/circleBroadcast';
import { policyPatchFromState } from '../../basis/src/core/wizards/createGroupState.js';
import { bootMobileNode } from './support/mobileNode.js';

const G = 'admitted-before-open';
const chatIn = (node) => node.eventLog.query({}).map((e) => e?.payload?.text ?? e?.payload?.payload?.text ?? null).filter(Boolean);
/** A line posted as the circle screen posts it (CircleLauncherScreen: appendCircleMessage + broadcastFanOut). */
function post(node, text) {
  const msgId = `circle-${G}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const ts = Date.now();
  node.eventLog.append(circleChatMessageEvent({ msgId, ts, circleId: G, actor: 'me', text }));
  broadcastCircleFanOut({
    rawCallSkill: node.bundle.callSkill, circleId: G, msgId, text, ts, deliveryStateMap: node.deliveryMap, onChange: () => {},
    signStatement: (cid, mid) => node.bundle.agent?.chatRail?.signEntry?.(cid, mid) ?? null,
  });
}

describe('an admission on a founder phone that has not opened the circle since its restart', () => {
  let relay; let anna; let bram;
  afterAll(async () => {
    for (const n of [anna, bram]) { try { await n?.dispose?.(); } catch { /* */ } }
    try { await relay?.close?.(); } catch { /* */ }
  });

  it('a line each way: Anna\'s phone reads Bram\'s, Bram\'s reads Anna\'s', async () => {
    relay = await startJourneyRelay();
    anna = await bootMobileNode({ name: 'anna', relayUrl: relay.url });
    // the wizard's circle (no pod; sealed, as every wizard circle) and its policy as the create modal persists it
    const { state: made } = await createCircle(anna, { groupId: G, name: 'Straat', handle: 'anna' });
    await anna.persistPolicy(G, policyPatchFromState(made));
    expect((await anna.policyOf(G))?.storagePosture, 'a wizard circle is sealed').toBe('p2');

    // the founder's first policy is stated on the lane (the create modal does not wait for it; a person does not restart
    // within that moment)
    expect(await until(() => anna.eventLog.query({}).some((e) => e?.type === 'governance' && JSON.stringify(e).includes(G) && /policy-update/.test(JSON.stringify(e))), { timeout: 15_000, step: 200 }), 'Anna stated the circle\'s policy').toBe(true);
    // Anna's phone restarts: its disk kept, a fresh process; the circle is not opened afterwards
    const disk = await anna.snapshot();
    await anna.dispose();
    anna = await bootMobileNode({ name: 'anna', relayUrl: relay.url, restoreFrom: disk });
    await anna.bundle.registerCirclePresence?.([G]);

    bram = await bootMobileNode({ name: 'bram', relayUrl: relay.url });
    bram.sendPeerRedeem = bram.bundle.sendPeerRedeem;
    bram.onJoined = bram.bundle.onCircleJoined;
    const joined = await joinExistingCircle(anna, bram, { groupId: G, handle: 'bram' });
    expect(joined.joined?.ok, JSON.stringify(joined.joined)).toBe(true);
    expect(await until(async () => (await bram.policyOf(G))?.storagePosture === 'p2', { timeout: 30_000, step: 500 }), 'Bram holds the circle as sealed').toBe(true);

    post(bram, 'van bram aan anna');
    expect(await until(() => chatIn(anna).includes('van bram aan anna'), { timeout: 30_000, step: 250 }), `Anna's phone reads Bram's line: ${JSON.stringify(chatIn(anna))}`).toBe(true);
    post(anna, 'van anna aan bram');
    expect(await until(() => chatIn(bram).includes('van anna aan bram'), { timeout: 30_000, step: 250 }), `Bram's phone reads Anna's line: ${JSON.stringify(chatIn(bram))}`).toBe(true);
  }, 180_000);

  // THE KEY'S CONSUMER: the scoped write (the noticeboard through the circle's scope), each way, after Anna's real restart
  // and without her opening the circle before Bram posts.
  it('a noticeboard post each way through the circle\'s scope: Anna reads Bram\'s, Bram reads Anna\'s', async () => {
    const G2 = 'admitted-before-open-post';
    relay = relay ?? await startJourneyRelay();
    for (const n of [anna, bram]) { try { await n?.dispose?.(); } catch { /* */ } }
    anna = await bootMobileNode({ name: 'anna', relayUrl: relay.url });
    const { state: made } = await createCircle(anna, { groupId: G2, name: 'Bord', handle: 'anna' });
    await anna.persistPolicy(G2, policyPatchFromState(made));
    expect(await until(() => anna.eventLog.query({}).some((e) => e?.type === 'governance' && JSON.stringify(e).includes(G2) && /policy-update/.test(JSON.stringify(e))), { timeout: 15_000, step: 200 })).toBe(true);
    const disk = await anna.snapshot();
    await anna.dispose();
    anna = await bootMobileNode({ name: 'anna', relayUrl: relay.url, restoreFrom: disk });
    await anna.bundle.registerCirclePresence?.([G2]);

    bram = await bootMobileNode({ name: 'bram', relayUrl: relay.url });
    bram.sendPeerRedeem = bram.bundle.sendPeerRedeem;
    bram.onJoined = bram.bundle.onCircleJoined;
    const joined = await joinExistingCircle(anna, bram, { groupId: G2, handle: 'bram' });
    expect(joined.joined?.ok, JSON.stringify(joined.joined)).toBe(true);
    expect(await until(async () => (await bram.policyOf(G2))?.storagePosture === 'p2', { timeout: 30_000, step: 500 })).toBe(true);

    await bram.openCircle(G2);
    const bramCall = await bram.circleCall(G2);
    const bramPost = await bramCall('pinboard', 'postRequest', { intent: 'ask', text: 'wie heeft een ladder', groupId: G2 }).catch((e) => ({ thrown: e?.message ?? String(e) }));

    await anna.openCircle(G2);
    const annaCall = await anna.circleCall(G2);
    const texts = async (call) => ((await call('pinboard', 'listFeed', { groupId: G2 }).catch(() => null))?.items ?? []).map((i) => i?.text ?? '').filter(Boolean);
    const annaSaw = await until(async () => ((await texts(annaCall)).includes('wie heeft een ladder') ? true : null), { timeout: 20_000, step: 500 });

    const annaPost = await annaCall('pinboard', 'postRequest', { intent: 'ask', text: 'wie leent een boor', groupId: G2 }).catch((e) => ({ thrown: e?.message ?? String(e) }));
    const bramSaw = await until(async () => ((await texts(bramCall)).includes('wie leent een boor') ? true : null), { timeout: 20_000, step: 500 });

    expect(annaSaw, 'Anna reads Bram\'s post').toBe(true);
    expect(bramSaw, 'Bram reads Anna\'s post').toBe(true);
  }, 240_000);
});
