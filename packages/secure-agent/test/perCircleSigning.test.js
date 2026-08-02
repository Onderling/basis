/**
 * DECISION 4 at the substrate — a send may name WHICH of this device's identities is speaking.
 *
 * The kernel holds the identities and does the crypto; this layer's job is to carry the caller's
 * choice — an ADDRESS of ours, never a key and never a circle id — from `sendTo` down to the
 * transport, and to make the handshake announce the matching key. Getting the second half wrong is
 * the interesting failure: an HI that announces the canonical key while the envelopes that follow are
 * signed with the circle key makes every one of them fail verification at the far end, and the
 * symptom ("my messages in this circle never arrive") points nowhere near the cause.
 *
 * Written with two real agents on one bus, reading the WIRE — the idiom of `circleScopedRouting.test.js`.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import {
  InternalBus, InternalTransport, AgentIdentity, circleIdentity, deriveCircleAddress,
} from '@onderling/core';
import nacl from 'tweetnacl';
import { createSecureAgent } from '../src/createSecureAgent.js';

const FAST = { firstSendTimeoutMs: 800, retryDelays: [] };
const CIRCLE = 'buurtkring-oosterpoort';

const agent = (onPeerMessage) =>
  createSecureAgent({ vault: new VaultMemory(), onPeerMessage, warnOnInsecure: false });

function watch(transport) {
  const log = [];
  const put = transport._put.bind(transport);
  transport._put = async (to, env) => { log.push({ to, env }); return put(to, env); };
  return log;
}

async function until(pred, { timeout = 1500, step = 10 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = pred(); if (v) return v; await new Promise((r) => setTimeout(r, step)); }
  return pred();
}

describe('a send can speak as a per-circle identity', () => {
  it('stamps the circle address, signs with the circle key, and announces THAT key in the HI', async () => {
    const bus = new InternalBus();
    const received = [];
    const anna = await agent();
    const bram = await agent((m) => received.push(m));

    const profileSeed = new Uint8Array(nacl.randomBytes(32));
    const annaInCircle = await circleIdentity(profileSeed, CIRCLE, new VaultMemory());
    const circleAddress = deriveCircleAddress(profileSeed, CIRCLE);

    const annaTx = new InternalTransport(bus, anna.identity.pubKey);
    await anna.addSecureTransport('relay', annaTx);
    await bram.addSecureTransport('relay', new InternalTransport(bus, bram.identity.pubKey));

    // The two halves the app wires: the identity at the kernel, the address on the transport.
    expect(anna.registerSelfIdentity(circleAddress, annaInCircle)).toBe(true);
    expect(anna.selfIdentityAddresses).toContain(circleAddress);
    await annaTx.addAddress(circleAddress);

    const wire = watch(annaTx);
    await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'circle', text: 'hoi' },
      { ...FAST, sendAs: circleAddress });

    await until(() => received.find((m) => m.payload?.subtype === 'circle'));

    for (const { env } of wire) {
      expect(env._from, 'every envelope of this send speaks as the circle address').toBe(circleAddress);
    }
    const hi = wire.find(({ env }) => env._p === 'HI');
    expect(hi.env.payload.pubKey, 'the HI announces the CIRCLE key').toBe(annaInCircle.pubKey);
    expect(JSON.stringify(wire)).not.toContain(anna.identity.pubKey);

    await anna.shutdown(); await bram.shutdown();
  });

  it('an unregistered sendAs falls back to the canonical identity and SAYS so', async () => {
    const bus = new InternalBus();
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...a) => warnings.push(a.join(' '));
    try {
      const anna = await agent();
      const bram = await agent();
      const annaTx = new InternalTransport(bus, anna.identity.pubKey);
      await anna.addSecureTransport('relay', annaTx);
      await bram.addSecureTransport('relay', new InternalTransport(bus, bram.identity.pubKey));

      const wire = watch(annaTx);
      await anna.peer.sendTo(bram.identity.pubKey, { text: 'x' },
        { ...FAST, sendAs: 'an-address-with-no-identity-behind-it' });

      expect(wire.every(({ env }) => env._from === anna.identity.pubKey)).toBe(true);
      expect(warnings.join('\n')).toMatch(/no identity registered for own address/);
      await anna.shutdown(); await bram.shutdown();
    } finally { console.warn = originalWarn; }
  });

  it('ordinary sends are untouched — no sendAs, no per-circle anything', async () => {
    const bus = new InternalBus();
    const anna = await agent();
    const bram = await agent();
    const annaTx = new InternalTransport(bus, anna.identity.pubKey);
    await anna.addSecureTransport('relay', annaTx);
    await bram.addSecureTransport('relay', new InternalTransport(bus, bram.identity.pubKey));
    const wire = watch(annaTx);
    await anna.peer.sendTo(bram.identity.pubKey, { text: 'x' }, FAST);
    expect(wire.every(({ env }) => env._from === anna.identity.pubKey)).toBe(true);
    await anna.shutdown(); await bram.shutdown();
  });

  it('having HI-ed a peer as ourselves does not count as having HI-ed them as a circle', async () => {
    // The handshake cache used to be keyed by the peer alone. With two identities that is wrong: the
    // peer holds our canonical key and nothing else, so the circle send that follows would be signed
    // with a key they have never seen — and would be rejected, silently, forever.
    const bus = new InternalBus();
    const anna = await agent();
    const bram = await agent();
    const profileSeed = new Uint8Array(nacl.randomBytes(32));
    const annaInCircle = await circleIdentity(profileSeed, CIRCLE, new VaultMemory());
    const circleAddress = deriveCircleAddress(profileSeed, CIRCLE);

    const annaTx = new InternalTransport(bus, anna.identity.pubKey);
    await anna.addSecureTransport('relay', annaTx);
    await bram.addSecureTransport('relay', new InternalTransport(bus, bram.identity.pubKey));
    anna.registerSelfIdentity(circleAddress, annaInCircle);
    await annaTx.addAddress(circleAddress);

    await anna.peer.sendTo(bram.identity.pubKey, { text: 'as myself' }, FAST);
    const wire = watch(annaTx);
    await anna.peer.sendTo(bram.identity.pubKey, { text: 'as the circle' },
      { ...FAST, sendAs: circleAddress });

    const hi = wire.find(({ env }) => env._p === 'HI');
    expect(hi, 'a second handshake is sent for the circle identity').toBeTruthy();
    expect(hi.env.payload.pubKey).toBe(annaInCircle.pubKey);

    await anna.shutdown(); await bram.shutdown();
  });
});

describe('a peer address carries two keys, and they are used for different things', () => {
  it('the SIGNING key binds the crypto; the identity key still groups the person locally', async () => {
    const anna = await agent();
    const peerIdentity = await AgentIdentity.fromSeed(new Uint8Array(nacl.randomBytes(32)), new VaultMemory());
    const profileSeed = new Uint8Array(nacl.randomBytes(32));
    const inX = deriveCircleAddress(profileSeed, CIRCLE);
    const inY = deriveCircleAddress(profileSeed, 'huishouden-de-vries');
    const keyX = (await circleIdentity(profileSeed, CIRCLE, new VaultMemory())).pubKey;
    const keyY = (await circleIdentity(profileSeed, 'huishouden-de-vries', new VaultMemory())).pubKey;

    expect(anna.registerPeerAddress(inX, peerIdentity.pubKey, { signingKey: keyX })).toBe(true);
    expect(anna.registerPeerAddress(inY, peerIdentity.pubKey, { signingKey: keyY })).toBe(true);
    // What verifies and seals at each address is THAT circle's key…
    expect(anna.agent.security.getPeerKey(inX)).toBe(keyX);
    expect(anna.agent.security.getPeerKey(inY)).toBe(keyY);

    // …and both are still known to be the same person. That is what makes presence on one address
    // flush what is held for another. Before Decision 4 the crypto layer answered "who is this" with
    // the person's one key, so this grouping came for free; now it deliberately answers with a key
    // that is different per circle, and the person-level link has to be kept on purpose.
    const bus = new InternalBus({ presenceAware: true });
    const annaTx = new InternalTransport(bus, anna.identity.pubKey);
    await anna.addSecureTransport('relay', annaTx);

    const held = await anna.peer.sendTo(inY, { text: 'while you were out' },
      { ...FAST, guarantee: 'hold-forward' });
    expect(held.held, 'an unreachable circle address holds').toBe(true);
    expect(anna.heldFor(inY)).toBe(1);

    // They come back — visible on their OTHER circle address, which is all a presence signal ever
    // carries. The message held for Y must be retried, and it is only found via the person.
    const theirX = new InternalTransport(bus, inX);
    const theirY = new InternalTransport(bus, inY);
    await theirX.connect(); await theirY.connect();
    const wire = watch(annaTx);
    await anna.presenceSignal(inX);
    expect(wire.some(({ to }) => to === inY),
      'presence on ONE circle address retried what was held for ANOTHER of the same person').toBe(true);

    await theirX.disconnect(); await theirY.disconnect();
    await anna.shutdown();
  });

  it('without a signingKey it behaves exactly as before — one key for both', async () => {
    const anna = await agent();
    const peerIdentity = await AgentIdentity.fromSeed(new Uint8Array(nacl.randomBytes(32)), new VaultMemory());
    anna.registerPeerAddress('some-alias', peerIdentity.pubKey);
    expect(anna.agent.security.getPeerKey('some-alias')).toBe(peerIdentity.pubKey);
    await anna.shutdown();
  });
});
