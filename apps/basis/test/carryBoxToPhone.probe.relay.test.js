/**
 * CAN A CO-MEMBER COUNT MY DEVICES BY MY RECEIPTS?
 *
 * Every full device of a persona presents ONE address in a circle, so a co-member sees one member. But a delivery
 * receipt is sent by the device a message LANDS on, and a member's own devices hand each other the circle's traffic
 * (the sibling carry). If the carried copy also counts as "landed here" and answers with a receipt, a co-member who
 * writes once gets one receipt per device of mine: a count of my devices.
 *
 * Production pieces: the real factory, the real relay, the phone, a box enrolled as its sibling (the enrol offer and its
 * consume), carol joining the circle, carol's own chat emitter, every frame carol's secure agent hands up recorded.
 * Acceptance: for carol's one message, at most ONE delivery receipt reaches carol.
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

describe('receipts do not count my devices', () => {
  let relay; let phone; let box; let carol;
  const toCarol = [];

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
    // record every frame that reaches carol's app
    const route = carol._routerRef.fn;
    carol._routerRef.fn = (env) => { toCarol.push({ from: env?._from ?? env?.from ?? null, subtype: env?.payload?.subtype ?? env?.subtype ?? null, messageId: env?.payload?.messageId ?? null }); return route?.(env); };
  }, 300_000);

  afterAll(async () => { await teardown(phone, box, carol); await relay?.close?.(); });

  it('carol writes once; both my devices hold the line; carol gets at most one receipt', async () => {
    const out = [];
    const peer = carol.agent.peer; const orig = peer.sendTo.bind(peer);
    peer.sendTo = (to, env, o) => { out.push({ to: String(to).slice(0, 10), subtype: env?.subtype ?? env?.type ?? null }); return orig(to, env, o); };
    const emitted = await carol.agent.chatEmit(X, { msgId: 'carol-1', ts: Date.now(), text: 'hallo' });
    const either = await until(async () => (textsIn(phone, X).includes('hallo') || textsIn(box, X).includes('hallo') ? true : null), { timeout: 20_000, step: 200 });
    const viaCarry = await until(async () => (textsIn(phone, X).includes('hallo') ? true : null), { timeout: 25_000, step: 300 });
    let boxSiblings = null; let phoneSiblings = null;
    try { boxSiblings = (await box.agent.siblingDevicesOf?.()) ?? null; } catch (e) { boxSiblings = `err ${e?.message}`; }
    try { phoneSiblings = (await phone.agent.siblingDevicesOf?.()) ?? null; } catch (e) { phoneSiblings = `err ${e?.message}`; }
    const receiptsNow = toCarol.filter((f) => f.subtype === 'delivery-receipt');
    console.info('[L811 probe] landed: phone', textsIn(phone, X).includes('hallo'), 'box', textsIn(box, X).includes('hallo'), 'either', either, 'phone via carry within 25s', viaCarry,
      'box siblings', JSON.stringify(boxSiblings)?.slice(0, 120), 'phone siblings', JSON.stringify(phoneSiblings)?.slice(0, 120),
      'receipts to carol', JSON.stringify(receiptsNow.map((r) => ({ f: String(r.from).slice(0, 8), m: r.messageId }))));
    const held = textsIn(phone, X).includes('hallo') ? true : null;
    if (!held) {
      const roster = (await carol.agent.callSkill('pinboard', 'listGroupMembers', { groupId: X }))?.members ?? [];
      console.info('[L811 probe] emitted', JSON.stringify(emitted)?.slice(0, 200), 'carol holds', JSON.stringify(textsIn(carol, X)), 'carol sent', JSON.stringify(out), 'carol roster', JSON.stringify(roster.map((m) => ({ w: String(m.webid).slice(0, 8), a: String(m.circleAddress).slice(0, 8) }))), 'phone addr', String(phone.agent.circleAddressFor(X)).slice(0, 8), 'box addr', String(box.agent.circleAddressFor(X)).slice(0, 8));
    }
    expect(held, 'the phone holds it').toBe(true);
    expect(await until(async () => (textsIn(box, X).includes('hallo') ? true : null), { timeout: 20_000, step: 200 }), 'the box holds it (the carry or the fan)').toBe(true);
    await new Promise((r) => { setTimeout(r, 4000); });
    const receipts = toCarol.filter((f) => f.subtype === 'delivery-receipt' && (f.messageId === 'carol-1' || f.messageId == null));
    const froms = [...new Set(receipts.map((r) => r.from))];
    expect({ receipts: receipts.length, distinctFrom: froms.length }, `receipts reaching carol: ${JSON.stringify(receipts)}`).toEqual({ receipts: Math.min(receipts.length, 1), distinctFrom: Math.min(froms.length, 1) });
    expect(receipts.length, 'at most one receipt for one message').toBeLessThanOrEqual(1);
  }, 90_000);
});
