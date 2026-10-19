/**
 * A PROFILE'S FACTS FOLLOW TO THE PERSON'S OWN DEVICES — WITHOUT A POD. Anna's phone holds her general self and persona
 * W; her box holds only the general self; her laptop holds both. No pod anywhere: the registry lives on each device.
 * A property set on the phone reaches the other devices that hold that self (the general self's: box and laptop; W's:
 * the laptop only, and nothing of W reaches the box), and the newer edit wins wherever it was made. Before, an edit
 * reached the circles but not the person's other devices, and the next edit there re-released the old values.
 *
 * Production here: the real factory, the real relay, the enrol with personas and the offer's consume, the real
 * registry and the own-devices lane (live carry and catch-up).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, createCircle, bindCircleAddresses, until, teardown, readRoster } from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { stashEnrollOffer, consumeEnrollOffer } from '../src/v2/enrollOffer.js';
import { EventLog } from '../src/eventLog.js';
import { initialState as createInitial, finalSubmit as createSubmit } from '../src/core/wizards/createGroupState.js';

const X = 'thuis-circle';
const Y = 'werk-circle';
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; };
const log = () => new EventLog({ initial: [], muted: [] });
const contactsOf = async (node) => (await node.agent.callSkill('pinboard', 'listContacts', {}))?.contacts ?? [];

describe("a profile's facts follow to the devices holding that self — without a pod", () => {
  let relay; let phone; let box; let laptop; let w; let phrase;

  async function enrol(label, offerUri, personas) {
    const storage = memStorage();
    expect((await stashEnrollOffer(storage, offerUri)).ok).toBe(true);
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() };
    const pre = await bootRealAgentNode(`${label}-pre`, { agentOpts: { ...vaults, enrollOfferStorage: storage } });
    expect((await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label, personas })).ok).toBe(true);
    await teardown(pre);
    const node = await bootRealAgentNode(label, { agentOpts: { ...vaults, enrollOfferStorage: storage, deviceLog: log() } });
    await node.agent.connectPeerTransport({ relayUrl: relay.url, onPeerMessage: (env) => node._routerRef.fn?.(env), awaitRelayReady: true });
    if (personas.includes(w)) await node.agent.sa.relays.add(relay.url, { identity: node.agent.persona(w).chatId, awaitReady: true });
    const consumed = await consumeEnrollOffer({
      agent: node.agent, callSkill: (a, o, x) => node.agent.callSkill(a, o, x),
      sendPeerMessage: (to, p, o) => node.agent.sendPeerMessage(to, p, o), storage,
      registerCirclePresence: (ids) => bindCircleAddresses([node], ...(ids ?? [X, Y])),
    });
    for (const c of personas.includes(w) ? [X, Y] : [X]) expect(consumed.circles?.find((r) => r.circleId === c)?.ok, `${label} rejoined ${c}: ${JSON.stringify(consumed)}`).toBe(true);
    return node;
  }

  beforeAll(async () => {
    relay = await startJourneyRelay();
    phone = await bootRealAgentNode('phone', { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), deviceLog: log() } });
    await connectNodesOverRelay([phone], { relayUrl: relay.url });
    phrase = (await phone.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    await createCircle(phone, { groupId: X, name: 'Thuis' });
    await bindCircleAddresses([phone], X);
    w = (await phone.agent.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    expect((await phone.agent.callSkill('household', 'bindCirclePersona', { circleId: Y, personaId: w, relayUrl: relay.url })).ok).toBe(true);
    const st = createInitial();
    st.groupId = Y; st.name = 'Werk'; st.purpose = 't'; st.persona = w;
    expect((await createSubmit({ state: st, callSkill: (a, o, x) => phone.agent.callSkill(a, o, x) })).result).toBeTruthy();
    await bindCircleAddresses([phone], X, Y);
    box = await enrol('box', (await phone.agent.callSkill('household', 'buildEnrollOffer', {})).uri, ['default']);
    laptop = await enrol('laptop', (await phone.agent.callSkill('household', 'buildEnrollOffer', {})).uri, ['default', w]);
    // the phone knows both devices: box and laptop in X (general), the laptop also in Y (as W)
    const W = phone.agent.persona(w);
    expect(await until(async () => ((await readRoster(phone, Y)).find((m) => m.webid === W.chatId.pubKey)?.circleAddresses?.includes(laptop.agent.persona(w).circleAddressFor(Y)) ? true : null), { timeout: 30_000, step: 200 }), 'the phone knows the laptop under W').toBe(true);
    for (const n of [phone, box, laptop]) for (const c of [X, Y]) await bindCircleAddressKeysFor({ agent: n.agent, circleId: c }).catch(() => {});
    // the production own-device turn lane on box and laptop (the shells' lanes carry it; this harness's router does not):
    // the agent's real handler, landing into a record of what it applied and what it refused
    for (const node of [box, laptop]) {
      node.landed = []; node.refusedTurns = [];
      const h = node.agent.contactTurnHandler((wire) => { node.landed.push(wire); }, (reason) => node.refusedTurns.push(reason));
      const prior = node._routerRef.fn;
      node._routerRef.fn = (env) => (env?.payload?.subtype === node.agent.contactTurnBroadcast ? h(env.from, env.payload) : prior?.(env));
    }
  }, 420_000);

  afterAll(async () => { await teardown(phone, box, laptop); await relay?.close?.(); });

  const propsOf = async (node, id) => (await node.agent.callSkill('agents', 'getProfileProperties', { id }))?.properties ?? {};
  const catchUp = async () => { for (const n of [box, laptop]) await n.agent.profileFactsSync?.requestFromSiblings?.(); };

  it("a general property set on the phone reaches the box and the laptop", async () => {
    expect((await phone.agent.callSkill('agents', 'setProfileProperty', { id: 'default', key: 'location', value: 'Utrecht' }))?.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 800)); await catchUp();
    for (const n of [box, laptop]) {
      expect(await until(async () => ((await propsOf(n, 'default')).location?.value === 'Utrecht' ? true : null), { timeout: 30_000, step: 300 }), `${n.label ?? 'a device'} has the new place`).toBe(true);
    }
  }, 120_000);

  it("W's property reaches the laptop (which holds W) and nothing of W reaches the box", async () => {
    const boxSaw = [];
    const prior = box._routerRef.fn;
    box._routerRef.fn = (env) => { try { boxSaw.push(JSON.stringify(env?.payload ?? {})); } catch { /* observe only */ } return prior?.(env); };
    expect((await phone.agent.callSkill('agents', 'setProfileProperty', { id: w, key: 'realName', value: 'Anna de Werker' }))?.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 800)); await catchUp();
    expect(await until(async () => ((await propsOf(laptop, w)).realName?.value === 'Anna de Werker' ? true : null), { timeout: 30_000, step: 300 }), 'the laptop has W\'s new name').toBe(true);
    box._routerRef.fn = prior;
    expect(boxSaw.some((p) => p.includes('Anna de Werker')), 'nothing of W reaches the box').toBe(false);
  }, 120_000);

  it("the newer edit wins wherever it was made: changed on the laptop, the phone follows", async () => {
    await new Promise((r) => setTimeout(r, 20));
    expect((await laptop.agent.callSkill('agents', 'setProfileProperty', { id: 'default', key: 'location', value: 'Amersfoort' }))?.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 800)); await phone.agent.profileFactsSync?.requestFromSiblings?.();
    expect(await until(async () => ((await propsOf(phone, 'default')).location?.value === 'Amersfoort' ? true : null), { timeout: 30_000, step: 300 }), 'the phone took the laptop\'s newer place').toBe(true);
  }, 120_000);
});
