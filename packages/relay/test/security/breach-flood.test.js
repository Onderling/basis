/**
 * J-SECURITY BREACH SUITE — flood / storage abuse against the relay.
 * PLAN-real-usage-and-deployment.md §7 ("flood/storage abuse").
 *
 * Threat: a peer floods the relay with messages / connections to exhaust
 * memory or starve other users.
 *
 * DEFENDED (green):
 *   • The offline queue is BOUNDED. A peer spamming an offline target is
 *     capped per-(addr,topic) bucket (queueCap, FIFO eviction) AND per-address
 *     (queueCapTotal, default 4×) — no unbounded memory growth. Asserted via
 *     many-distinct-topic flooding hitting the global ceiling.
 *   • A single connection cannot register unbounded addresses: over
 *     `maxAddressesPerConnection` → TOO_MANY_ADDRESSES (frame refused, socket
 *     kept). `register` is not rate-limited, so this is the only bound on a
 *     connection's routing-table footprint. Circle-blind by construction.
 *   • When the relay runs in GROUP mode (`acceptedGroups` + quotas), a member's
 *     traffic is capped: over `msgsPerDay` → OVER_QUOTA_MSGS_PER_DAY.
 *     (The per-group CONNECTION quota — `maxConnections` → OVER_QUOTA_CONNECTIONS
 *     — was removed 2026-07-31: it required the relay to know which circle a
 *     socket belonged to, which is knowledge it must not hold
 *     (`plans/DESIGN-boundary-authentication.md` §2), and it was inert in open
 *     mode anyway. Replaced by the per-connection cap above.)
 *   • In OPEN mode (the default — no `acceptedGroups`), a DEFAULT per-connection
 *     message rate limit (token bucket over `send` — the only data-plane frame
 *     since `group-publish` was removed 2026-07-31, so a broadcast to a circle
 *     of N now costs N tokens rather than one) caps a
 *     peer flooding a LIVE peer: over-burst frames are rejected with OVER_RATE
 *     (socket stays open). Closes the former open-mode flood gap. Configurable
 *     via `startRelay({ messageRateLimit: { perSec, burst } })`; `false` disables.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { startRelay } from '../../src/server.js';
// Registration is challenge-first (Decision 3) — even the attacker has to hold the key for every
// address it registers, which is why the sybil below mints 50 real ones.
import { openClient, send, addr } from '../helpers/provenClient.js';
async function waitFor(pred, timeoutMs = 1_500) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timeout');
    await new Promise(r => setTimeout(r, 5));
  }
}
const publishFrame = (to, topic, n) => ({ type: 'send', to, topic, envelope: { _p: 'OW', _topic: topic, payload: { n } } });

let relay;
afterEach(async () => { await relay?.stop(); relay = null; });

describe('§7.10 — bounded offline queue (memory-exhaustion defence)', () => {
  it('DEFENDED: per-address global ceiling (queueCapTotal) caps a many-topic flood', async () => {
    // queueCap=2 → queueCapTotal = 2*4 = 8. Flood 30 distinct topics at an
    // offline peer; total buffered must not exceed the global ceiling.
    relay = await startRelay({ port: 0, queueCap: 2 });
    const attacker = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(attacker, { type: 'register', address: addr('attacker') });
    await waitFor(() => attacker.messages.some(m => m.type === 'registered'));

    // victim is OFFLINE — everything buffers.
    for (let t = 0; t < 30; t++) send(attacker, publishFrame(addr('victim'), `topic-${t}`, t));
    await new Promise(r => setTimeout(r, 50));

    const victim = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(victim, { type: 'register', address: addr('victim') });
    await new Promise(r => setTimeout(r, 100));

    const delivered = victim.messages.filter(m => m.type === 'message').length;
    // The bound is queueCapTotal (8) — NOT the 30 sent. Proves buffering is capped.
    expect(delivered).toBeLessThanOrEqual(8);
    attacker.close(); victim.close();
  });
});

describe('§7.10 — DEFENDED: a connection cannot register unbounded addresses', () => {
  it('caps the routing-table footprint of ONE socket (TOO_MANY_ADDRESSES)', async () => {
    // `register` is deliberately outside the message rate limiter (the token bucket covers the data
    // plane only), so without this cap one socket could grow `clients` without bound. Open mode — the
    // cap asks nothing about circles, which is the point: the per-group quota it replaces did nothing
    // here at all.
    relay = await startRelay({ port: 0, maxAddressesPerConnection: 3 });
    const attacker = await openClient(`ws://127.0.0.1:${relay.port}`);
    for (let n = 0; n < 50; n++) send(attacker, { type: 'register', address: addr(`sybil-${n}`) });
    await waitFor(() => attacker.messages.some(m => m.type === 'error' && m.message === 'TOO_MANY_ADDRESSES'));
    // Registration is challenge-first (Decision 3), so the three that DO get in land a round-trip
    // after the refusal of the fourth. Wait for them, then let the rest of the blast play out — the
    // assertion is that the number stops at the cap, not that it is small at one instant.
    await waitFor(() => attacker.messages.filter(m => m.type === 'registered').length === 3);
    await new Promise(r => setTimeout(r, 100));

    expect(attacker.messages.filter(m => m.type === 'registered')).toHaveLength(3);
    // Signalled, not silently dropped — and the socket stays open, as with every other data-plane refusal.
    expect(attacker.messages.filter(m => m.type === 'error' && m.message === 'TOO_MANY_ADDRESSES').length)
      .toBeGreaterThan(0);
    expect(attacker.readyState).toBe(1);
    attacker.close();
  });
});

describe('§7.10 — DEFENDED: open-mode per-connection message rate limit', () => {
  it('throttles a single peer flooding a LIVE peer past the burst (OVER_RATE)', async () => {
    // DEFAULT open mode (no acceptedGroups). A small bucket makes the flood
    // deterministic: burst=10 → at most ~10 delivered instantly, the rest
    // rejected with OVER_RATE. (perSec kept low so refill during the blast
    // is negligible.)
    relay = await startRelay({ port: 0, messageRateLimit: { perSec: 5, burst: 10 } });
    const attacker = await openClient(`ws://127.0.0.1:${relay.port}`);
    const victim   = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(attacker, { type: 'register', address: addr('attacker') });
    send(victim,   { type: 'register', address: addr('victim') });
    await waitFor(() => attacker.messages.some(m => m.type === 'registered')
                     && victim.messages.some(m => m.type === 'registered'));

    const BLAST = 200;
    for (let n = 0; n < BLAST; n++) send(attacker, { type: 'send', to: addr('victim'), envelope: { _p: 'OW', payload: { n } } });
    // Wait until the attacker has been told OVER_RATE (proves throttling).
    await waitFor(() => attacker.messages.some(m => m.type === 'error' && m.message === 'OVER_RATE'), 3_000);

    const delivered      = victim.messages.filter(m => m.type === 'message').length;
    const overRate       = attacker.messages.filter(m => m.type === 'error' && m.message === 'OVER_RATE');
    // The flood is capped near the burst, NOT the 200 sent, and the attacker
    // is explicitly signalled (not silently dropped).
    expect(delivered).toBeLessThan(BLAST);
    expect(delivered).toBeLessThanOrEqual(20);       // burst(10) + tiny refill headroom
    expect(overRate.length).toBeGreaterThan(0);
    attacker.close(); victim.close();
  });

  it('does NOT affect normal traffic — a few messages pass with zero OVER_RATE', async () => {
    // Default rate limit (perSec 30 / burst 60). Normal interactive volume.
    relay = await startRelay({ port: 0 });
    const sender   = await openClient(`ws://127.0.0.1:${relay.port}`);
    const receiver = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(sender,   { type: 'register', address: addr('sender') });
    send(receiver, { type: 'register', address: addr('receiver') });
    await waitFor(() => sender.messages.some(m => m.type === 'registered')
                     && receiver.messages.some(m => m.type === 'registered'));

    const NORMAL = 5;
    for (let n = 0; n < NORMAL; n++) send(sender, { type: 'send', to: addr('receiver'), envelope: { _p: 'OW', payload: { n } } });
    await waitFor(() => receiver.messages.filter(m => m.type === 'message').length >= NORMAL, 1_500);

    expect(receiver.messages.filter(m => m.type === 'message')).toHaveLength(NORMAL);
    expect(sender.messages.filter(m => m.type === 'error')).toHaveLength(0);
    sender.close(); receiver.close();
  });

  it('messageRateLimit:false restores the unthrottled legacy behaviour', async () => {
    relay = await startRelay({ port: 0, messageRateLimit: false });
    const attacker = await openClient(`ws://127.0.0.1:${relay.port}`);
    const victim   = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(attacker, { type: 'register', address: addr('attacker') });
    send(victim,   { type: 'register', address: addr('victim') });
    await waitFor(() => attacker.messages.some(m => m.type === 'registered')
                     && victim.messages.some(m => m.type === 'registered'));

    const BLAST = 200;
    for (let n = 0; n < BLAST; n++) send(attacker, { type: 'send', to: addr('victim'), envelope: { _p: 'OW', payload: { n } } });
    await waitFor(() => victim.messages.filter(m => m.type === 'message').length >= BLAST, 3_000);

    expect(victim.messages.filter(m => m.type === 'message')).toHaveLength(BLAST);
    expect(attacker.messages.filter(m => m.type === 'error')).toHaveLength(0);
    attacker.close(); victim.close();
  });
});
