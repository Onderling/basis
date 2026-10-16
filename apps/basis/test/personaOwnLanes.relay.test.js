/**
 * THE OWN LANE IS PER SELF. The person's own scope (their device map, their own appointments, the planned book) rode
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
import { initialState as createInitial, finalSubmit as createSubmit } from '../src/core/wizards/createGroupState.js';

const Y = 'werk-circle';
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; };
const short = (a) => (a ? `${String(a).slice(0, 12)}…` : null);

describe('the own lane is per self', () => {
  let relay; const nodes = []; const relayLines = [];
  afterAll(async () => { vi.restoreAllMocks(); await teardown(...nodes); await relay?.close?.(); });

  it('Werk\'s own scope reaches the box over Werk\'s addresses only, and the box revokes the lost phone through it', async () => {
    const origLog = console.log;
    vi.spyOn(console, 'log').mockImplementation((...a) => {
      const line = String(a[0] ?? '');
      if (line.startsWith('[relay] ')) { relayLines.push(line); return; }
      origLog(...a);
    });
    relay = await startJourneyRelay({ log: true });
    const phone = await bootRealAgentNode('phone', { taskLane: true, agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() } });
    nodes.push(phone);
    await connectNodesOverRelay([phone], { relayUrl: relay.url });
    // every circle of this person is under Werk
    const w = (await phone.agent.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    const W = phone.agent.persona(w);
    expect((await phone.agent.callSkill('household', 'bindCirclePersona', { circleId: Y, personaId: w, relayUrl: relay.url })).ok).toBe(true);
    const st = createInitial();
    st.groupId = Y; st.name = 'Werk'; st.purpose = 't'; st.persona = w;
    expect((await createSubmit({ state: st, callSkill: (a, o, x) => phone.agent.callSkill(a, o, x) })).result).toBeTruthy();
    await bindCircleAddresses([phone], Y);

    // the box enrols as a device of the default AND of Werk
    const offer = await phone.agent.callSkill('household', 'buildEnrollOffer', {});
    expect(offer?.ok, JSON.stringify(offer)).toBe(true);
    const storage = memStorage();
    expect((await stashEnrollOffer(storage, offer.uri)).ok).toBe(true);
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() };
    const pre = await bootRealAgentNode('box-pre', { agentOpts: { ...vaults, enrollOfferStorage: storage } });
    const phrase = (await phone.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect((await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'box', personas: [w] })).ok).toBe(true);
    await teardown(pre);
    const box = await bootRealAgentNode('box', { taskLane: true, agentOpts: { ...vaults, enrollOfferStorage: storage } });
    nodes.push(box);
    await box.agent.connectPeerTransport({ relayUrl: relay.url, onPeerMessage: (env) => box._routerRef.fn?.(env), awaitRelayReady: true });
    await box.agent.sa.relays.add(relay.url, { identity: box.agent.persona(w).chatId, awaitReady: true });
    const consumed = await consumeEnrollOffer({
      agent: box.agent, callSkill: (a, o, x) => box.agent.callSkill(a, o, x),
      sendPeerMessage: (to, p, o) => box.agent.sendPeerMessage(to, p, o), storage,
      registerCirclePresence: (ids) => bindCircleAddresses([box], ...(ids ?? [Y])),
    });
    expect(consumed?.circles?.find((c) => c.circleId === Y)?.ok, JSON.stringify(consumed)).toBe(true);

    // WERK'S OWN SCOPE REACHES THE BOX: the phone's device-link row under Werk (its Werk wire id) — the default shares
    // no circle with the box, so this could only have come over Werk's lane
    const phoneWerkWire = W.enrolledDevice?.deviceId;
    expect(phoneWerkWire, 'the phone has a wire id under Werk').toBeTruthy();
    await box.agent.ownStoreSync?.requestFromSiblings?.();
    await phone.agent.ownStoreSync?.requestFromSiblings?.();
    const link = await until(async () => {
      const rows = (await (await box.agent.ownStore()).list?.()) ?? [];
      return rows.find((r) => r?.type === 'device-link' && r.wireId === phoneWerkWire) ?? null;
    }, { timeout: 30_000, step: 300 });
    expect(link, 'the phone\'s device-link under Werk reached the box').toBeTruthy();

    // NEVER CROSSING, as the relay saw it: nothing from the phone's default to the box's Werk addresses, and nothing
    // from the phone's Werk addresses to the box's default addresses
    const phoneDefault = new Set([phone.pubKey, phone.agent.personAddress?.()].filter(Boolean).map(short));
    const phoneWerk = new Set([W.chatId.pubKey, W.personIdentity?.pubKey, phone.agent.circleAddressFor(Y)].filter(Boolean).map(short));
    const BW = box.agent.persona(w);
    const boxDefault = new Set([box.pubKey, box.agent.personAddress?.()].filter(Boolean).map(short));
    const boxWerk = new Set([BW.chatId.pubKey, BW.personIdentity?.pubKey, box.agent.circleAddressFor(Y)].filter(Boolean).map(short));
    const forwards = relayLines.map((l) => /^\[relay\] (\S+) → (\S+)/.exec(l)).filter(Boolean).map((m) => ({ from: m[1], to: m[2] }));
    expect(forwards.length, 'the relay forwarded something').toBeGreaterThan(0);
    expect(forwards.filter((f) => phoneDefault.has(f.from) && boxWerk.has(f.to)), 'default → Werk').toEqual([]);
    expect(forwards.filter((f) => phoneWerk.has(f.from) && boxDefault.has(f.to)), 'Werk → default').toEqual([]);

    // THE PHONE IS LOST: the box revokes it by the id it knows it by (its Werk wire id) — every self of it goes
    const r = await box.agent.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: phoneWerkWire });
    expect(r?.ok, JSON.stringify(r)).toBe(true);
    expect(r.revokedUnder?.[w], 'revoked under Werk, by its Werk wire id').toBe(phoneWerkWire);
    expect(r.revokedUnder?.default, 'and under the default, by its OWN wire id there (derived from the device map)').toBe(phone.agent.persona('default')?.enrolledDevice?.deviceId);
    expect(r.revokedUnder.default, 'a real wire id').toMatch(/^d-[0-9a-f]+$/);
    expect(r.revokedUnder.default).not.toBe(phoneWerkWire);
  }, 400_000);
});
