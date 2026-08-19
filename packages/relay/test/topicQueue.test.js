/**
 * Topic-aware offline queueing — Phase 7 step 4.
 *
 * Verifies the per-(addr, topic) bucketing behaviour added 2026-05-04:
 *   - Wire frame `{type:'send', to, envelope, topic?}` honours the optional
 *     `topic` hint set by `RelayTransport._put` for `publishOneWay` envelopes.
 *   - Each (addr, topic) bucket caps independently at `queueCap`.
 *   - Non-publish sends share a single legacy bucket (topic=null).
 *   - Global per-address ceiling (`queueCapTotal`, default 4× queueCap) is
 *     a safety valve against many-distinct-topic flooding.
 *   - Drain on reconnect replays all buckets in chronological order.
 *
 * The publisher↔relay end-to-end pubsub flow (real `core.Agent` +
 * `pubSub.publish` → `RelayTransport._put` → relay) is exercised in
 * `packages/core/test/pubSub.test.js` and `packages/relay/test/RelayAgent.test.js`;
 * here we drive the relay directly via raw WS frames so each invariant is
 * pinned independently of the SDK plumbing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startRelay } from '../src/server.js';
// Registration is challenge-first (Decision 3): `addr('alice')` is a real key the client can prove.
import { openClient, send, addr } from './helpers/provenClient.js';
async function waitFor(predicate, timeoutMs = 1_000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timeout');
    await new Promise(r => setTimeout(r, 5));
  }
}
function publishFrame(to, topic, n) {
  return { type: 'send', to, topic, envelope: { _p: 'OW', _topic: topic, payload: { n } } };
}
function legacyFrame(to, n) {
  return { type: 'send', to, envelope: { _p: 'OW', payload: { n } } };
}

describe('startRelay — topic-aware offline queue (Phase 7 step 4)', () => {
  let relay;
  beforeEach(async () => {
    // queueCap=3 for compact tests; queueCapTotal default = 4*3 = 12.
    relay = await startRelay({ port: 0, queueCap: 3 });
  });
  afterEach(async () => {
    await relay.stop();
  });

  it('forwards an online publish frame including the topic hint (no queueing)', async () => {
    const alice = await openClient(`ws://127.0.0.1:${relay.port}`);
    const bob   = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(alice, { type: 'register', address: addr('alice') });
    send(bob,   { type: 'register', address: addr('bob')   });
    await waitFor(() => alice.messages.some(m => m.type === 'registered')
                     && bob.messages.some(m => m.type === 'registered'));

    send(alice, publishFrame(addr('bob'), 'block-42/requests', 1));

    await waitFor(() => bob.messages.some(m => m.type === 'message'));
    const delivered = bob.messages.find(m => m.type === 'message');
    expect(delivered.envelope.payload).toEqual({ n: 1 });
    expect(delivered.envelope._topic).toBe('block-42/requests');

    alice.close(); bob.close();
  });

  it('per-bucket FIFO eviction: noisy topic does not evict a quiet topic', async () => {
    const alice = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(alice, { type: 'register', address: addr('alice') });
    await waitFor(() => alice.messages.some(m => m.type === 'registered'));

    // bob is offline. Send 5 publishes on topic A (over the cap of 3) plus
    // 1 publish on topic B. Topic B's single message must survive.
    for (let n = 1; n <= 5; n++) send(alice, publishFrame(addr('bob'), 'A', n));
    send(alice, publishFrame(addr('bob'), 'B', 99));
    await new Promise(r => setTimeout(r, 30));

    const bob = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(bob, { type: 'register', address: addr('bob') });

    await waitFor(() =>
      bob.messages.filter(m => m.type === 'message').length >= 4,
    );
    const delivered = bob.messages.filter(m => m.type === 'message').map(m => ({
      topic: m.envelope._topic,
      n:     m.envelope.payload.n,
    }));
    // Topic A keeps the 3 newest (n=3,4,5 — n=1,2 evicted by per-bucket cap).
    // Topic B's single message (n=99) survives.
    expect(delivered).toEqual(expect.arrayContaining([
      { topic: 'A', n: 3 }, { topic: 'A', n: 4 }, { topic: 'A', n: 5 },
      { topic: 'B', n: 99 },
    ]));
    expect(delivered.filter(m => m.topic === 'A')).toHaveLength(3);
    expect(delivered.filter(m => m.topic === 'B')).toHaveLength(1);

    alice.close(); bob.close();
  });

  it('legacy (no topic) sends share a single null-topic bucket capped at queueCap', async () => {
    const alice = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(alice, { type: 'register', address: addr('alice') });
    await waitFor(() => alice.messages.some(m => m.type === 'registered'));

    // 5 untopiced sends. Default cap of 3: oldest 2 evicted.
    for (let n = 1; n <= 5; n++) send(alice, legacyFrame(addr('bob'), n));
    await new Promise(r => setTimeout(r, 30));

    const bob = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(bob, { type: 'register', address: addr('bob') });
    await waitFor(() =>
      bob.messages.filter(m => m.type === 'message').length === 3,
    );
    const ns = bob.messages
      .filter(m => m.type === 'message')
      .map(m => m.envelope.payload.n);
    expect(ns).toEqual([3, 4, 5]);

    alice.close(); bob.close();
  });

  it('topic-bucketed and untopiced messages share an address but cap independently', async () => {
    const alice = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(alice, { type: 'register', address: addr('alice') });
    await waitFor(() => alice.messages.some(m => m.type === 'registered'));

    // 5 of A (cap 3 → keep 3,4,5), 4 untopiced (cap 3 → keep 2,3,4).
    for (let n = 1; n <= 5; n++) send(alice, publishFrame(addr('bob'), 'A', n));
    for (let n = 1; n <= 4; n++) send(alice, legacyFrame(addr('bob'), n));
    await new Promise(r => setTimeout(r, 30));

    const bob = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(bob, { type: 'register', address: addr('bob') });
    await waitFor(() =>
      bob.messages.filter(m => m.type === 'message').length === 6,
    );
    const delivered = bob.messages
      .filter(m => m.type === 'message')
      .map(m => ({ topic: m.envelope._topic ?? null, n: m.envelope.payload.n }));
    const aBucket    = delivered.filter(m => m.topic === 'A');
    const nullBucket = delivered.filter(m => m.topic === null);
    expect(aBucket.map(m => m.n).sort()).toEqual([3, 4, 5]);
    expect(nullBucket.map(m => m.n).sort()).toEqual([2, 3, 4]);

    alice.close(); bob.close();
  });

  it('global queueCapTotal safety valve trims oldest across topics when many distinct topics flood', async () => {
    // queueCap=3, queueCapTotal=4 — 4× ratio is the default but we want a
    // tight ceiling so we can verify the safety valve fires before per-bucket.
    await relay.stop();
    relay = await startRelay({ port: 0, queueCap: 3, queueCapTotal: 4 });

    const alice = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(alice, { type: 'register', address: addr('alice') });
    await waitFor(() => alice.messages.some(m => m.type === 'registered'));

    // Five distinct topics, one message each → total 5; ceiling 4 → oldest one trimmed.
    send(alice, publishFrame(addr('bob'), 'A', 1));
    send(alice, publishFrame(addr('bob'), 'B', 2));
    send(alice, publishFrame(addr('bob'), 'C', 3));
    send(alice, publishFrame(addr('bob'), 'D', 4));
    send(alice, publishFrame(addr('bob'), 'E', 5));
    await new Promise(r => setTimeout(r, 30));

    const bob = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(bob, { type: 'register', address: addr('bob') });
    await waitFor(() =>
      bob.messages.filter(m => m.type === 'message').length === 4,
    );
    const ns = bob.messages.filter(m => m.type === 'message').map(m => m.envelope.payload.n);
    // The first (oldest) one — topic A's n=1 — should have been trimmed.
    expect(ns).toEqual([2, 3, 4, 5]);

    alice.close(); bob.close();
  });

  it('drain order: chronological across buckets', async () => {
    const alice = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(alice, { type: 'register', address: addr('alice') });
    await waitFor(() => alice.messages.some(m => m.type === 'registered'));

    send(alice, publishFrame(addr('bob'), 'A', 1));
    send(alice, publishFrame(addr('bob'), 'B', 2));
    send(alice, publishFrame(addr('bob'), 'A', 3));
    send(alice, publishFrame(addr('bob'), 'B', 4));
    await new Promise(r => setTimeout(r, 30));

    const bob = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(bob, { type: 'register', address: addr('bob') });
    await waitFor(() =>
      bob.messages.filter(m => m.type === 'message').length === 4,
    );
    const order = bob.messages.filter(m => m.type === 'message').map(m => m.envelope.payload.n);
    expect(order).toEqual([1, 2, 3, 4]);   // arrival order preserved across topics

    alice.close(); bob.close();
  });
});
