/**
 * End-to-end: a real relay gives up on a queued message, and the SENDER'S transport hears about it.
 *
 * The unit tests next door prove ForwardQueue announces a give-up and that RelayTransport understands the
 * frame. Neither proves they are connected to each other — and that is precisely the failure this repo
 * keeps having: Decision 3 shipped a correct seam that nothing passed through, and it looked exactly like
 * working code. So this test runs the real server, sends to an address nobody has registered, forces the
 * eviction, and asserts the notice arrives at the sender over a real socket.
 *
 * It lives in the RELAY package, not in transports: `packages/relay` already carries
 * `@onderling/transports` as a devDependency and its tests already drive RelayTransport, whereas the
 * reverse edge would point a lower layer at a higher one (invariant 5).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { RelayTransport } from '@onderling/transports';
import { startRelay } from '../src/server.js';

/** A vault that keeps nothing — this suite needs a signing key, not persistence. */
const throwawayVault = () => {
  const store = new Map();
  return { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } };
};

let stop = null;
afterEach(async () => { try { await stop?.(); } finally { stop = null; } });

const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

describe('the relay tells the sender it gave up', () => {
  it('delivers an `undelivered` notice naming the sender\'s own message', async () => {
    // A tiny queue cap is the deterministic way to force a give-up: the second message to an offline
    // address evicts the first. (The TTL path is the same code — proven in the relay\'s own suite.)
    const relay = await startRelay({ port: 0, host: '127.0.0.1', queueCap: 1, queueCapTotal: 1 });
    stop = () => relay.close?.();
    const url = `ws://127.0.0.1:${relay.port}`;

    const identity = await AgentIdentity.generate(throwawayVault());
    const seen = [];
    const tx = new RelayTransport({ identity, relayUrl: url, onUndelivered: (i) => seen.push(i) });
    await tx.connect();
    await settle();

    // nobody has ever registered this address, so both sends queue
    const absent = (await AgentIdentity.generate(throwawayVault())).pubKey;
    await tx.sendOneWay(absent, { hello: 1, msgId: 'chat-msg-1' });
    await tx.sendOneWay(absent, { hello: 2, msgId: 'chat-msg-2' });
    await settle();

    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen[0]).toMatchObject({ reason: 'bucket-full' });
    // THE id the app can act on — the payload's msgId, which is what the delivery state is keyed by — not
    // the envelope's, which only the wire ever knew. The envelope id rides along, named as such.
    expect(seen[0].msgId).toBe('chat-msg-1');
    expect(typeof seen[0].envelopeId).toBe('string');
    expect(seen[0].envelopeId).not.toBe('chat-msg-1');

    await tx.disconnect?.();
  }, 20_000);
});

describe('an id-less payload is reported by its envelope id — the app never tracked it, so nothing else names it', () => {
  it('falls back to the envelope id', async () => {
    const relay = await startRelay({ port: 0, host: '127.0.0.1', queueCap: 1, queueCapTotal: 1 });
    stop = () => relay.close?.();
    const identity = await AgentIdentity.generate(throwawayVault());
    const seen = [];
    const tx = new RelayTransport({ identity, relayUrl: `ws://127.0.0.1:${relay.port}`, onUndelivered: (i) => seen.push(i) });
    await tx.connect();
    await settle();
    const absent = (await AgentIdentity.generate(throwawayVault())).pubKey;
    await tx.sendOneWay(absent, { hello: 1 });
    await tx.sendOneWay(absent, { hello: 2 });
    await settle();
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen[0].msgId).toBe(seen[0].envelopeId);
    await tx.disconnect?.();
  }, 20_000);
});
