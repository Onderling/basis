/**
 * A DEVICE ENROLLED WITH A PERSONA REJOINS THAT PERSONA'S CIRCLES — as the persona, without readmission. The offer names
 * each persona's circles inside its SEALED part (never in the clear: that would tie the persona to the person to anyone
 * who sees the offer); the new device opens them with the phrase at the ceremony, keeps the picked personas' circles in
 * its own stashed offer, and the boot's consume binds each to its persona before it announces and asks for the seed.
 * Also: a person whose circles are ALL under personas can still add a device (the default has none to offer).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, bindCircleAddresses, until, teardown } from './support/pairRealAgents.js';
import { stashEnrollOffer, consumeEnrollOffer, parseEnrollOffer, pendingEnrollOffer } from '../src/v2/enrollOffer.js';
import { EventLog } from '../src/eventLog.js';
import { initialState as createInitial, finalSubmit as createSubmit } from '../src/core/wizards/createGroupState.js';

const Y = 'werk-circle';
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; };
const log = () => new EventLog({ initial: [], muted: [] });

describe('enrolled with a persona: its circles come along', () => {
  let relay; const nodes = [];
  afterAll(async () => { await teardown(...nodes); await relay?.close?.(); });

  it('the box picks Werk, rejoins Werk\'s circle as Werk, and the offer never names that circle in the clear', async () => {
    relay = await startJourneyRelay();
    const phone = await bootRealAgentNode('phone', { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), deviceLog: log() } });
    nodes.push(phone);
    await connectNodesOverRelay([phone], { relayUrl: relay.url });
    // every circle of this person is under Werk: the default has none
    const w = (await phone.agent.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    const W = phone.agent.persona(w);
    expect((await phone.agent.callSkill('household', 'bindCirclePersona', { circleId: Y, personaId: w, relayUrl: relay.url })).ok).toBe(true);
    const st = createInitial();
    st.groupId = Y; st.name = 'Werk'; st.purpose = 't'; st.persona = w;
    expect((await createSubmit({ state: st, callSkill: (a, o, x) => phone.agent.callSkill(a, o, x) })).result).toBeTruthy();
    await bindCircleAddresses([phone], Y);

    const offer = await phone.agent.callSkill('household', 'buildEnrollOffer', {});
    expect(offer?.ok, JSON.stringify(offer)).toBe(true);
    const parsed = parseEnrollOffer(offer.uri);
    expect(parsed.ok).toBe(true);
    expect(parsed.circles.map((c) => c.id), 'Werk\'s circle is never in the clear').not.toContain(Y);
    expect(offer.uri.includes(W.chatId.pubKey) || offer.uri.includes(phone.agent.circleAddressFor(Y)), 'nothing of Werk in the clear').toBe(false);

    // the box: the offer stashed, the phrase typed, Werk picked
    const storage = memStorage();
    expect((await stashEnrollOffer(storage, offer.uri)).ok).toBe(true);
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() };
    const pre = await bootRealAgentNode('box-pre', { agentOpts: { ...vaults, enrollOfferStorage: storage } });
    const phrase = (await phone.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect((await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'box', personas: [w] })).ok).toBe(true);
    await teardown(pre);
    // the stash the boot consumes now holds Werk's circle, for Werk (on this device only)
    const stashed = await pendingEnrollOffer(storage);
    expect(stashed.circles.find((c) => c.id === Y)?.persona, JSON.stringify(stashed.circles)).toBe(w);

    const box = await bootRealAgentNode('box', { agentOpts: { ...vaults, enrollOfferStorage: storage, deviceLog: log() } });
    nodes.push(box);
    expect(box.agent.persona(w)?.chatId?.pubKey, 'the box runs Werk').toBe(W.chatId.pubKey);
    await box.agent.connectPeerTransport({ relayUrl: relay.url, onPeerMessage: (env) => box._routerRef.fn?.(env), awaitRelayReady: true });
    await box.agent.sa.relays.add(relay.url, { identity: box.agent.persona(w).chatId, awaitReady: true });   // Werk's own socket
    const consumed = await consumeEnrollOffer({
      agent: box.agent, callSkill: (a, o, x) => box.agent.callSkill(a, o, x),
      sendPeerMessage: (to, p, o) => box.agent.sendPeerMessage(to, p, o), storage,
      // the shells' seam (web, mobile and the box all pass it): the circle's address on the relays, as its self
      registerCirclePresence: (ids) => bindCircleAddresses([box], ...(ids ?? [Y])),
    });
    const row = consumed?.circles?.find((c) => c.circleId === Y);
    expect(row?.ok, JSON.stringify(consumed)).toBe(true);
    expect(row.steps, 'recorded on Werk\'s profile (reopened from it at every boot)').toContain('registry');
    expect(box.agent.circleSelf(Y).webid, 'Y is Werk\'s on the box').toBe(W.chatId.pubKey);

    // the phone hears the box under WERK — no invite, no redeem: the same member, one more device
    const boxAddr = box.agent.circleAddressFor(Y);
    const atPhone = await until(async () => {
      const members = (await phone.agent.callSkill('pinboard', 'listGroupMembers', { groupId: Y }))?.members ?? [];
      return members.find((m) => m.webid === W.chatId.pubKey)?.circleAddresses?.includes(boxAddr) ? members : null;
    }, { timeout: 30_000, step: 300 });
    expect(atPhone, 'the phone learned the box\'s address under Werk').toBeTruthy();
    expect(JSON.stringify(atPhone).includes(box.agent.identity.chat.pubKey), 'nothing of the default in Werk\'s circle').toBe(false);

    // the next boot reopens Werk's circle as Werk, from the box's own registry
    await teardown(box); nodes.splice(nodes.indexOf(box), 1);
    const again = await bootRealAgentNode('box-again', { agentOpts: { ...vaults, enrollOfferStorage: storage, deviceLog: log() } });
    nodes.push(again);
    expect(again.agent.circleSelf(Y).webid, 'still Werk\'s after a restart').toBe(W.chatId.pubKey);
  }, 300_000);
});
