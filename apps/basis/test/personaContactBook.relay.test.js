/**
 * A PERSONA'S CONTACT BOOK REACHES ITS OWN DEVICES — AND ONLY THEM. Anna's phone holds her general self and persona W
 * (with W's circle Y); her box holds only her general self; her laptop holds both. A contact filed under W on the phone
 * reaches the laptop, filed under W there — and never the box: before, the known-peers lane carried every row, a
 * persona's included, to the general persona's devices (one device's contact book linked the selves).
 *
 * Production here: the real factory, the real relay, the enrol with personas and the offer's consume, the create
 * wizard founding Y as W, the real own-devices lane per self (live carry and catch-up).
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

describe("a persona's contact book, per self", () => {
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

  it("a contact filed under W reaches the laptop (filed under W) and never the box", async () => {
    // a contact the phone files under W (W is who they talk to), as the contact flow does
    const webid = 'w:colleague-of-werk';
    expect((await phone.agent.callSkill('pinboard', 'addContact', { webid, displayName: 'Collega', persona: w }))?.ok, 'the phone files the contact under W').not.toBe(false);
    // …and one under the general self, which reaches every general device as before
    const friend = 'w:friend-of-anna';
    expect((await phone.agent.callSkill('pinboard', 'addContact', { webid: friend, displayName: 'Vriendin', persona: 'default' }))?.ok).not.toBe(false);
    // the live carry (the own-devices lane of the self each row is written as), then each device's catch-up, so nothing
    // rests on timing
    for (const n of [box, laptop]) await n.agent.ownStoreSync?.requestFromSiblings?.();

    const onLaptop = await until(async () => (await contactsOf(laptop)).find((c) => c.webid === webid) ?? null, { timeout: 30_000, step: 300 });
    expect(onLaptop, 'the laptop — W\'s device — has W\'s contact').toBeTruthy();
    expect(onLaptop.persona, 'filed under W there').toBe(w);
    const onBox = await until(async () => (await contactsOf(box)).find((c) => c.webid === friend) ?? null, { timeout: 30_000, step: 300 });
    expect(onBox, 'the box has the general contact').toBeTruthy();
    expect(onBox.persona, "filed under the general persona there, as on the phone (never dropped to nothing)").toBe('default');
    await new Promise((r) => setTimeout(r, 3000));
    expect((await contactsOf(box)).some((c) => c.webid === webid), 'the box — the general persona\'s device only — never has W\'s contact').toBe(false);
  }, 120_000);

  it("a general contact RE-FILED under W leaves the box (general only) and is filed under W on the laptop; nothing names W to the box", async () => {
    const friend = 'w:neighbour-of-anna';
    expect((await phone.agent.callSkill('pinboard', 'addContact', { webid: friend, displayName: 'Buur', persona: 'default' }))?.ok).not.toBe(false);
    for (const n of [box, laptop]) await n.agent.ownStoreSync?.requestFromSiblings?.();
    for (const n of [box, laptop]) expect(await until(async () => ((await contactsOf(n)).some((c) => c.webid === friend) ? true : null), { timeout: 30_000, step: 300 }), 'a general contact on every general device first').toBe(true);
    const boxSaw = [];
    const prior = box._routerRef.fn;
    box._routerRef.fn = (env) => { try { boxSaw.push(JSON.stringify(env?.payload ?? {})); } catch { /* observe only */ } return prior?.(env); };
    expect((await phone.agent.callSkill('pinboard', 'setContactPersona', { webid: friend, persona: w }))?.contact?.persona, 'the phone files the friend under W now').toBe(w);
    // the general self's row is deleted (the delete rides the general self's lane) and W's row written (W's lane); then
    // each device's catch-up, so nothing rests on timing
    await new Promise((r) => setTimeout(r, 1000));
    for (const n of [box, laptop]) await n.agent.ownStoreSync?.requestFromSiblings?.();
    const gone = await until(async () => ((await contactsOf(box)).some((c) => c.webid === friend) ? null : true), { timeout: 30_000, step: 300 });
    expect(gone, "the box — the general persona's device only — no longer has the friend as a contact").toBe(true);
    const onLaptop = await until(async () => { const c = (await contactsOf(laptop)).find((x) => x.webid === friend); return c?.persona === w ? c : null; }, { timeout: 30_000, step: 300 });
    expect(onLaptop, 'the laptop holds W: the friend is filed under W there').toBeTruthy();
    const laptopRows = ((await (await laptop.agent.ownStore()).list?.()) ?? []).filter((r) => r?.type === 'contact' && r.webid === friend);
    expect(laptopRows.map((r) => r.id), "one row on the laptop, W's").toEqual([`${w}:${friend}`]);
    box._routerRef.fn = prior;
    expect(boxSaw.some((p) => p.includes(w)), 'nothing the box received names W').toBe(false);
    const boxRows = ((await (await box.agent.ownStore()).list?.()) ?? []).filter((r) => r?.webid === friend);
    expect(boxRows, 'the box holds no row of the friend at all').toEqual([]);
    // …filed BACK under the general self on the phone: a new general row, which reaches the box once more
    expect((await phone.agent.callSkill('pinboard', 'setContactPersona', { webid: friend, persona: 'default' }))?.contact?.persona).toBe('default');
    await box.agent.ownStoreSync?.requestFromSiblings?.();
    const back = await until(async () => ((await contactsOf(box)).some((c) => c.webid === friend) ? true : null), { timeout: 30_000, step: 300 });
    expect(back, 'filed back under the general self, the friend is on the box again').toBe(true);
  }, 120_000);

  it("a W contact's turn reaches the laptop and never the box; a general contact's reaches both", async () => {
    const webid = 'w:colleague-of-werk';
    const friend = 'w:friend-of-anna';
    // both contacts are on the laptop already (the test above), the general one on the box
    await phone.agent.contactTurnFan({ direction: 'in', contactId: webid, fromAddr: webid, text: 'werk bericht', messageId: 'm-w', ts: Date.now() });
    await phone.agent.contactTurnFan({ direction: 'in', contactId: friend, fromAddr: friend, text: 'vriendin bericht', messageId: 'm-f', ts: Date.now() });
    expect(await until(async () => (laptop.landed.some((t) => t.messageId === 'm-w') ? true : null), { timeout: 20_000, step: 200 }), "the laptop landed W's contact's turn").toBe(true);
    expect(await until(async () => (box.landed.some((t) => t.messageId === 'm-f') ? true : null), { timeout: 20_000, step: 200 }), "the box landed the general contact's turn").toBe(true);
    await new Promise((r) => setTimeout(r, 2000));
    expect(box.landed.some((t) => t.messageId === 'm-w'), "the box never lands W's contact's turn").toBe(false);
  }, 60_000);

  it("the receiver binds the turn's self by who sent it: another self's contact, or one not here, is refused", async () => {
    // a turn naming W's contact from the box (a sibling of the GENERAL persona only): another self's — refused
    const h = laptop.agent.contactTurnHandler((wire) => { laptop.landed.push(wire); }, (reason) => laptop.refusedTurns.push(reason));
    // a sibling speaks at its DEVICE address (its delegation key under the self): the box's under the general persona
    const boxAddr = box.agent.persona('default').enrolledDevice?.record?.pubKey;
    const before = laptop.landed.length;
    await h(boxAddr, { subtype: laptop.agent.contactTurnBroadcast, turn: { direction: 'in', contactId: 'w:colleague-of-werk', text: 'vals', messageId: 'm-x', ts: Date.now() } });
    // …and a turn for a W contact this device does not have, from W's own sibling (the phone): refused, never conjured
    const phoneW = phone.agent.persona(w).enrolledDevice?.record?.pubKey;
    await h(phoneW, { subtype: laptop.agent.contactTurnBroadcast, turn: { direction: 'in', contactId: 'w:nobody-here', text: 'niemand', messageId: 'm-y', ts: Date.now() } });
    expect(laptop.landed.length, 'nothing landed').toBe(before);
    expect(laptop.refusedTurns.slice(-2)).toEqual(['another-self', 'no-such-contact']);
    expect((await contactsOf(laptop)).some((c) => c.webid === 'w:nobody-here'), 'no contact conjured').toBe(false);
  });
});
