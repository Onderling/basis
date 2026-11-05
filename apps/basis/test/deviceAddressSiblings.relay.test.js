/**
 * MY OWN DEVICES REACH EACH OTHER AT THEIR DEVICE ADDRESS — never through a circle. Each device of a person has a device
 * address per self (its delegation key, root-signed in the registry's device map); the person's own lanes (the own
 * store, the grants lane, the sibling carry) travel device address to device address, and a device address appears on
 * no roster. This is what lets a circle later show one address per persona: siblings no longer find each other by
 * their distinct circle addresses on their own roster row.
 *
 * Over a real relay, asserted on what the relay forwarded: the phone writes its own scope; the box receives it, and the
 * relay forwarded it from the phone's device address to the box's — not between circle addresses.
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

describe('my own devices reach each other at their device address', () => {
  let relay; const nodes = []; const relayLines = [];
  afterAll(async () => { vi.restoreAllMocks(); await teardown(...nodes); await relay?.close?.(); });

  it('the own scope travels device address to device address, and no roster row holds a device address', async () => {
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
    const st = createInitial();
    st.groupId = Y; st.name = 'Thuis'; st.purpose = 't';
    expect((await createSubmit({ state: st, callSkill: (a, o, x) => phone.agent.callSkill(a, o, x) })).result).toBeTruthy();
    await bindCircleAddresses([phone], Y);

    const offer = await phone.agent.callSkill('household', 'buildEnrollOffer', {});
    const storage = memStorage();
    expect((await stashEnrollOffer(storage, offer.uri)).ok).toBe(true);
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() };
    const pre = await bootRealAgentNode('box-pre', { agentOpts: { ...vaults, enrollOfferStorage: storage } });
    const phrase = (await phone.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect((await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'box' })).ok).toBe(true);
    await teardown(pre);
    const box = await bootRealAgentNode('box', { itemsLane: true, agentOpts: { ...vaults, enrollOfferStorage: storage } });
    nodes.push(box);
    await box.agent.connectPeerTransport({ relayUrl: relay.url, onPeerMessage: (env) => box._routerRef.fn?.(env), awaitRelayReady: true });
    const consumed = await consumeEnrollOffer({
      agent: box.agent, callSkill: (a, o, x) => box.agent.callSkill(a, o, x),
      sendPeerMessage: (to, p, o) => box.agent.sendPeerMessage(to, p, o), storage,
      registerCirclePresence: (ids) => bindCircleAddresses([box], ...(ids ?? [Y])),
    });
    expect(consumed?.circles?.find((c) => c.circleId === Y)?.ok, JSON.stringify(consumed)).toBe(true);

    // each device's device address: its delegation key under the default
    const phoneDevice = phone.agent.persona('default').enrolledDevice?.record?.pubKey;
    const boxDevice = box.agent.persona('default').enrolledDevice?.record?.pubKey;
    expect(phoneDevice && boxDevice && phoneDevice !== boxDevice, 'two device addresses').toBe(true);

    // the phone writes its own scope; it reaches the box
    const before = relayLines.length;
    const own = await phone.agent.ownStore();
    await own.put({ type: 'note', id: 'note:device-address', body: 'van de telefoon' }, { by: 'test' });
    await box.agent.ownStoreSync?.requestFromSiblings?.();
    const landed = await until(async () => {
      const rows = (await (await box.agent.ownStore()).list?.()) ?? [];
      return rows.find((r) => r?.id === 'note:device-address') ?? null;
    }, { timeout: 30_000, step: 300 });
    expect(landed, 'the own scope reached the box').toBeTruthy();
    // THE POINT: the existing device claimed it when the box arrived — the box learns the claim, and it names the phone
    const phoneId = phone.agent.persona('default').enrolledDevice?.deviceId;
    expect(await until(() => (phone.agent.spinePointClaim()?.deviceId === phoneId ? true : null), { timeout: 15_000, step: 200 }),
      'the existing device did not claim the point when the box arrived').toBe(true);
    await box.agent.spinePoint?.requestFromSiblings?.();
    expect(await until(() => (box.agent.spinePointClaim()?.deviceId === phoneId ? true : null), { timeout: 15_000, step: 200 }),
      'the box does not know the phone is the point').toBe(true);
    // …and the POINT alone: where direct messages land is still nobody's choice (the box keeps taking them as before)
    expect(phone.agent.primaryDevice?.current?.() ?? null, 'the enrol made the phone the DM primary too').toBeNull();

    // …delivered AT THE BOX'S DEVICE ADDRESS, as the relay saw it (the relay names the socket's own identity as the
    // sender, not the address a frame speaks as, so the destination is what it can witness)
    const forwards = relayLines.slice(before).map((l) => /^\[relay\] (\S+) → (\S+)/.exec(l)).filter(Boolean).map((m) => ({ from: m[1], to: m[2] }));
    expect(forwards.some((f) => f.to === short(boxDevice)), `a forward to the box's device address: ${JSON.stringify([...new Set(forwards.map((f) => f.to))])}`).toBe(true);

    // a device address is on no roster row
    for (const node of [phone, box]) {
      const roster = JSON.stringify((await node.agent.callSkill('pinboard', 'listGroupMembers', { groupId: Y }))?.members ?? []);
      expect(roster.includes(phoneDevice) || roster.includes(boxDevice), 'a device address on a roster row').toBe(false);
    }

    // TWO SELVES ON ONE DEVICE: disjoint device addresses, and the general persona's bindings never carry the persona's
    const w = (await phone.agent.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    const phoneWerkDevice = phone.agent.persona(w).enrolledDevice?.record?.pubKey;
    expect(phoneWerkDevice && phoneWerkDevice !== phoneDevice, 'Werk has its own device address on the phone').toBe(true);
    expect(phone.agent.ownAddressBindings().map((b) => b.address), "the general persona's relay bindings").not.toContain(phoneWerkDevice);
    // …and no relay line ever named a device id (a device address is a key, never the id behind it)
    const wireIds = [phone, box].flatMap((n) => [n.agent.persona('default').enrolledDevice?.deviceId]).filter(Boolean);
    expect(relayLines.filter((l) => wireIds.some((id) => l.includes(id))), 'a device id on the wire').toEqual([]);

    // AFTER A REVOKE, the revoked device is no sibling: an own write does not travel to its device address
    const boxWire = box.agent.persona('default').enrolledDevice?.deviceId;
    const revoked = await phone.agent.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: boxWire });
    expect(revoked?.ok, JSON.stringify(revoked)).toBe(true);
    const afterRevoke = relayLines.length;
    await own.put({ type: 'note', id: 'note:after-revoke', body: 'na het intrekken' }, { by: 'test' });
    await new Promise((r) => setTimeout(r, 2500));
    const later = relayLines.slice(afterRevoke).map((l) => /^\[relay\] (\S+) → (\S+)/.exec(l)).filter(Boolean).map((m) => m[2]);
    expect(later.filter((to) => to === short(boxDevice)), 'nothing more to the revoked device').toEqual([]);
  }, 300_000);
});
