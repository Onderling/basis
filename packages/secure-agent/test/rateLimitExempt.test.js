/**
 * Rate-limit EXEMPTION (the go-live catch-up carve-out) — through the ENVELOPE PATH, not the
 * bucket API: a reconnect catch-up legitimately serves a burst far above the chat-pace bucket
 * (one replay is up to 1000 items against burst 30), so the app injects `exempt(env)` naming its
 * catch-up REPLY subtypes. This asserts the semantics where they bind — the receive boundary:
 * plain envelopes over quota DROP before onPeerMessage; exempt envelopes all arrive, and they do
 * not spend the plain traffic's tokens either.
 */
import { describe, it, expect, vi } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport } from '@onderling/core';
import { createSecureAgent } from '../src/createSecureAgent.js';

const until = async (pred, { timeout = 4000, step = 10 } = {}) => {
  const start = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - start >= timeout) return v;
    await new Promise((r) => setTimeout(r, step));
  }
};

describe('rateLimit exempt — the catch-up burst passes, plain flood still drops', () => {
  it('over-quota plain envelopes drop; exempt-subtype envelopes all arrive and spend no tokens', async () => {
    const bus = new InternalBus();
    const received = [];
    const receiver = await createSecureAgent({
      vault: new VaultMemory(),
      warnOnInsecure: false,
      rateLimit: {
        perPeer: { burst: 3, refillPerSec: 0 },
        global: false,
        exempt: (env) => env?.payload?.subtype === 'test-catchup-batch',
      },
      onPeerMessage: (env) => { received.push(env?.payload?.subtype ?? env?.type ?? null); },
    });
    const sender = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false });
    await receiver.addSecureTransport('relay', new InternalTransport(bus, receiver.identity.pubKey));
    await sender.addSecureTransport('relay', new InternalTransport(bus, sender.identity.pubKey));

    // The EXEMPT burst first: ten catch-up batches — far over the burst-3 bucket — all arrive.
    for (let i = 0; i < 10; i += 1) {
      await sender.peer.sendTo(receiver.identity.pubKey, { subtype: 'test-catchup-batch', i });
    }
    await until(() => received.filter((s) => s === 'test-catchup-batch').length >= 10);
    expect(received.filter((s) => s === 'test-catchup-batch').length).toBe(10);

    // The plain burst second: the bucket is UNTOUCHED by the exempt traffic (minus the handshake
    // HI this transport pair spent), so plain envelopes flow until it empties, then drop silently.
    for (let i = 0; i < 10; i += 1) {
      await sender.peer.sendTo(receiver.identity.pubKey, { subtype: 'test-plain', i });
    }
    await new Promise((r) => setTimeout(r, 300));   // give any stragglers time to land
    const plain = received.filter((s) => s === 'test-plain').length;
    expect(plain, `plain arrivals: ${plain} (bucket must bind)`).toBeLessThanOrEqual(3);
    expect(plain, 'the bucket must not be pre-drained by exempt traffic').toBeGreaterThanOrEqual(1);

    await sender.shutdown();
    await receiver.shutdown();
  }, 30_000);
});
