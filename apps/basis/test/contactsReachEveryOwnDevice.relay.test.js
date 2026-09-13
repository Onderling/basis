/**
 * THE HI IS BETWEEN PERSONS, NOT DEVICES — a contact who greeted your phone is known to your box.
 *
 * On a relay an address IS its public key, and a device accepts a message only from a key it has bound
 * to that address — bound by the greeting (the HI) that arrived at THAT device. So a contact who greeted
 * your phone is bound on the phone and on nothing else. Enrol a second device from the same phrase and
 * it registers the same profile address; the relay maps one address to one socket, last registration
 * wins, and the contact's next message lands on the new device — which refuses it, `UNKNOWN_SENDER`,
 * silently: the relay transport sits outside the core agent's transport map, so its `security-error`
 * reaches no listener at all.
 *
 * Frits, 2026-09-13: *"the Hi should be between persons, not between devices."* On the wire a socket
 * greets a socket; that cannot change. But the RESULT of a greeting — "this key is Bea" — is a fact
 * about the person, and it is held on every device of theirs. That is what this walk asserts, over a
 * real relay, with the enrolment path the app uses: the offer, the phrase, the enrolled boot, the
 * consume that seeds the roster and announces the new device to its sibling.
 *
 * What is production here: the ceremony and the enrolled boot (the real factory, twice), the relay
 * transport, the enrol offer and its consume, the roster seed, the announce and its landing, the
 * contact book, the own-devices sync and its receive side, the security layer's establish-never-replace
 * rule on landing. The one hand-off: Bea's card is "scanned" by calling `addContact` directly — the
 * scan is a camera, the add is what it does.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { startJourneyRelay } from './support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, createCircle, bindCircleAddresses, until, teardown,
} from './support/pairRealAgents.js';
import { stashEnrollOffer, consumeEnrollOffer } from '../src/v2/enrollOffer.js';

const CIRCLE = 'thuis-circle';
const SEND = { hold: true, firstSendTimeoutMs: 4000, retryDelays: [] };
const textsAt = (node) => node.received.map((m) => m?.payload?.text).filter(Boolean);
const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } };
};

describe('a contact who greeted the phone is known to the enrolled box', () => {
  let relay; let relayUrl; let phone; let bea; let box;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    relayUrl = relay.url;
    [phone, bea] = await Promise.all([
      bootRealAgentNode('phone', { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() } }),
      bootRealAgentNode('bea'),
    ]);
    await connectNodesOverRelay([phone, bea], { relayUrl });
    // Own devices find each other through the circles they share (a sibling is reached at its proven
    // per-circle address, like any member) — so the person has a circle, as every person does.
    await createCircle(phone, { groupId: CIRCLE, name: 'Thuis' });
    await bindCircleAddresses([phone], CIRCLE);
  }, 120_000);

  afterAll(async () => {
    await teardown(phone, bea, box);
    try { await relay?.close?.(); } catch { /* */ }
  });

  it('Bea greets the phone; the box enrols and takes the address; Bea\'s next message lands on the box and is ACCEPTED', async () => {
    // ── 1. Bea reaches the phone. First contact: the greeting binds her key on THE PHONE. ─────────
    await bea.agent.sendPeerMessage(phone.pubKey, { type: 'p2p-chat', msgId: 'bea-1', ts: Date.now(), text: 'hoi, hier Bea' }, SEND);
    expect(await until(async () => (textsAt(phone).includes('hoi, hier Bea') ? true : null), { timeout: 15_000 }),
      'the phone must receive Bea directly — the baseline the box must not break').toBe(true);
    // …and the person keeps her: the card scan, minus the camera.
    await phone.agent.callSkill('stoop', 'addContact', { webid: bea.pubKey, pubKey: bea.pubKey, displayName: 'Bea' });
    const knowsBea = (node) => !!node.agent.sa.agent.security.getPeerKey(bea.pubKey);
    expect(knowsBea(phone), 'the phone holds Bea — her greeting landed there').toBe(true);

    // ── 2. A second device enrols: the offer from the phone, the phrase typed on the new device, the
    //       enrolled boot, and the consume that seeds its roster and announces it to its sibling. ───
    const offer = await phone.agent.callSkill('household', 'buildEnrollOffer', {});
    expect(offer.ok, JSON.stringify(offer)).toBe(true);
    const storage = memStorage();
    expect((await stashEnrollOffer(storage, offer.uri)).ok).toBe(true);
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
    const pre = await bootRealAgentNode('box-pre', { agentOpts: vaults });
    const phrase = (await phone.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect(typeof phrase).toBe('string');
    expect((await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'box' })).ok).toBe(true);
    await teardown(pre);
    box = await bootRealAgentNode('box', { agentOpts: vaults });
    expect(box.pubKey, 'the box is the same person').toBe(phone.pubKey);
    // The relay maps the profile address to ONE socket: the box's registration takes it from the phone.
    // Awaited, because the next lines send — boot leaves it non-blocking on purpose.
    await box.agent.connectPeerTransport({ relayUrl, onPeerMessage: (env) => box._routerRef.fn?.(env), awaitRelayReady: true });
    await bindCircleAddresses([box], CIRCLE);
    const consumed = await consumeEnrollOffer({
      agent: box.agent,
      callSkill: (app, op, args) => box.agent.callSkill(app, op, args),
      sendPeerMessage: (to, payload, opts) => box.agent.sendPeerMessage(to, payload, opts),
      storage,
    });
    const report = consumed.circles?.find((c) => c.circleId === CIRCLE);
    expect(report?.ok, JSON.stringify(consumed)).toBe(true);
    expect(report.steps, 'the box announced itself to the phone').toContain('announce');
    // The phone's own roster row grows into the SET holding both devices — the box is now a sibling
    // the phone can reach, at a proven per-circle address.
    const boxAddr = box.agent.circleAddressFor(CIRCLE);
    const grown = await until(async () => {
      const r = await phone.agent.callSkill('stoop', 'listGroupMembers', { groupId: CIRCLE });
      const mine = (r?.members ?? []).find((m) => m.webid === phone.pubKey);
      return mine?.circleAddresses?.includes(boxAddr) ? true : null;
    }, { timeout: 20_000, step: 100 });
    expect(grown, 'the phone never learned the box\'s per-circle address — nothing to sync to').toBe(true);

    // …and hands the new device everyone it knows — the sync this walk is about. Waited for, because a
    // message that arrives in the moment between the box appearing and the phone's push landing is
    // refused like any stranger's (and lost: the relay delivered it). That window is real; it is
    // milliseconds wide, and the walk's claim is what holds once the sync has landed.
    expect(await until(async () => (knowsBea(box) ? true : null), { timeout: 20_000, step: 100 }),
      'the box never learned Bea from the phone — the push on the announce did not land').toBe(true);

    // ── 3. Bea writes again. The relay routes the profile address to its latest socket: the box. ───
    const sent2 = await bea.agent.sendPeerMessage(phone.pubKey, { type: 'p2p-chat', msgId: 'bea-2', ts: Date.now(), text: 'ben je er nog?' }, SEND);
    expect(sent2?.delivered, 'the relay took Bea\'s second message — it reached a socket').toBe(true);

    // The claim. Before this build the box refused her outright — UNKNOWN_SENDER, no binding for a key
    // that only ever greeted the phone — and nothing said so.
    const landed = await until(async () => (textsAt(box).includes('ben je er nog?') ? true : null), { timeout: 20_000 });
    expect(landed,
      `the box did not accept a contact who greeted the phone — the box holds Bea's key: ${knowsBea(box)}; `
      + `the PHONE got it: ${textsAt(phone).includes('ben je er nog?')} — the greeting stayed with the device instead of the person`).toBe(true);
    expect(knowsBea(box), 'the box holds Bea, learned from its sibling, not from a greeting of its own').toBe(true);
    // …and the contact book followed: Bea is a contact on the box, by the name the phone gave her.
    const contacts = await box.agent.callSkill('stoop', 'listContacts', {});
    const beaOnBox = (contacts?.items ?? []).find((c) => c.webid === bea.pubKey);
    expect(beaOnBox?.label, 'the contact book did not follow the key to the box').toBe('Bea');
  }, 180_000);

  it('the other way round: a stranger who greets the BOX is known to the phone before the phone takes the address back', async () => {
    // A second person, Cas, reaches the person while the BOX holds the address. First contact binds
    // his key on the box only — the live half carries it to the phone as it happens.
    const cas = await bootRealAgentNode('cas');
    try {
      await connectNodesOverRelay([cas], { relayUrl });
      await cas.agent.sendPeerMessage(phone.pubKey, { type: 'p2p-chat', msgId: 'cas-1', ts: Date.now(), text: 'hoi, Cas hier' }, SEND);
      expect(await until(async () => (textsAt(box).includes('hoi, Cas hier') ? true : null), { timeout: 15_000 }),
        'the box holds the address now — Cas must reach it directly').toBe(true);
      const knowsCas = (node) => !!node.agent.sa.agent.security.getPeerKey(cas.pubKey);
      expect(knowsCas(box), 'the greeting bound Cas on the box').toBe(true);
      expect(await until(async () => (knowsCas(phone) ? true : null), { timeout: 20_000, step: 100 }),
        'the phone never learned Cas from the box — the live fan on a landed greeting did not carry').toBe(true);

      // The phone comes back (a reconnect: its registration is the latest, the address is its again),
      // and Cas writes again. The phone has never heard Cas greet; it accepts him anyway.
      await phone.agent.sa.relay.disconnect();
      await phone.agent.connectPeerTransport({ relayUrl, onPeerMessage: (env) => phone._routerRef.fn?.(env), awaitRelayReady: true });
      await bindCircleAddresses([phone], CIRCLE);
      const sent = await cas.agent.sendPeerMessage(phone.pubKey, { type: 'p2p-chat', msgId: 'cas-2', ts: Date.now(), text: 'en nu?' }, SEND);
      expect(sent?.delivered, 'the relay took Cas\'s second message').toBe(true);
      expect(await until(async () => (textsAt(phone).includes('en nu?') ? true : null), { timeout: 20_000 }),
        `the phone refused a person who only ever greeted the box — the phone holds Cas's key: ${knowsCas(phone)}`).toBe(true);
    } finally {
      await teardown(cas);
    }
  }, 120_000);
});
