/**
 * A PERSONA'S NEW CIRCLE FOLLOWS TO THE DEVICES HOLDING THAT PERSONA. The phone and its box both run persona Werk; the
 * phone founds a NEW circle as Werk after the box was enrolled. The follow carry names Werk and travels over Werk's own
 * sibling addresses; the box joins it AS Werk (recorded on Werk's profile). Before, only the general persona's circles
 * followed: a persona's new circle stayed on the device that made it.
 *
 * Production here: the real factory (phone + an enrolled box), the real relay, the enrol offer and its consume, the
 * create wizard founding the circle as Werk, the follow sync with the shells' consume step.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, bindCircleAddresses, until, teardown } from './support/pairRealAgents.js';
import { stashEnrollOffer, consumeEnrollOffer, consumeCircleEntry } from '../src/v2/enrollOffer.js';
import { EventLog } from '../src/eventLog.js';
import { initialState as createInitial, finalSubmit as createSubmit } from '../src/core/wizards/createGroupState.js';

const Y = 'werk-circle';
const Z = 'werk-new-circle';
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; };
const log = () => new EventLog({ initial: [], muted: [] });
const found = async (node, cid, personaId) => {
  const st = createInitial();
  st.groupId = cid; st.name = cid; st.purpose = 't'; st.persona = personaId;
  return (await createSubmit({ state: st, callSkill: (a, o, x) => node.agent.callSkill(a, o, x) })).result;
};

describe("a persona's new circle follows to its devices", () => {
  let relay; const nodes = [];
  afterAll(async () => { await teardown(...nodes); await relay?.close?.(); });

  it('the phone founds a circle as Werk; the box, which holds Werk, joins it as Werk', async () => {
    relay = await startJourneyRelay();
    const phone = await bootRealAgentNode('phone', { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), deviceLog: log() } });
    nodes.push(phone);
    await connectNodesOverRelay([phone], { relayUrl: relay.url });
    const w = (await phone.agent.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    const W = phone.agent.persona(w);
    expect((await phone.agent.callSkill('household', 'bindCirclePersona', { circleId: Y, personaId: w, relayUrl: relay.url })).ok).toBe(true);
    expect(await found(phone, Y, w)).toBeTruthy();
    await bindCircleAddresses([phone], Y);

    // the box: enrolled with Werk picked, in Y as Werk
    const offer = await phone.agent.callSkill('household', 'buildEnrollOffer', {});
    const storage = memStorage();
    expect((await stashEnrollOffer(storage, offer.uri)).ok).toBe(true);
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() };
    const pre = await bootRealAgentNode('box-pre', { agentOpts: { ...vaults, enrollOfferStorage: storage } });
    const phrase = (await phone.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect((await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'box', personas: [w] })).ok).toBe(true);
    await teardown(pre);
    const box = await bootRealAgentNode('box', { agentOpts: { ...vaults, enrollOfferStorage: storage, deviceLog: log() } });
    nodes.push(box);
    await box.agent.connectPeerTransport({ relayUrl: relay.url, onPeerMessage: (env) => box._routerRef.fn?.(env), awaitRelayReady: true });
    await box.agent.sa.relays.add(relay.url, { identity: box.agent.persona(w).chatId, awaitReady: true });   // Werk's own socket
    const deps = {
      agent: box.agent, callSkill: (a, o, x) => box.agent.callSkill(a, o, x),
      sendPeerMessage: (to, p, o) => box.agent.sendPeerMessage(to, p, o),
      registerCirclePresence: (ids) => bindCircleAddresses([box], ...(ids ?? [])),
    };
    const consumed = await consumeEnrollOffer({ ...deps, storage });
    expect(consumed?.circles?.find((c) => c.circleId === Y)?.ok, JSON.stringify(consumed)).toBe(true);
    // the shells' follow step (web, mobile and the box all hand it in)
    box.agent.circleFollowSync.setConsume((entry) => consumeCircleEntry(deps, entry));
    const landed = [];
    box.agent.circleFollowSync.onLanded((r) => landed.push(r));
    // the phone knows the box as Werk's device in Y (its address on Werk's roster row)
    const boxAddr = box.agent.circleAddressFor(Y);
    expect(await until(async () => {
      const members = (await phone.agent.callSkill('pinboard', 'listGroupMembers', { groupId: Y }))?.members ?? [];
      return members.find((m) => m.webid === W.chatId.pubKey)?.circleAddresses?.includes(boxAddr) || null;
    }, { timeout: 30_000, step: 300 }), "the phone sees the box under Werk").toBeTruthy();

    // NOW: the phone founds Z as Werk
    expect((await phone.agent.callSkill('household', 'bindCirclePersona', { circleId: Z, personaId: w, relayUrl: relay.url })).ok).toBe(true);
    expect(await found(phone, Z, w)).toBeTruthy();
    await bindCircleAddresses([phone], Z);

    const joined = await until(() => (box.agent.circleSelf(Z)?.webid === W.chatId.pubKey ? true : null), { timeout: 45_000, step: 300 });
    expect(joined, `the box follows Z as Werk (landed: ${JSON.stringify(landed)})`).toBe(true);
    expect(box.agent.profileIdOf(Z), "recorded on Werk's profile").toBe(w);
  }, 300_000);
});
