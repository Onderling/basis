/**
 * A SEND FROM AN ADDRESS THE RECEIVER HAS NOT FOLDED YET. The receiver refuses it silently (a stranger learns nothing),
 * so the sender cannot tell it from offline and holds it — but the introduction is usually seconds away, and no
 * presence signal is coming to flush it. When the address the send went out AS is young, the hold re-flushes on a
 * short bounded back-off, and the message arrives once the receiver knows the address.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport, circleIdentity, deriveCircleAddress, allowSender, refuseSender } from '@onderling/core';
import nacl from 'tweetnacl';
import { createSecureAgent } from '../src/createSecureAgent.js';

const CIRCLE = 'circle-oosterpoort';
const FAST = { firstSendTimeoutMs: 400, retryDelays: [] };

async function until(pred, { timeout = 1200, step = 20 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = pred(); if (v) return v; await new Promise((r) => setTimeout(r, step)); }
  return pred();
}

async function aNewAddressNotYetFolded({ foldAfterMs, agentOpts = {} }) {
  // Anna's new phone has not met Bram yet either: its first send opens with a HI, which Bram refuses until the fold
  const bus = new InternalBus();
  const received = [];
  const anna = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, ...agentOpts });
  const bram = await createSecureAgent({ vault: new VaultMemory(), onPeerMessage: (m) => received.push(m), warnOnInsecure: false });
  const annaSeed = new Uint8Array(nacl.randomBytes(32));
  const bramSeed = new Uint8Array(nacl.randomBytes(32));
  const annaInCircle = await circleIdentity(annaSeed, CIRCLE, new VaultMemory());
  const bramInCircle = await circleIdentity(bramSeed, CIRCLE, new VaultMemory());
  const annaAddress = deriveCircleAddress(annaSeed, CIRCLE);
  const bramAddress = deriveCircleAddress(bramSeed, CIRCLE);
  const annaTx = new InternalTransport(bus, anna.identity.pubKey);
  const bramTx = new InternalTransport(bus, bram.identity.pubKey);
  await anna.addSecureTransport('relay', annaTx);
  await bram.addSecureTransport('relay', bramTx);
  anna.registerSelfIdentity(annaAddress, annaInCircle);
  bram.registerSelfIdentity(bramAddress, bramInCircle);
  await annaTx.addAddress(annaAddress);
  await bramTx.addAddress(bramAddress);
  // the introduction of Anna's new address folds at Bram only after a while: until then he neither knows the address
  // nor has her circle key on the roster
  const foldedAt = Date.now() + foldAfterMs;
  setTimeout(() => bram.registerPeerAddress(annaAddress, anna.identity.pubKey, { signingKey: annaInCircle.pubKey }), foldAfterMs);
  bram.setSenderAuthorizer(({ senderKey, ownAddress }) => {
    if (!ownAddress) return allowSender('out-of-circle');
    return senderKey === annaInCircle.pubKey && Date.now() >= foldedAt ? allowSender('on-the-roster') : refuseSender('not-on-this-roster');
  });
  return { anna, bram, received, annaAddress, bramAddress };
}

// the back-off at test speed: three re-flushes inside a few seconds
const YOUNG = { youngAddressWindowMs: 10_000, youngAddressRetryMs: [300, 900, 1800] };

describe('a send from a young address that the receiver has not folded yet', () => {
  it('is held, then re-flushed on the bounded back-off and delivered once the receiver folds the address — no presence needed', { timeout: 20_000 }, async () => {
    const { anna, bram, received, annaAddress, bramAddress } = await aNewAddressNotYetFolded({ foldAfterMs: 1000, agentOpts: YOUNG });
    const r = await anna.peer.sendTo(bramAddress, { subtype: 'circle', text: 'hoi', msgId: 'm1' }, { ...FAST, sendAs: annaAddress, guarantee: 'hold-forward' });
    expect(r.held, 'the first send is refused (silently) and held').toBe(true);
    expect(await until(() => received.some((m) => m.payload?.text === 'hoi'), { timeout: 6000, step: 50 }), 'the held message never arrived').toBe(true);
    await anna.shutdown(); await bram.shutdown();
  });

  it('an OLD address gets no back-off: its hold waits for presence, as before', { timeout: 20_000 }, async () => {
    const { anna, bram, received, annaAddress, bramAddress } = await aNewAddressNotYetFolded({ foldAfterMs: 1000, agentOpts: { ...YOUNG, youngAddressWindowMs: 1 } });
    await new Promise((res) => setTimeout(res, 20));   // the address is past the window
    const r = await anna.peer.sendTo(bramAddress, { subtype: 'circle', text: 'hoi', msgId: 'm1' }, { ...FAST, sendAs: annaAddress, guarantee: 'hold-forward' });
    expect(r.held).toBe(true);
    await new Promise((res) => setTimeout(res, 4000));
    expect(received.some((m) => m.payload?.text === 'hoi')).toBe(false);
    await anna.shutdown(); await bram.shutdown();
  });

  it('the back-off is bounded and never writes the peer off: after the last try the hold is still there for presence', { timeout: 20_000 }, async () => {
    const { anna, bram, annaAddress, bramAddress } = await aNewAddressNotYetFolded({ foldAfterMs: 60_000, agentOpts: YOUNG });
    await anna.peer.sendTo(bramAddress, { subtype: 'circle', text: 'hoi', msgId: 'm1' }, { ...FAST, sendAs: annaAddress, guarantee: 'hold-forward' });
    await new Promise((res) => setTimeout(res, 5000));
    expect(anna.heldFor(bramAddress), 'the message is still held after the back-off').toBe(1);
    await anna.shutdown(); await bram.shutdown();
  });
});
