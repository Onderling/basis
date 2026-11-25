/**
 * THE WIRE REFUSAL over a real relay, between two real agents composed as the shells compose them. Ann's device speaks a
 * wire below what mine accepts (an older build: the same keys, an older `_w` inside the signature). My receive gate refuses
 * it and answers ONE refusal frame; from then on NOTHING flows either way through the send gate (my sends to her are
 * refused because she is older, hers to me because I refused her), the contact row and the refused bubble say which side
 * is older, and the mark clears on both sides once an envelope with an accepted wire arrives.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { SecurityLayer, WIRE_VERSION } from '@onderling/core';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown, addCardOf } from './support/pairRealAgents.js';
import { contactRowMeta, withPeerNotices } from '../src/v2/contactsSource.js';
import { deliveryPresentation } from '../src/v2/deliverySettings.js';
import { DELIVERY } from '../src/v2/deliveryState.js';

const t = (k, v = {}) => `${k}${v.name ? `:${v.name}` : ''}`;

describe('the wire refusal between two real agents over a relay', () => {
  let relay; let me; let ann;
  const coreOf = (n) => n.agent.sa.agent;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    const opts = () => ({ contactChannel: true, agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() } });
    [me, ann] = await Promise.all([bootRealAgentNode('me', opts()), bootRealAgentNode('ann', opts())]);
    await connectNodesOverRelay([me, ann], { relayUrl: relay.url });
  }, 120_000);
  afterAll(async () => { await teardown(me, ann); await relay?.close?.(); });

  it('an envelope from an older wire is refused, answered with one refusal frame, and both sides hold the reason', async () => {
    expect(me.agent.wireRefusal(ann.pubKey), 'nothing refused before the older envelope').toBeNull();
    await addCardOf(me, ann); await addCardOf(ann, me);   // each holds the other's card: no send is held for an unknown address
    // and each holds the other's key from before (what a stored peer record restores at a start): they talked before the update
    coreOf(me).security.registerPeer(ann.pubKey, ann.pubKey); coreOf(ann).security.registerPeer(me.pubKey, me.pubKey);
    // Ann's device as an OLDER build: her own keys, her own send path and relay connection, but every envelope she signs
    // carries a wire below ours (her layer's `encrypt` swapped for an older build's, for this one send)
    const annSec = coreOf(ann).security;
    const older = new SecurityLayer({ identity: coreOf(ann).identity, wire: WIRE_VERSION - 1 });
    older.registerPeer(me.pubKey, annSec.getPeerKey(me.pubKey) ?? me.pubKey);
    const realEncrypt = annSec.encrypt;
    annSec.encrypt = (env) => older.encrypt(env);
    try {
      await ann.agent.sendPeerMessage(me.pubKey, { subtype: 'delivery-receipt', messageId: 'old-1' }).catch(() => null);
      expect(await until(() => me.agent.wireRefusal(ann.pubKey), { timeout: 10_000, step: 100 }), 'my receive gate refused her wire')
        .toEqual({ side: 'we-refused', wire: WIRE_VERSION - 1 });
    } finally { annSec.encrypt = realEncrypt; }
    expect(await until(() => ann.agent.wireRefusal(me.pubKey), { timeout: 10_000, step: 100 }), 'my refusal frame reached her')
      .toEqual({ side: 'they-refused', wire: WIRE_VERSION });
  }, 30_000);

  it('the send gate holds both ways: nothing leaves, each with the reason that says which side is older', async () => {
    const mine = await me.agent.sendPeerMessage(ann.pubKey, { subtype: 'delivery-receipt', messageId: 'x' });
    expect(mine, JSON.stringify(mine)).toMatchObject({ delivered: false, refused: 'wire', reason: 'wire-peer-older' });
    const hers = await ann.agent.sendPeerMessage(me.pubKey, { subtype: 'delivery-receipt', messageId: 'y' });
    expect(hers, JSON.stringify(hers)).toMatchObject({ delivered: false, refused: 'wire', reason: 'wire-older' });
    // the bubble's words for each reason
    expect(deliveryPresentation(DELIVERY.FAILED, { reason: 'wire-older' })?.labelKey).toBe('circle.chat.delivery.wire_older');
    expect(deliveryPresentation(DELIVERY.FAILED, { reason: 'wire-peer-older' })?.labelKey).toBe('circle.chat.delivery.wire_peer_older');
  }, 30_000);

  it('the contact row says it, in words, on both sides', () => {
    const [myRow] = withPeerNotices([{ contactId: ann.pubKey, name: 'Ann', peerAddr: ann.pubKey, reachable: true }], me.agent);
    expect(contactRowMeta(myRow, t)).toContain('circle.contacts.wire_peer_older:Ann');
    const [herRow] = withPeerNotices([{ contactId: me.pubKey, name: 'Ik', peerAddr: me.pubKey, reachable: true }], ann.agent);
    expect(contactRowMeta(herRow, t)).toContain('circle.contacts.wire_older:Ik');
  });

  it('the marks clear once an envelope with an accepted wire arrives (her device updated)', async () => {
    // her updated build speaks the current wire: after an update she starts fresh (the marks live in memory, per start),
    // so her first envelope leaves below her app's gate here, over her own relay connection
    await ann.agent.sa.peer.sendTo(me.pubKey, { subtype: 'delivery-receipt', messageId: 'new-1' }).catch(() => {});
    expect(await until(() => (me.agent.wireRefusal(ann.pubKey) === null ? true : null), { timeout: 10_000, step: 100 }), 'my mark cleared').toBe(true);
    const mine = await me.agent.sendPeerMessage(ann.pubKey, { subtype: 'delivery-receipt', messageId: 'z' });
    expect(mine?.refused ?? null, JSON.stringify(mine)).not.toBe('wire');
    expect(await until(() => (ann.agent.wireRefusal(me.pubKey) === null ? true : null), { timeout: 10_000, step: 100 }), 'her mark cleared on my next envelope').toBe(true);
  }, 30_000);
});
