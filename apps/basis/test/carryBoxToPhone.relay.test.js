/**
 * A CO-MEMBER'S CIRCLE MESSAGE REACHES BOTH MY DEVICES.
 *
 * My phone and my box present ONE address in the circle, and the relay hands that address to one socket, so a
 * co-member's message lands on ONE of them; the sibling carry hands it to the other. Production pieces: the real
 * factory, the real relay, the phone, a box enrolled as its sibling (the enrol offer and its consume), carol joining,
 * carol's own chat emitter. The harness routes a landed statement through the same `carryLandedStatement` every shell
 * composes (`circleLanes.js`); before it did, the box held the line and the phone never did.
 * (Receipts are not measured here: the harness composes no delivery receipt.)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle, bindCircleAddresses, until, teardown } from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { primeCircleSecurity } from '../src/v2/circleSecurityPriming.js';
import { stashEnrollOffer, consumeEnrollOffer } from '../src/v2/enrollOffer.js';
import { EventLog } from '../src/eventLog.js';

const X = 'receipts-circle';
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; };
const textsIn = (node, cid) => node.chatRail.storedStatements(cid).map((s) => s?.body?.payload?.text).filter(Boolean);

describe('a circle message reaches both my devices', () => {
  let relay; let phone; let box; let carol;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    phone = await bootRealAgentNode('phone', { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), deviceLog: new EventLog({ initial: [], muted: [] }) } });
    carol = await bootRealAgentNode('carol', { agentOpts: { deviceLog: new EventLog({ initial: [], muted: [] }) } });
    await connectNodesOverRelay([phone, carol], { relayUrl: relay.url });
    await createCircle(phone, { groupId: X, name: 'R' });
    await bindCircleAddresses([phone], X);
    // the box enrols as the phone's sibling
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
    // carol joins after the box is the phone's sibling
    expect((await joinExistingCircle(phone, carol, { groupId: X, handle: 'carol' })).joined.ok).toBe(true);
    await bindCircleAddresses([carol], X);
    for (const n of [phone, box, carol]) await bindCircleAddressKeysFor({ agent: n.agent, circleId: X });
    // as every multi-member walk does after a join: each device primes its circle security, then the bindings again
    await Promise.all([phone, box, carol].map((n) => primeCircleSecurity({ agent: n.agent, onWarn: () => {} })));
    await new Promise((r) => { setTimeout(r, 1500); });
    for (const n of [phone, box, carol]) await bindCircleAddressKeysFor({ agent: n.agent, circleId: X });
  }, 300_000);

  afterAll(async () => { await teardown(phone, box, carol); await relay?.close?.(); });

  it('carol writes once; both my devices hold the line', async () => {
    await carol.agent.chatEmit(X, { msgId: 'carol-1', ts: Date.now(), text: 'hallo' });
    const landed = await until(async () => (textsIn(phone, X).includes('hallo') || textsIn(box, X).includes('hallo') ? true : null), { timeout: 20_000, step: 200 });
    expect(landed, 'it landed on one of my devices').toBe(true);
    expect(await until(async () => (textsIn(phone, X).includes('hallo') ? true : null), { timeout: 25_000, step: 300 }), 'the phone holds it').toBe(true);
    expect(await until(async () => (textsIn(box, X).includes('hallo') ? true : null), { timeout: 20_000, step: 200 }), 'the box holds it').toBe(true);
  }, 90_000);
});
