/**
 * THE REPLACE CEREMONY ON A REALLY RESTORED PHONE, WITH THE ADDRESS FALLBACK OFF — the production path, walked.
 *
 * `replaceDevice.test.js` assembles a restored phone by hand over the in-process bus, and the harness used to default
 * the address fallback ON: a circle statement could then reach a member through their canonical key, which a real
 * person's device does not do unless they chose it. Here every node runs with the fallback OFF (the default), over a
 * real relay, and the new phone is restored the way the shells do it — the phrase, the recovery file's import, the
 * enrol offer it bootstraps, the consume — before it runs the ceremony.
 *
 *   1  the phone and Bea in a sealed circle; the recovery file (with the circle's member list)
 *   2  the phone is gone; a new phone: the phrase, the file, the consume — the circle talks again
 *   3  the replace ceremony on the new phone: Bea's row for the person moves to the new address, the old one gone
 *
 * Written to be red against the reading that the ceremony cannot reach a member with the fallback off (members refuse the
 * first sends from the new address until they have folded its introduction) — on this real path it is GREEN: the
 * restored phone holds the members' addresses from the file, and the ceremony lands. The red seen in
 * `replaceDevice.test.js` came from that walk's hand-assembled restore, not from the product.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { EventLog } from '../src/eventLog.js';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, pairCircle, bindCircleAddresses, sendCircleChat, until, teardown } from './support/pairRealAgents.js';
import { stashEnrollOffer, consumeEnrollOffer } from '../src/v2/enrollOffer.js';
import { rosterBindingVerifier } from '../src/v2/membershipRail.js';

const CIRCLE = 'thuis-replace-after-restore';
const NO_FALLBACK = { allowAddressFallback: false };   // the person's address-fallback setting, as it is by default
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; };
const chatIn = (node, circleId) => node.chatRail.storedStatements(circleId).map((s) => s?.body?.payload?.text).filter(Boolean);
const arrives = (node, circleId, text, why) => until(async () => (chatIn(node, circleId).includes(text) ? true : null), { timeout: 25_000, step: 200 }).then((got) => expect(got, why).toBe(true));
const log = () => new EventLog({ initial: [], muted: [] });

describe('the replace ceremony on a really restored phone, address fallback off', () => {
  let relay; let phone; let bea; let newPhone; let phrase; let file;
  const newPhoneVaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
  const beaRef = {}; const newRef = {};
  const productionBinding = (ref) => rosterBindingVerifier((app, op, args) => ref.node.agent.callSkill(app, op, args));

  beforeAll(async () => {
    relay = await startJourneyRelay();
    // 1 · the phone and Bea, one circle, a conversation; the recovery file
    phone = await bootRealAgentNode('phone', { agentOpts: { ...NO_FALLBACK, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), deviceLog: log() } });
    bea = await bootRealAgentNode('bea', { verifyChatBinding: productionBinding(beaRef), agentOpts: { ...NO_FALLBACK, deviceLog: log() } });
    beaRef.node = bea;
    await connectNodesOverRelay([phone, bea], { relayUrl: relay.url });
    await pairCircle(phone, bea, { groupId: CIRCLE, name: 'Thuis', handle: 'bea' });
    await bindCircleAddresses([phone, bea], CIRCLE);
    await sendCircleChat(phone, { groupId: CIRCLE, msgId: 'pre-1', text: 'voordat de telefoon kwijtraakte' });
    await arrives(bea, CIRCLE, 'voordat de telefoon kwijtraakte', 'Bea never received the pre-loss message');
    phrase = (await phone.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const exported = await phone.agent.callSkill('household', 'exportRecoveryFile', {});
    expect(exported.ok, JSON.stringify(exported)).toBe(true);
    file = exported.file;
  }, 240_000);
  afterAll(async () => { await teardown(phone, bea, newPhone); await relay?.close?.(); });

  it('2 · the phone is gone; the phrase and the file bring the circle back on a new phone, talking', async () => {
    await teardown(phone);
    phone = null;
    const pre = await bootRealAgentNode('new-phone-pre', { agentOpts: newPhoneVaults });
    expect(await pre.agent.callSkill('household', 'restoreOwnerPhrase', { mnemonic: phrase })).toMatchObject({ ok: true, reloadRequired: true });
    await teardown(pre);
    newPhone = await bootRealAgentNode('new-phone', { agentOpts: { ...NO_FALLBACK, ...newPhoneVaults, registryBackend: createMemoryBackend(), deviceLog: log() }, verifyChatBinding: productionBinding(newRef) });
    newRef.node = newPhone;
    await newPhone.agent.connectPeerTransport({ relayUrl: relay.url, onPeerMessage: (env) => newPhone._routerRef.fn?.(env), awaitRelayReady: true });
    const imported = await newPhone.agent.callSkill('household', 'importRecoveryFile', { file });
    expect(imported.ok, imported.error).toBe(true);
    const storage = memStorage();
    expect((await stashEnrollOffer(storage, imported.bootstrap.offer)).ok).toBe(true);
    await bindCircleAddresses([newPhone], CIRCLE);
    const consumed = await consumeEnrollOffer({
      agent: newPhone.agent,
      callSkill: (app, op, args) => newPhone.agent.callSkill(app, op, args),
      sendPeerMessage: (to, payload, opts) => newPhone.agent.sendPeerMessage(to, payload, opts),
      storage,
      contentPulls: (circleId, address) => newPhone.chatCatchUp.requestFrom(address, circleId),
    });
    expect(consumed.circles?.find((c) => c.circleId === CIRCLE)?.ok, JSON.stringify(consumed)).toBe(true);
    await arrives(newPhone, CIRCLE, 'voordat de telefoon kwijtraakte', 'the conversation from before the loss did not come back');
    await sendCircleChat(bea, { groupId: CIRCLE, msgId: 'post-1', text: 'ben je er weer?' });
    await arrives(newPhone, CIRCLE, 'ben je er weer?', 'Bea\'s message did not reach the new phone');
  }, 240_000);

  it('3 · the replace ceremony moves Bea\'s row for the person to the new phone\'s address — the old one gone', async () => {
    const before = newPhone.agent.circleAddressFor(CIRCLE);
    const r = await newPhone.agent.callSkill('household', 'replaceDevice', { mnemonic: phrase, circleIds: [CIRCLE] });
    expect(r.ok, r.error).toBe(true);
    const next = newPhone.agent.circleAddressFor(CIRCLE);
    const moved = await until(async () => {
      const me = ((await bea.agent.callSkill('pinboard', 'listGroupMembers', { groupId: CIRCLE }))?.members ?? []).find((m) => m.webid === newPhone.pubKey);
      const set = [me?.circleAddress, ...(me?.circleAddresses ?? [])].filter(Boolean);
      return set.includes(next) && !set.includes(before) ? true : null;
    }, { timeout: 30_000, step: 250 });
    expect(moved, 'Bea\'s row for the person did not move to the new address').toBe(true);
    // …and the circle talks on, from the new address: the new phone writes, Bea reads it; Bea answers, the new phone reads it
    await sendCircleChat(newPhone, { groupId: CIRCLE, msgId: 'after-1', text: 'na de wissel' });
    await arrives(bea, CIRCLE, 'na de wissel', 'Bea never read what the new phone wrote after the ceremony');
    await sendCircleChat(bea, { groupId: CIRCLE, msgId: 'after-2', text: 'gezien' });
    await arrives(newPhone, CIRCLE, 'gezien', 'the new phone never read Bea\'s answer after the ceremony');
  }, 120_000);
});
