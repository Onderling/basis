/**
 * A PERSONA ON TWO DEVICES, ONE OF THEM LOST — over a real relay. Anna's phone (root) founds circle Y as persona W; her
 * laptop and another device are enrolled holding W and rejoin Y as W. The other device is lost; the phone revokes it.
 *
 * The claims (the persona-specific halves of the ceremony): W's person key goes to v2 on the phone; it is CARRIED to the
 * laptop — W's surviving sibling — which adopts it; it is carried to NONE of the lost device's addresses under W; the
 * lost device keeps v1; and Y's roster, where W is a member, folds v2 for W.
 *
 * Production here: the real factory (three devices), the real relay, the enrol with a persona and the offer's consume
 * (rejoining W's circle as W), the create wizard founding Y as W, the production revoke ceremony. The lost device's live
 * record under W is put on the phone's registry through the registry itself (on the pod in production; each device's
 * registry is its own in this harness).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { setDeviceDelegation } from '@onderling/agent-registry';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, bindCircleAddresses, until, teardown, readRoster } from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { stashEnrollOffer, consumeEnrollOffer } from '../src/v2/enrollOffer.js';
import { EventLog } from '../src/eventLog.js';
import { initialState as createInitial, finalSubmit as createSubmit } from '../src/core/wizards/createGroupState.js';
import { PERSON_KEY_CARRY } from '../src/v2/personKeySync.js';

const Y = 'werk-circle';
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; };
const log = () => new EventLog({ initial: [], muted: [] });

describe("a persona's person key at a revoke, with the persona on two devices", () => {
  let relay; let phone; let laptop; let lost; let w; let phrase;

  /** A device of Anna holding persona W: enrolled with the phrase, then the phone's offer consumed (W rejoins Y as W). */
  async function enrolHoldingW(label, offerUri) {
    // the recipe the persona enrol walk proves: the offer stashed, the phrase typed with W picked (the ceremony widens
    // the stash with W's circle), W's own socket, then the boot's consume through the shells' presence seam
    const storage = memStorage();
    expect((await stashEnrollOffer(storage, offerUri)).ok).toBe(true);
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() };
    const pre = await bootRealAgentNode(`${label}-pre`, { agentOpts: { ...vaults, enrollOfferStorage: storage } });
    expect((await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label, personas: ['default', w] })).ok).toBe(true);
    await teardown(pre);
    const node = await bootRealAgentNode(label, { agentOpts: { ...vaults, enrollOfferStorage: storage, deviceLog: log() } });
    await node.agent.connectPeerTransport({ relayUrl: relay.url, onPeerMessage: (env) => node._routerRef.fn?.(env), awaitRelayReady: true });
    await node.agent.sa.relays.add(relay.url, { identity: node.agent.persona(w).chatId, awaitReady: true });
    const consumed = await consumeEnrollOffer({
      agent: node.agent, callSkill: (a, o, x) => node.agent.callSkill(a, o, x),
      sendPeerMessage: (to, p, o) => node.agent.sendPeerMessage(to, p, o), storage,
      registerCirclePresence: (ids) => bindCircleAddresses([node], ...(ids ?? [Y])),
    });
    expect(consumed.circles?.find((c) => c.circleId === Y)?.ok, `${label} rejoined Y: ${JSON.stringify(consumed)}`).toBe(true);
    return node;
  }

  // every refusal any device logs across the whole walk: the enrolment and the hand-over must cause none
  const refusals = [];
  const realWarn = console.warn;
  beforeAll(async () => {
    vi.spyOn(console, 'warn').mockImplementation((...a) => { const m = a.map(String).join(' '); if (/refused a validly-signed envelope/.test(m)) refusals.push(m.slice(0, 200)); realWarn(...a); });
    relay = await startJourneyRelay();
    phone = await bootRealAgentNode('phone', { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), deviceLog: log() } });
    await connectNodesOverRelay([phone], { relayUrl: relay.url });
    phrase = (await phone.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    // the phone founds Y AS persona W
    w = (await phone.agent.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    expect((await phone.agent.callSkill('household', 'bindCirclePersona', { circleId: Y, personaId: w, relayUrl: relay.url })).ok).toBe(true);
    const st = createInitial();
    st.groupId = Y; st.name = 'Werk'; st.purpose = 't'; st.persona = w;
    expect((await createSubmit({ state: st, callSkill: (a, o, x) => phone.agent.callSkill(a, o, x) })).result).toBeTruthy();
    await bindCircleAddresses([phone], Y);
    const offer = await phone.agent.callSkill('household', 'buildEnrollOffer', {});
    laptop = await enrolHoldingW('laptop', offer.uri);
    // a third device gets its own offer, as a person adding one more device does
    const offer2 = await phone.agent.callSkill('household', 'buildEnrollOffer', {});
    lost = await enrolHoldingW('lost', offer2.uri);
    const W = phone.agent.persona(w);
    // the phone's Y roster knows W's addresses on both other devices
    for (const node of [laptop, lost]) {
      const addr = node.agent.persona(w)?.circleAddressFor?.(Y) ?? node.agent.circleAddressFor(Y);
      expect(await until(async () => ((await readRoster(phone, Y)).find((m) => m.webid === W.chatId.pubKey)?.circleAddresses?.includes(addr) ? true : null), { timeout: 30_000, step: 200 }), `the phone knows ${node.label}'s W address in Y`).toBe(true);
    }
    for (const n of [phone, laptop, lost]) await bindCircleAddressKeysFor({ agent: n.agent, circleId: Y });
    // the production person-key lane (the box's and shells' lanes carry it; this harness's router does not)
    for (const node of [phone, laptop, lost]) {
      const pk = node.agent.personKeySync?.handlers ?? {};
      const prior = node._routerRef.fn;
      node._routerRef.fn = (env) => (pk[env?.payload?.subtype] ? pk[env.payload.subtype](env.from, env.payload) : prior?.(env));
    }
    // the lost device's line on the private device map, and its LIVE record under W, on the phone (the pod's job)
    const lostInternal = lost.agent.persona('default').internalDeviceId;
    const lostWire = lost.agent.persona('default').enrolledDevice.deviceId;
    await (await phone.agent.ownStore()).put({ type: 'device-link', id: `device-link:${lostWire}`, wireId: lostWire, internalId: lostInternal }, { by: 'test' });
    const wWire = lost.agent.persona(w).enrolledDevice.deviceId;
    const wRecord = (await lost.agent.deviceRecordsOf(w))?.[wWire];
    expect(wRecord, 'the lost device has its own record under W').toBeTruthy();
    const registry = phone.agent.agentsRegistry();
    const entry = await registry.lookup(w);
    await registry.register({ ...entry, properties: setDeviceDelegation(entry.properties ?? {}, wWire, wRecord) });
  }, 360_000);

  afterAll(async () => { await teardown(phone, laptop, lost); await relay?.close?.(); });

  it("a persona's person address is on the persona's own sockets only — never on the general persona's, nor the reverse", async () => {
    // on every device that enrolled holding W (its first words spoke as W's person key, registered right before)
    for (const node of [laptop, lost]) {
      const Wn = node.agent.persona(w);
      const generalPerson = node.agent.personAddress();
      const wPerson = Wn.personIdentity?.pubKey;
      expect(wPerson, `${node.label} holds W's person key`).toBeTruthy();
      const generalSockets = node.agent.sa.relays.list();
      const wSockets = node.agent.sa.relays.list({ identity: Wn.chatId.pubKey });
      expect(wSockets.length, `${node.label} has W's own socket`).toBeGreaterThan(0);
      for (const s of generalSockets) expect(s.port.addresses, `${node.label}: the general socket holds no W address`).not.toContain(wPerson);
      for (const s of wSockets) expect(s.port.addresses, `${node.label}: W's socket holds no general address`).not.toContain(generalPerson);
      expect(wSockets.some((s) => s.port.addresses.includes(wPerson)), `${node.label}: W's person address is on W's socket`).toBe(true);
    }
  });

  it('W rotates to v2: the laptop adopts it, the lost device is carried nothing and keeps v1, Y folds v2 for W', async () => {
    const W = phone.agent.persona(w);
    const v1 = W.personKey.version;
    const lostWAddrs = new Set([lost.agent.persona(w)?.circleAddressFor?.(Y), lost.agent.persona(w)?.chatId?.pubKey].filter(Boolean));
    const carried = [];
    const peer = phone.agent.sa.peer;
    const orig = peer.sendTo.bind(peer);
    peer.sendTo = (to, env, o) => { if (env?.subtype === PERSON_KEY_CARRY) carried.push(to); return orig(to, env, o); };
    let r;
    try {
      r = await phone.agent.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: lost.agent.persona('default').enrolledDevice.deviceId, circleIds: [] });
    } finally { peer.sendTo = orig; }
    expect(r?.ok, JSON.stringify(r)).toBe(true);
    expect(r.personaKeyVersions?.[w], JSON.stringify(r)).toBe(v1 + 1);
    expect(W.personKey.version).toBe(v1 + 1);

    // the surviving sibling of W adopts it
    const laptopW = laptop.agent.persona(w);
    expect(await until(async () => (laptopW.personKey?.version === v1 + 1 ? true : null), { timeout: 20_000, step: 200 }), `the laptop's W holds ${laptopW.personKey?.version}`).toBe(true);
    expect(laptopW.personIdentity.pubKey).toBe(W.personIdentity.pubKey);
    // the carry reached none of the lost device's W addresses, and it keeps v1
    expect(carried.filter((to) => lostWAddrs.has(to)), 'nothing carried to the lost device').toEqual([]);
    expect(lost.agent.persona(w).personKey.version).toBe(v1);
    // Y — W's circle — folds the new version for W
    expect(await until(async () => ((await readRoster(phone, Y)).find((m) => m.webid === W.chatId.pubKey)?.personKey?.version === v1 + 1 ? true : null), { timeout: 20_000, step: 200 }), 'Y folded W\'s v2').toBe(true);
    // and nothing was refused but the LOST device: its old W person key (v1, no longer one of ours live) and its retired
    // W address in Y are refused; every other envelope — the later device's first words included — went through
    const lostKeys = [lost.agent.persona(w).personIdentity.pubKey, lost.agent.persona(w).circleAddressFor?.(Y) ?? lost.agent.circleAddressFor(Y)].map((k) => k.slice(0, 12));
    expect(refusals.filter((m) => !lostKeys.some((k) => m.includes(`the key ${k}`))), "nothing refused but the lost device's keys").toEqual([]);
  }, 120_000);
});
