/**
 * A REVOKED DEVICE HELD TWO PERSONAS: BOTH RE-KEY, EACH ROOT ONLY TO ITS OWN DEVICES. Anna's phone (root) founds circle X
 * as persona P and circle Y as persona Q. Her laptop holds P only; a third device holds P and Q and is lost. The phone
 * revokes it: P and Q each move to their next circle root, the laptop takes P's — and is handed nothing of Q's, which it
 * does not hold. A persona's next root never crosses to a device of another persona.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { setDeviceDelegation } from '@onderling/agent-registry';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, bindCircleAddresses, until, teardown, readRoster } from './support/pairRealAgents.js';
import { stashEnrollOffer, consumeEnrollOffer } from '../src/v2/enrollOffer.js';
import { EventLog } from '../src/eventLog.js';
import { initialState as createInitial, finalSubmit as createSubmit } from '../src/core/wizards/createGroupState.js';

const X = 'twee-p-circle';
const Y = 'twee-q-circle';
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; };
const log = () => new EventLog({ initial: [], muted: [] });

describe('a revoked device held two personas', () => {
  let relay; let phone; let laptop; let lost; let p; let q; let phrase;

  /** A device of Anna holding the given personas, joined to their circles through the phone's offer. */
  async function enrolHolding(label, personaIds, circles) {
    const offer = await phone.agent.callSkill('household', 'buildEnrollOffer', {});
    const storage = memStorage();
    expect((await stashEnrollOffer(storage, offer.uri)).ok).toBe(true);
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() };
    const pre = await bootRealAgentNode(`${label}-pre`, { agentOpts: { ...vaults, enrollOfferStorage: storage } });
    expect((await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label, personas: ['default', ...personaIds] })).ok).toBe(true);
    await teardown(pre);
    const node = await bootRealAgentNode(label, { agentOpts: { ...vaults, enrollOfferStorage: storage, deviceLog: log() } });
    await node.agent.connectPeerTransport({ relayUrl: relay.url, onPeerMessage: (env) => node._routerRef.fn?.(env), awaitRelayReady: true });
    for (const pid of personaIds) await node.agent.sa.relays.add(relay.url, { identity: node.agent.persona(pid).chatId, awaitReady: true });
    const consumed = await consumeEnrollOffer({
      agent: node.agent, callSkill: (a, o, x) => node.agent.callSkill(a, o, x),
      sendPeerMessage: (to, pl, o) => node.agent.sendPeerMessage(to, pl, o), storage,
      registerCirclePresence: (ids) => bindCircleAddresses([node], ...(ids ?? circles)),
    });
    for (const c of circles) expect(consumed.circles?.find((x) => x.circleId === c)?.ok, `${label} rejoined ${c}: ${JSON.stringify(consumed)}`).toBe(true);
    return node;
  }
  async function found(circleId, pid, name) {
    expect((await phone.agent.callSkill('household', 'bindCirclePersona', { circleId, personaId: pid, relayUrl: relay.url })).ok).toBe(true);
    const st = createInitial();
    st.groupId = circleId; st.name = name; st.purpose = 't'; st.persona = pid;
    expect((await createSubmit({ state: st, callSkill: (a, o, x) => phone.agent.callSkill(a, o, x) })).result).toBeTruthy();
    await bindCircleAddresses([phone], circleId);
  }

  beforeAll(async () => {
    relay = await startJourneyRelay();
    phone = await bootRealAgentNode('phone', { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), deviceLog: log() } });
    await connectNodesOverRelay([phone], { relayUrl: relay.url });
    phrase = (await phone.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    p = (await phone.agent.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    q = (await phone.agent.callSkill('agents', 'createProfile', { name: 'Club' })).id;
    await found(X, p, 'Werk');
    await found(Y, q, 'Club');
    laptop = await enrolHolding('laptop', [p], [X]);
    lost = await enrolHolding('lost', [p, q], [X, Y]);
    // the phone's rosters know the lost device's addresses under P and Q
    for (const [pid, c] of [[p, X], [q, Y]]) {
      const self = phone.agent.persona(pid).chatId.pubKey;
      const addr = lost.agent.persona(pid).circleAddressFor(c);
      expect(await until(async () => ((await readRoster(phone, c)).find((m) => m.webid === self)?.circleAddresses?.includes(addr) ? true : null), { timeout: 30_000, step: 200 }), `the phone knows the lost device's ${c} address`).toBe(true);
    }
    // the lost device's LIVE records under P and Q, on the phone's registry (the pod's job in production)
    const lostInternal = lost.agent.persona('default').internalDeviceId;
    const lostWire = lost.agent.persona('default').enrolledDevice.deviceId;
    await (await phone.agent.ownStore()).put({ type: 'device-link', id: `device-link:${lostWire}`, wireId: lostWire, internalId: lostInternal }, { by: 'test' });
    const registry = phone.agent.agentsRegistry();
    for (const pid of [p, q]) {
      const wire = lost.agent.persona(pid).enrolledDevice.deviceId;
      const rec = (await lost.agent.deviceRecordsOf(pid))?.[wire];
      expect(rec, `the lost device has its own record under ${pid}`).toBeTruthy();
      const entry = await registry.lookup(pid);
      await registry.register({ ...entry, properties: setDeviceDelegation(entry.properties ?? {}, wire, rec) });
    }
  }, 420_000);

  afterAll(async () => { await teardown(phone, laptop, lost); await relay?.close?.(); });

  it('P and Q both re-key; the laptop (P only) takes P\'s next root and nothing of Q; the lost device takes neither', async () => {
    const before = { x: phone.agent.persona(p).circleAddressFor(X), y: phone.agent.persona(q).circleAddressFor(Y) };
    const laptopHeldQ = !!laptop.agent.persona(q);
    expect(laptopHeldQ, 'the laptop holds Q — the case proves nothing').toBe(false);
    const r = await phone.agent.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: lost.agent.persona('default').enrolledDevice.deviceId, circleIds: [] });
    expect(r?.ok, JSON.stringify(r)).toBe(true);
    expect(r.personaRekeys?.[p]?.ok, `P did not re-key: ${JSON.stringify(r.personaRekeys)}`).toBe(true);
    expect(r.personaRekeys?.[q]?.ok, `Q did not re-key: ${JSON.stringify(r.personaRekeys)}`).toBe(true);
    const next = { x: phone.agent.persona(p).circleAddressFor(X), y: phone.agent.persona(q).circleAddressFor(Y) };
    expect(next.x).not.toBe(before.x);
    expect(next.y).not.toBe(before.y);
    // P's next root reached P's other live device; Q's went to no device of P's
    expect(await until(() => (laptop.agent.persona(p).circleAddressFor(X) === next.x ? true : null), { timeout: 20000, step: 200 }), 'the laptop did not take P\'s next root').toBe(true);
    expect(r.personaRekeys[q].handOver?.handed ?? 0, 'Q\'s next root was handed to a device that does not hold Q').toBe(0);
    // the lost device took neither
    expect(lost.agent.persona(p).circleAddressFor(X)).toBe(before.x);
    expect(lost.agent.persona(q).circleAddressFor(Y)).toBe(before.y);
  }, 240_000);
});
