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

  // THE PLAIN FLOW: no restart, the founder's circle open (her producer live) when she admits Bram, so her key IS wrapped
  // to him. Bram opens the circle and posts on the noticeboard; Anna reads it.
  it('the plain flow: Anna\'s circle open at the admission, Bram opens and posts, Anna reads it', async () => {
    const G3 = 'plain-flow-post';
    relay = relay ?? await startJourneyRelay();
    for (const n of [anna, bram]) { try { await n?.dispose?.(); } catch { /* */ } }
    anna = await bootMobileNode({ name: 'anna', relayUrl: relay.url });
    const { state: made } = await createCircle(anna, { groupId: G3, name: 'Gewoon', handle: 'anna' });
    await anna.persistPolicy(G3, policyPatchFromState(made));
    expect(await until(() => anna.eventLog.query({}).some((e) => e?.type === 'governance' && JSON.stringify(e).includes(G3) && /policy-update/.test(JSON.stringify(e))), { timeout: 15_000, step: 200 })).toBe(true);
    await anna.openCircle(G3);
    await anna.bundle.registerCirclePresence?.([G3]);   // the launcher registers the new circle's presence
    bram = await bootMobileNode({ name: 'bram', relayUrl: relay.url });
    bram.sendPeerRedeem = bram.bundle.sendPeerRedeem;
    bram.onJoined = bram.bundle.onCircleJoined;
    const joined = await joinExistingCircle(anna, bram, { groupId: G3, handle: 'bram' });
    expect(joined.joined?.ok, JSON.stringify(joined.joined)).toBe(true);
    expect(await until(async () => (await bram.policyOf(G3))?.storagePosture === 'p2', { timeout: 30_000, step: 500 }), 'Bram holds the circle as sealed').toBe(true);
    await bram.openCircle(G3);
    const bramCall = await bram.circleCall(G3);
    const bramPost = await bramCall('pinboard', 'postRequest', { intent: 'ask', text: 'gewoon een vraag', groupId: G3 }).catch((e) => ({ thrown: e?.message ?? String(e) }));
    const annaCall = await anna.circleCall(G3);
    const texts = async (call) => ((await call('pinboard', 'listFeed', { groupId: G3 }).catch(() => null))?.items ?? []).map((i) => i?.text ?? '').filter(Boolean);
    const annaSaw = await until(async () => ((await texts(annaCall)).includes('gewoon een vraag') ? true : null), { timeout: 20_000, step: 500 });
    expect(annaSaw, 'Anna reads Bram\'s post').toBe(true);
  }, 240_000);

  // THE JOINER OPENS AT ONCE: Bram opens the circle the moment his join returns and posts straight away. Each post is
  // either REFUSED ('sealed-circle-key-not-ready': the key has not reached him) or sealed under the circle's one key;
  // never under a key of his own making. Once the key has landed his post goes, and Anna reads it.
  it('the joiner opens at once: refused until the key arrives, then his post reaches the founder', async () => {
    const G4 = 'joiner-opens-at-once';
    relay = relay ?? await startJourneyRelay();
    for (const n of [anna, bram]) { try { await n?.dispose?.(); } catch { /* */ } }
    anna = await bootMobileNode({ name: 'anna', relayUrl: relay.url });
    const { state: made } = await createCircle(anna, { groupId: G4, name: 'Meteen', handle: 'anna' });
    await anna.persistPolicy(G4, policyPatchFromState(made));
    expect(await until(() => anna.eventLog.query({}).some((e) => e?.type === 'governance' && JSON.stringify(e).includes(G4) && /policy-update/.test(JSON.stringify(e))), { timeout: 15_000, step: 200 })).toBe(true);
    await anna.openCircle(G4);
    await anna.bundle.registerCirclePresence?.([G4]);
    bram = await bootMobileNode({ name: 'bram', relayUrl: relay.url });
    bram.sendPeerRedeem = bram.bundle.sendPeerRedeem;
    bram.onJoined = bram.bundle.onCircleJoined;
    const joined = await joinExistingCircle(anna, bram, { groupId: G4, handle: 'bram' });
    expect(joined.joined?.ok, JSON.stringify(joined.joined)).toBe(true);

    // at once: open, post, and keep posting until one goes
    await bram.openCircle(G4);
    const outcomes = [];
    let sentText = null;
    for (let i = 0; i < 60 && !sentText; i += 1) {
      const text = `meteen ${i}`;
      const bramCall = await bram.circleCall(G4);
      const r = await bramCall('pinboard', 'postRequest', { intent: 'ask', text, groupId: G4 }).catch((e) => ({ thrown: e?.message ?? String(e) }));
      outcomes.push(r?.ok === true ? 'posted' : String(r?.thrown ?? r?.error ?? 'other'));
      if (r?.ok === true) sentText = text;
      else await new Promise((res) => { setTimeout(res, 500); });
    }
    // what is not posted is refused for the one reason: the key has not reached this device yet
    for (const o of outcomes.filter((x) => x !== 'posted')) expect(o, `a refusal other than 'key not ready': ${JSON.stringify(outcomes)}`).toMatch(/sealed-circle-key-not-ready/);
    expect(sentText, `Bram's post went once the key had landed: ${JSON.stringify(outcomes)}`).toBeTruthy();
    const annaCall = await anna.circleCall(G4);
    const texts = async (call) => ((await call('pinboard', 'listFeed', { groupId: G4 }).catch(() => null))?.items ?? []).map((i) => i?.text ?? '').filter(Boolean);
    expect(await until(async () => ((await texts(annaCall)).includes(sentText) ? true : null), { timeout: 20_000, step: 500 }), `Anna reads Bram's post: ${JSON.stringify(await texts(annaCall))}`).toBe(true);
  }, 240_000);

  // A ROTATION AFTER A REMOVAL: the member's NEXT post is sealed under the new version (the one his key log now holds,
  // not a strategy he cached), the founder reads it, and the removed member is not given that version.
  it('after a removal the member\'s next post is sealed under the new version, and the founder reads it', async () => {
    const G5 = 'rotation-next-post';
    relay = relay ?? await startJourneyRelay();
    for (const n of [anna, bram]) { try { await n?.dispose?.(); } catch { /* */ } }
    anna = await bootMobileNode({ name: 'anna', relayUrl: relay.url });
    const { state: made } = await createCircle(anna, { groupId: G5, name: 'Wissel', handle: 'anna' });
    await anna.persistPolicy(G5, policyPatchFromState(made));
    expect(await until(() => anna.eventLog.query({}).some((e) => e?.type === 'governance' && JSON.stringify(e).includes(G5) && /policy-update/.test(JSON.stringify(e))), { timeout: 15_000, step: 200 })).toBe(true);
    await anna.openCircle(G5);
    await anna.bundle.registerCirclePresence?.([G5]);
    bram = await bootMobileNode({ name: 'bram', relayUrl: relay.url });
    const cato = await bootMobileNode({ name: 'cato', relayUrl: relay.url });
    try {
      for (const n of [bram, cato]) { n.sendPeerRedeem = n.bundle.sendPeerRedeem; n.onJoined = n.bundle.onCircleJoined; }
      for (const [n, h] of [[bram, 'bram'], [cato, 'cato']]) {
        const j = await joinExistingCircle(anna, n, { groupId: G5, handle: h });
        expect(j.joined?.ok, JSON.stringify(j.joined)).toBe(true);
      }
      for (const n of [bram, cato]) expect(await until(async () => (await n.policyOf(G5))?.storagePosture === 'p2', { timeout: 30_000, step: 500 }), `${n.name} holds the circle as sealed`).toBe(true);
      await bram.openCircle(G5);
      const postAs = async (node, text) => { for (let i = 0; i < 40; i += 1) { const r = await (await node.circleCall(G5))('pinboard', 'postRequest', { intent: 'ask', text, groupId: G5 }).catch((e) => ({ thrown: e?.message })); if (r?.ok) return r; await new Promise((res) => { setTimeout(res, 500); }); } return null; };
      const before = await postAs(bram, 'voor de wissel');
      expect(before?.ok, 'Bram posts before the removal').toBe(true);

      // the control, while Cato is still in: his phone holds the policy and opens Bram's post (his opener works)
      const sealedOf = (r) => String(r?.message ?? '').replace(/^.*Posted:\s*/, '');
      expect(await until(async () => ((await cato.openSealed(G5, sealedOf(before))) === 'voor de wissel' ? true : null), { timeout: 30_000, step: 500 }), 'Cato opens the post from before the removal').toBe(true);
      // Anna removes Cato: the key rotates
      const catoWebid = cato.agent.circleSelf?.(G5)?.webid ?? cato.pubKey;
      const removed = await anna.callSkill('pinboard', 'removeMember', { groupId: G5, memberWebid: catoWebid, reason: 'test' });
      expect(removed?.ok ?? !removed?.error, `the removal: ${JSON.stringify(removed)}`).toBeTruthy();
      const keyVersions = (n) => n.eventLog.query({}).filter((e) => e?.type === 'key-event' && JSON.stringify(e).includes(G5)).map((e) => (e.payload?.event ?? e.payload?.body?.payload?.event ?? e.payload)?.version ?? null);
      expect(await until(() => keyVersions(bram).includes(2), { timeout: 30_000, step: 500 }), `Bram holds version 2: ${JSON.stringify(keyVersions(bram))}`).toBe(true);

      const after = await postAs(bram, 'na de wissel');
      expect(after?.ok, 'Bram posts after the removal').toBe(true);
      // sealed under the NEW version: the removed member, who holds only the old one, cannot open it (and can open the
      // post from before: his opener works)
      expect(await cato.openSealed(G5, sealedOf(after)), 'Cato cannot open Bram\'s next post: it is sealed under the new version').toBeNull();
      const texts = async (node) => ((await (await node.circleCall(G5))('pinboard', 'listFeed', { groupId: G5 }).catch(() => null))?.items ?? []).map((i) => i?.text ?? '').filter(Boolean);
      expect(await until(async () => ((await texts(anna)).includes('na de wissel') ? true : null), { timeout: 20_000, step: 500 }), `Anna reads it: ${JSON.stringify(await texts(anna))}`).toBe(true);
      expect(keyVersions(cato).includes(2), 'the removed member is not given version 2').toBe(false);
    } finally { try { await cato.dispose(); } catch { /* */ } }
  }, 240_000);
});
