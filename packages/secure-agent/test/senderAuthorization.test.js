/**
 * DECISION 1 at the substrate — the roster-authorize PORT is carried, and nothing more.
 *
 * The substrate's whole job here is to not have an opinion: it holds no rosters, it invents no
 * notion of membership (that would put circle vocabulary below the app — design §2, invariant 5),
 * and it must not quietly drop the port on the floor either. So there are exactly two things to
 * prove, and they pull in opposite directions:
 *
 *   • an installed authorizer really reaches the kernel and really refuses a stranger — over two
 *     real agents on a real bus, not a stubbed SecurityLayer;
 *   • with no authorizer installed, nothing here invents one, and the absence is READABLE rather
 *     than a silence you have to notice.
 *
 * Written in the idiom of `perCircleSigning.test.js`: two real agents, one bus, read the outcome.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import {
  InternalBus, InternalTransport, circleIdentity, deriveCircleAddress, allowSender, refuseSender,
} from '@onderling/core';
import nacl from 'tweetnacl';
import { createSecureAgent } from '../src/createSecureAgent.js';

const FAST = { firstSendTimeoutMs: 800, retryDelays: [] };
const CIRCLE = 'buurtkring-oosterpoort';

const agent = (onPeerMessage) =>
  createSecureAgent({ vault: new VaultMemory(), onPeerMessage, warnOnInsecure: false });

async function until(pred, { timeout = 1200, step = 10 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = pred(); if (v) return v; await new Promise((r) => setTimeout(r, step)); }
  return pred();
}

/** Anna, speaking as her per-circle identity, to Bram, who answers at his. */
async function twoInACircle() {
  const bus = new InternalBus();
  const received = [];
  const anna = await agent();
  const bram = await agent((m) => received.push(m));

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
  // Each side binds the other's per-circle address to the key that signs there — the roster half.
  anna.registerPeerAddress(bramAddress, bram.identity.pubKey, { signingKey: bramInCircle.pubKey });
  bram.registerPeerAddress(annaAddress, anna.identity.pubKey, { signingKey: annaInCircle.pubKey });

  return { anna, bram, received, annaAddress, bramAddress, annaKey: annaInCircle.pubKey };
}

describe('the substrate carries the roster-authorize port', () => {
  it('an installed authorizer reaches the kernel and REFUSES a validly-signed non-member', async () => {
    const { anna, bram, received, annaAddress, bramAddress } = await twoInACircle();

    const asked = [];
    expect(bram.setSenderAuthorizer((ctx) => {
      asked.push(ctx);
      // Anna signs with her circle key; this roster knows nobody. Every signature is genuine and
      // every one is refused — which is the sentence Decision 1 exists to make true.
      return ctx.ownAddress ? refuseSender('not-on-this-roster') : allowSender('out-of-circle');
    })).toBe(true);
    expect(bram.senderAuthorizerInstalled).toBe(true);

    await anna.peer.sendTo(bramAddress, { subtype: 'circle', text: 'hoi' },
      { ...FAST, sendAs: annaAddress }).catch(() => { /* delivery is not the assertion */ });
    await until(() => asked.some((c) => c.ownAddress === bramAddress));

    expect(asked.some((c) => c.ownAddress === bramAddress),
      'the port was asked about traffic addressed to Bram\'s per-circle identity').toBe(true);
    expect(received.some((m) => m.payload?.text === 'hoi'),
      'and the refusal held — the payload never reached the application').toBe(false);

    await anna.shutdown(); await bram.shutdown();
  });

  it('…and the SAME traffic arrives when the authorizer vouches for the key that signed it', async () => {
    // The positive control, in the same shape: only the verdict differs. Without it, the test above
    // would pass just as well against a substrate that had broken circle delivery outright.
    const { anna, bram, received, annaAddress, bramAddress, annaKey } = await twoInACircle();

    bram.setSenderAuthorizer(({ senderKey }) =>
      (senderKey === annaKey ? allowSender('on-the-roster') : refuseSender('stranger')));

    await anna.peer.sendTo(bramAddress, { subtype: 'circle', text: 'hoi' },
      { ...FAST, sendAs: annaAddress });
    await until(() => received.some((m) => m.payload?.text === 'hoi'));

    expect(received.some((m) => m.payload?.text === 'hoi')).toBe(true);

    await anna.shutdown(); await bram.shutdown();
  });

  it('the port is CONTEXT, not a decision — it is told the key, the claim and the address dialled', async () => {
    const { anna, bram, annaAddress, bramAddress, annaKey } = await twoInACircle();
    const asked = [];
    bram.setSenderAuthorizer((ctx) => { asked.push(ctx); return allowSender('ok'); });

    await anna.peer.sendTo(bramAddress, { subtype: 'circle', text: 'hoi' },
      { ...FAST, sendAs: annaAddress });
    await until(() => asked.some((c) => c.senderKey === annaKey));

    const circleAsk = asked.find((c) => c.senderKey === annaKey);
    expect(circleAsk.senderKey, 'the key that DEMONSTRABLY signed — not a claim').toBe(annaKey);
    expect(circleAsk.from, '`_from` is passed as what it is: a hint').toBe(annaAddress);
    expect(circleAsk.ownAddress, 'and which of OUR addresses it was sent to').toBe(bramAddress);

    await anna.shutdown(); await bram.shutdown();
  });

  it('with NO authorizer the substrate invents nothing, and the absence is readable', async () => {
    const { anna, bram, received, annaAddress, bramAddress } = await twoInACircle();

    expect(bram.senderAuthorizerInstalled,
      'nothing in this layer installs one of its own — it holds no rosters').toBe(false);

    await anna.peer.sendTo(bramAddress, { subtype: 'circle', text: 'hoi' },
      { ...FAST, sendAs: annaAddress });
    await until(() => received.some((m) => m.payload?.text === 'hoi'));

    // Delivered — the kernel cannot invent membership out of nothing. What it can do is COUNT the
    // fact that nobody was asked, so "no roster is wired" is a number rather than a silence.
    expect(received.some((m) => m.payload?.text === 'hoi')).toBe(true);
    expect(bram.agent.security.senderAuthorizationsByAbsence).toBeGreaterThan(0);

    await anna.shutdown(); await bram.shutdown();
  });

  it('removing the authorizer is reported honestly', async () => {
    const { anna, bram } = await twoInACircle();
    expect(bram.setSenderAuthorizer(() => allowSender('ok'))).toBe(true);
    expect(bram.senderAuthorizerInstalled).toBe(true);
    expect(bram.setSenderAuthorizer(null)).toBe(false);
    expect(bram.senderAuthorizerInstalled).toBe(false);
    await anna.shutdown(); await bram.shutdown();
  });
});
