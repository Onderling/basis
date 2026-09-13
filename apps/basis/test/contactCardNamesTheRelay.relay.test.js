/**
 * THE CARD SAYS WHERE TO FIND ME — a contact from a card is reachable without a shared kring.
 *
 * A direct message carries no circle, so nothing names a relay for it. Until now the sender either
 * shared a kring with the person (and rode that kring's relay) or guessed: every relay the sender
 * happened to be on, one after the other. Two people who met by CARD and share no kring were the
 * case that had no answer — and when the sender is on a different relay from the person, the guess is
 * every relay the person is NOT on.
 *
 * Frits, 2026-09-11: the contact card carries the sharer's PRIMARY relay by default (extras opt-in per
 * relay, and never mDNS); the scanned contact keeps those points; a message to that person rides them
 * FIRST — before any kring's relay — and the sender comes beside that relay when it is on none of
 * them. This walk is two people on two relays with no kring between them: Anna's card names relay 1,
 * Bea is on relay 2 only. Before the build Bea's message had nowhere to go.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, until, teardown } from './support/pairRealAgents.js';

const SEND = { hold: true, firstSendTimeoutMs: 4000, retryDelays: [] };
const textsAt = (node) => node.received.map((m) => m?.payload?.text).filter(Boolean);

describe('a contact from a card is reached on the relay the card named', () => {
  let relay1; let relay2; let anna; let bea;

  beforeAll(async () => {
    [relay1, relay2] = await Promise.all([startJourneyRelay(), startJourneyRelay()]);
    [anna, bea] = await Promise.all([bootRealAgentNode('anna'), bootRealAgentNode('bea')]);
    // Two people, two relays, no kring in common.
    await anna.agent.connectPeerTransport({ relayUrl: relay1.url, onPeerMessage: (env) => anna._routerRef.fn?.(env), awaitRelayReady: true });
    await bea.agent.connectPeerTransport({ relayUrl: relay2.url, onPeerMessage: (env) => bea._routerRef.fn?.(env), awaitRelayReady: true });
  }, 60_000);

  afterAll(async () => {
    await teardown(anna, bea);
    for (const r of [relay1, relay2]) { try { await r?.close?.(); } catch { /* */ } }
  });

  it('Anna\'s card names her relay; Bea scans it and writes; the message arrives although Bea was on another relay', async () => {
    // ── The card, as the app builds it: the address, and now the primary relay. ─────────────────
    const card = await anna.agent.callSkill('stoop', 'getContactShareQr', {});
    expect(typeof card?.payload).toBe('string');
    expect(card.relays, 'the card carries the sharer\'s primary relay').toEqual([relay1.url]);

    // ── The scan, minus the camera: the contact keeps the card's points. ──────────────────────────
    const added = await bea.agent.callSkill('stoop', 'addContactFromQr', { payload: card.payload });
    expect(added?.contact?.webid).toBe(anna.pubKey);
    expect(added.contact.points, 'the scanned contact remembers where to find her').toEqual([relay1.url]);
    expect(bea.agent.relays.list().map((r) => r.url), 'Bea is on her own relay only, so far').toEqual([relay2.url]);

    // ── The message. No kring names a relay; the card does. ───────────────────────────────────────
    const sent = await bea.agent.sendPeerMessage(anna.pubKey, { type: 'p2p-chat', msgId: 'dm-1', ts: Date.now(), text: 'hoi Anna, via je kaart' }, SEND);
    expect(sent?.held, `the message was HELD — nothing carried it: ${JSON.stringify(sent)}`).not.toBe(true);
    expect(await until(async () => (textsAt(anna).includes('hoi Anna, via je kaart') ? true : null), { timeout: 15_000 }),
      'the message never reached Anna — the card named relay 1 and Bea did not go there').toBe(true);
    expect(bea.agent.relays.list().map((r) => r.url), 'Bea came beside the relay the card named; her own stays primary').toEqual([relay2.url, relay1.url]);
  }, 60_000);
});
