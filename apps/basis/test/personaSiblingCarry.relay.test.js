/**
 * NO PERSON-LEVEL LANE ON THE WIRE (persona arc c4d): a person's own devices carry each other a circle's traffic — but
 * per SELF. What the phone writes in its DEFAULT's circle reaches its box (a sibling of the default); what it writes in
 * persona B's circle never does — the box holds the default, not B, and a sibling carry is the circle's self's
 * siblings only (the devices that hold that persona), never the person's whole device set.
 *
 * Production here: the real factory (phone + an enrolled box), the real relay, the enrol offer and its consume, the
 * create wizard founding Y AS B, the device's own chat rail + fan, the sibling carry.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, createCircle, bindCircleAddresses, until, teardown } from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { stashEnrollOffer, consumeEnrollOffer } from '../src/v2/enrollOffer.js';
import { EventLog } from '../src/eventLog.js';
import { initialState as createInitial, finalSubmit as createSubmit } from '../src/core/wizards/createGroupState.js';

const X = 'thuis-circle';
const Y = 'buurt-circle';
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; };
const textsIn = (node, cid) => node.chatRail.storedStatements(cid).map((s) => s?.body?.payload?.text).filter(Boolean);

describe('the sibling carry is per self', () => {
  let relay; let phone; let box; let personaId;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    phone = await bootRealAgentNode('phone', { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), deviceLog: new EventLog({ initial: [], muted: [] }) } });
    await connectNodesOverRelay([phone], { relayUrl: relay.url });
    await createCircle(phone, { groupId: X, name: 'Thuis' });
    await bindCircleAddresses([phone], X);
    // the box enrols as the phone's sibling (a device of the DEFAULT)
    const offer = await phone.agent.callSkill('household', 'buildEnrollOffer', {});
    const storage = memStorage();
    expect((await stashEnrollOffer(storage, offer.uri)).ok).toBe(true);
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
    const pre = await bootRealAgentNode('box-pre', { agentOpts: { ...vaults, enrollOfferStorage: storage } });
    const phrase = (await phone.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect((await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'box' })).ok).toBe(true);
    await teardown(pre);
    box = await bootRealAgentNode('box', { agentOpts: { ...vaults, deviceLog: new EventLog({ initial: [], muted: [] }) } });
    await box.agent.connectPeerTransport({ relayUrl: relay.url, onPeerMessage: (env) => box._routerRef.fn?.(env), awaitRelayReady: true });
    await bindCircleAddresses([box], X);
    const consumed = await consumeEnrollOffer({
      agent: box.agent, callSkill: (a, o, x) => box.agent.callSkill(a, o, x),
      sendPeerMessage: (to, p, o) => box.agent.sendPeerMessage(to, p, o), storage,
    });
    expect(consumed.circles?.find((c) => c.circleId === X)?.ok, JSON.stringify(consumed)).toBe(true);
    const boxAddr = box.agent.circleAddressFor(X);
    expect(await until(async () => {
      const r = await phone.agent.callSkill('pinboard', 'listGroupMembers', { groupId: X });
      return (r?.members ?? []).find((m) => m.webid === phone.pubKey)?.circleAddresses?.includes(boxAddr) ? true : null;
    }, { timeout: 20_000, step: 100 }), 'the phone knows its sibling').toBe(true);
    for (const n of [phone, box]) await bindCircleAddressKeysFor({ agent: n.agent, circleId: X });

    // the phone founds Y AS persona B (on B's own socket)
    personaId = (await phone.agent.callSkill('agents', 'createProfile', { name: 'Buurt' })).id;
    expect((await phone.agent.callSkill('household', 'bindCirclePersona', { circleId: Y, personaId, relayUrl: relay.url })).ok).toBe(true);
    const st = createInitial();
    st.groupId = Y; st.name = 'Buurt'; st.purpose = 't'; st.persona = personaId;
    expect((await createSubmit({ state: st, callSkill: (a, o, x) => phone.agent.callSkill(a, o, x) })).result).toBeTruthy();
    await bindCircleAddresses([phone], X, Y);
  }, 240_000);

  afterAll(async () => { await teardown(phone, box); await relay?.close?.(); });

  it('a message in the default\'s circle reaches the box (the carry works)', async () => {
    // the send site's own path: the chat emitter (append, the member fan, then the carry to my own devices)
    await phone.agent.chatEmit(X, { msgId: 'x-1', ts: Date.now(), text: 'thuis' });
    expect(await until(async () => (textsIn(box, X).includes('thuis') ? true : null), { timeout: 20_000, step: 200 }), 'the box got the default\'s message').toBe(true);
  }, 60_000);

  it('a message in persona B\'s circle never reaches the box — the box is the default\'s sibling, not B\'s', async () => {
    // every send the phone makes, recorded: the CARRY ATTEMPT is the leak (the relay would see B's circle traffic go to
    // the default's sibling), whether or not the box then refuses it
    const sent = [];
    const peer = phone.agent.sa.peer;
    const orig = peer.sendTo.bind(peer);
    peer.sendTo = (to, env, o) => { sent.push({ to, subtype: env?.subtype ?? env?.type, circleId: env?.circleId ?? null }); return orig(to, env, o); };
    const boxAddrs = new Set([box.pubKey, box.agent.circleAddressFor(X), box.agent.circleAddressFor(Y)].filter(Boolean));
    try {
      await phone.agent.chatEmit(Y, { msgId: 'y-1', ts: Date.now(), text: 'buurt' });
      await new Promise((r) => setTimeout(r, 3000));
    } finally { peer.sendTo = orig; }
    const toBox = sent.filter((x) => boxAddrs.has(x.to) && x.circleId === Y);
    expect(toBox, `B's circle traffic was carried to the default's sibling: ${JSON.stringify(toBox)}`).toEqual([]);
    // given the time the default's needed and more, nothing of Y on the box
    const leaked = await until(async () => (textsIn(box, Y).length || box.received.some((m) => m?.payload?.circleId === Y) ? true : null), { timeout: 8_000, step: 200 });
    expect(leaked, 'nothing of B\'s circle reached the default\'s sibling').toBe(null);
  }, 60_000);
});
