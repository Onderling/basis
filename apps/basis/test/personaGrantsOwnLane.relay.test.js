/**
 * A PERSONA'S GRANTS RIDE THE PERSONA'S OWN LANE, over a real relay. (Setup as the own-lane story below: every circle
 * of the person is under Werk; the box is enrolled holding Werk.) The phone pairs a view AS Werk: the box — Werk's
 * sibling — receives the grant on Werk's lane and lists it under Werk; nothing of it crosses the relay between a Werk
 * address and a default address; a revoke on the phone binds on the box.
 *
 * (The own-lane story's header, kept for the setup it describes:) THE OWN LANE IS PER SELF. The person's own scope (their device map, their own appointments, the planned book) rode
 * one lane carried to the DEFAULT's siblings — devices found through circles the default shares. A person whose circles
 * are all under a persona has no such sibling, so nothing of the own scope reached their other device; and the device
 * map is what the revoke ceremony needs to cut off a lost device under every persona.
 *
 * Now each held self has its own lane, carried AS that self to that self's siblings: Werk's lane over Werk's addresses,
 * the default's over the default's, never crossing — asserted on what the relay itself forwarded. The device-link row
 * rides every held self's lane, so a surviving device that shares only Werk with the lost one can still revoke it.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, bindCircleAddresses, until, teardown } from './support/pairRealAgents.js';
import { stashEnrollOffer, consumeEnrollOffer } from '../src/v2/enrollOffer.js';
import { AgentIdentity } from '@onderling/core';
import { GRANTS_BROADCAST } from '../src/v2/grantsRail.js';
import { initialState as createInitial, finalSubmit as createSubmit } from '../src/core/wizards/createGroupState.js';

const Y = 'werk-circle';
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; };
const short = (a) => (a ? `${String(a).slice(0, 12)}…` : null);

describe("a persona's grants ride its own lane", () => {
  let relay; const nodes = []; const relayLines = [];
  afterAll(async () => { vi.restoreAllMocks(); await teardown(...nodes); await relay?.close?.(); });

  it('the box, Werk\'s sibling, gets Werk\'s grant on Werk\'s lane only, and a revoke reaches it', async () => {
    const origLog = console.log;
    vi.spyOn(console, 'log').mockImplementation((...a) => {
      const line = String(a[0] ?? '');
      if (line.startsWith('[relay] ')) { relayLines.push(line); return; }
      origLog(...a);
    });
    relay = await startJourneyRelay({ log: true });
    const phone = await bootRealAgentNode('phone', { itemsLane: true, agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() } });
    nodes.push(phone);
    await connectNodesOverRelay([phone], { relayUrl: relay.url });
    const w = (await phone.agent.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    const W = phone.agent.persona(w);
    expect((await phone.agent.callSkill('household', 'bindCirclePersona', { circleId: Y, personaId: w, relayUrl: relay.url })).ok).toBe(true);
    const st = createInitial();
    st.groupId = Y; st.name = 'Werk'; st.purpose = 't'; st.persona = w;
    expect((await createSubmit({ state: st, callSkill: (a, o, x) => phone.agent.callSkill(a, o, x) })).result).toBeTruthy();
    await bindCircleAddresses([phone], Y);

    const offer = await phone.agent.callSkill('household', 'buildEnrollOffer', {});
    const storage = memStorage();
    expect((await stashEnrollOffer(storage, offer.uri)).ok).toBe(true);
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() };
    const pre = await bootRealAgentNode('box-pre', { agentOpts: { ...vaults, enrollOfferStorage: storage } });
    const phrase = (await phone.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect((await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'box', personas: [w] })).ok).toBe(true);
    await teardown(pre);
    const box = await bootRealAgentNode('box', { itemsLane: true, agentOpts: { ...vaults, enrollOfferStorage: storage } });
    nodes.push(box);
    await box.agent.connectPeerTransport({ relayUrl: relay.url, onPeerMessage: (env) => box._routerRef.fn?.(env), awaitRelayReady: true });
    await box.agent.sa.relays.add(relay.url, { identity: box.agent.persona(w).chatId, awaitReady: true });
    const consumed = await consumeEnrollOffer({
      agent: box.agent, callSkill: (a, o, x) => box.agent.callSkill(a, o, x),
      sendPeerMessage: (to, p, o) => box.agent.sendPeerMessage(to, p, o), storage,
      registerCirclePresence: (ids) => bindCircleAddresses([box], ...(ids ?? [Y])),
    });
    expect(consumed?.circles?.find((c) => c.circleId === Y)?.ok, JSON.stringify(consumed)).toBe(true);
    // the grants lane as the shells register it (circleLanes): one receiver, one catch-up, routed by the lane named
    for (const node of [phone, box]) {
      const prior = node._routerRef.fn;
      const cu = node.agent.grantsCatchUp;
      node._routerRef.fn = (env) => {
        const st2 = env?.payload?.subtype;
        if (st2 === GRANTS_BROADCAST) return node.agent.grantsPeerHandler(env.from, env.payload);
        if (st2 === cu.subtypes.request) return cu.onRequest(env.from, env.payload);
        if (st2 === cu.subtypes.batch) return cu.onBatch(env.from, env.payload);
        return prior?.(env);
      };
    }

    // the phone pairs a view AS Werk
    const view = await AgentIdentity.generate(new VaultMemory());
    const before = relayLines.length;
    const granted = await phone.agent.callSkill('household', 'grantSurface', { viewPubKey: view.pubKey, ops: ['params.set-param'], label: 'werkscherm', persona: w });
    expect(granted?.ok, JSON.stringify(granted)).toBe(true);
    const onBox = async () => ((await box.agent.callSkill('household', 'listSurfaceGrants', {}))?.surfaces ?? []).find((s) => s.viewPubKey === view.pubKey) ?? null;
    let row = await until(onBox, { timeout: 15_000, step: 250 });
    if (!row) { await box.agent.grantsCatchUp.requestFromSiblings(); row = await until(onBox, { timeout: 15_000, step: 250 }); }
    expect(row, 'the box received Werk\'s grant').toBeTruthy();
    expect(row.persona, 'and holds it under Werk').toBe(w);

    // nothing of it crossed between a Werk address and a default address, as the relay saw it
    const phoneDefault = new Set([phone.pubKey, phone.agent.personAddress?.()].filter(Boolean).map(short));
    const phoneWerk = new Set([W.chatId.pubKey, W.personIdentity?.pubKey, phone.agent.circleAddressFor(Y)].filter(Boolean).map(short));
    const BW = box.agent.persona(w);
    const boxDefault = new Set([box.pubKey, box.agent.personAddress?.()].filter(Boolean).map(short));
    const boxWerk = new Set([BW.chatId.pubKey, BW.personIdentity?.pubKey, box.agent.circleAddressFor(Y)].filter(Boolean).map(short));
    const forwards = relayLines.slice(before).map((l) => /^\[relay\] (\S+) → (\S+)/.exec(l)).filter(Boolean).map((m) => ({ from: m[1], to: m[2] }));
    expect(forwards.length, 'the relay forwarded the grant').toBeGreaterThan(0);
    expect(forwards.filter((f) => phoneDefault.has(f.from) && boxWerk.has(f.to)), 'default → Werk').toEqual([]);
    expect(forwards.filter((f) => phoneWerk.has(f.from) && boxDefault.has(f.to)), 'Werk → default').toEqual([]);
    expect(forwards.filter((f) => phoneDefault.has(f.from) && boxDefault.has(f.to)), 'default → default (a Werk grant on the default\'s lane)').toEqual([]);

    // a revoke on the phone, as Werk, binds on the box
    expect((await phone.agent.callSkill('household', 'revokeSurface', { viewPubKey: view.pubKey }))?.revoked).toBeTruthy();
    let gone = await until(async () => ((await onBox()) ? null : true), { timeout: 15_000, step: 250 });
    if (!gone) { await box.agent.grantsCatchUp.requestFromSiblings(); gone = await until(async () => ((await onBox()) ? null : true), { timeout: 15_000, step: 250 }); }
    expect(gone, 'the revoke reached the box').toBe(true);
  }, 300_000);
});
