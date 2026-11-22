/**
 * The hold queue is BOUNDED (2026-07-30).
 *
 * `pendingHold` had no TTL, no size cap and no eviction. Entries drain only on a presence signal from
 * that identity — which never arrives for a peer that no longer exists. Observed on hardware: five dead
 * peers, three queued messages each, every one of them re-paid on later sends. Being in-memory made a
 * restart look like a fix; it is not a bound.
 *
 * What these tests pin, in the order the queue actually grows:
 *   • a held message that outlives the TTL is dropped — and REPORTED, never silently;
 *   • the per-peer and across-peers caps drop the OLDEST, keeping the newest (the one still awaited);
 *   • an address that fails delivery N times in a row stops being attempted at all, and the caller is
 *     told `{held:false, delivered:false}` — which the fan-out already reads as `not-delivered` and the
 *     chat surfaces as a retryable failure. A message the user believes was sent is never dropped mutely;
 *   • …and a peer that shows any sign of life is reinstated at once.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport } from '@onderling/core';
import { createSecureAgent } from '../src/createSecureAgent.js';

const FAST = { firstSendTimeoutMs: 200, retryDelays: [] };
const HOLD = { ...FAST, guarantee: 'hold-forward' };

/**
 * A transport that claims it can reach anyone (the address-agnostic relay/NKN shape) but never
 * delivers — the exact case an unbounded queue paid for over and over. `puts` counts what actually
 * went on the wire, which is how "attempted" is told apart from "refused without attempting".
 */
class BlackHoleTransport extends InternalTransport {
  constructor(bus, addr) { super(bus, addr); this.puts = 0; }
  canReach() { return true; }
  async _put(to, envelope) { this.puts += 1; return super._put(to, envelope); }
}

async function agent(opts = {}) {
  return createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, ...opts });
}

/** An address nothing is listening on. Held sends to it can never complete. */
const DEAD = 'dead-peer-address-0000000000000000000000000';

describe('hold queue — TTL', () => {
  it('drops a held message that outlived the TTL, and reports the drop', async () => {
    const dropped = [];
    const a = await agent({ holdTtlMs: 1, onHoldDropped: (d) => dropped.push(d) });

    // No transport at all → no live route → the message is held up front.
    const first = await a.peer.sendTo(DEAD, { msgId: 'stale-1', text: 'hoi' }, HOLD);
    expect(first.held).toBe(true);
    expect(a.heldFor(DEAD)).toBe(1);

    await new Promise((r) => setTimeout(r, 5));
    // The sweep is event-driven (no timer): the next enqueue is what expires the old one.
    await a.peer.sendTo(DEAD, { msgId: 'fresh-1', text: 'hoi 2' }, HOLD);

    expect(a.heldFor(DEAD)).toBe(1);                       // only the fresh one remains
    expect(dropped.map((d) => d.msgId)).toEqual(['stale-1']);
    expect(dropped[0].reason).toBe('expired');
    await a.shutdown();
  });

  it('keeps holding within the TTL (the bound must not eat live messages)', async () => {
    const a = await agent({ holdTtlMs: 60_000 });
    await a.peer.sendTo(DEAD, { msgId: 'a' }, HOLD);
    await a.peer.sendTo(DEAD, { msgId: 'b' }, HOLD);
    expect(a.heldFor(DEAD)).toBe(2);
    await a.shutdown();
  });
});

describe('hold queue — size caps', () => {
  it('per peer: keeps the newest, drops the oldest past the cap', async () => {
    const dropped = [];
    const a = await agent({ holdMaxPerPeer: 2, onHoldDropped: (d) => dropped.push(d) });

    for (const msgId of ['m1', 'm2', 'm3']) {
      await a.peer.sendTo(DEAD, { msgId }, HOLD);
    }

    expect(a.heldFor(DEAD)).toBe(2);
    expect(dropped.map((d) => d.msgId)).toEqual(['m1']);
    expect(dropped[0].reason).toBe('queue-full');
    await a.shutdown();
  });

  it('across peers: evicts the least-recently-queued peer entirely', async () => {
    const dropped = [];
    const a = await agent({ holdMaxPeers: 2, onHoldDropped: (d) => dropped.push(d) });

    await a.peer.sendTo('peer-one', { msgId: 'p1' }, HOLD);
    await a.peer.sendTo('peer-two', { msgId: 'p2' }, HOLD);
    await a.peer.sendTo('peer-three', { msgId: 'p3' }, HOLD);

    expect(a.heldFor('peer-one')).toBe(0);      // the oldest queue went
    expect(a.heldFor('peer-two')).toBe(1);
    expect(a.heldFor('peer-three')).toBe(1);
    expect(dropped.map((d) => d.msgId)).toEqual(['p1']);
    expect(dropped[0].reason).toBe('peer-evicted');
    expect(a.holdStats().peers).toBe(2);
    await a.shutdown();
  });
});

describe('hold queue — giving up on a dead address', () => {
  it('stops attempting after N consecutive failures, and says so instead of queueing silently', async () => {
    const a = await agent({ holdMaxDeliveryFailures: 2 });
    // A transport that PASSES the route check and then fails the send — the address-agnostic
    // relay/NKN shape, and the only case that actually costs anything.
    await a.addSecureTransport('relay', new BlackHoleTransport(new InternalBus(), a.identity.pubKey));

    await a.presenceSignal(DEAD);                                  // it answered once, then went silent
    const first = await a.peer.sendTo(DEAD, { msgId: 'g1' }, HOLD);
    expect(first.held, 'the first failure must still hold — a peer may simply be offline').toBe(true);

    const second = await a.peer.sendTo(DEAD, { msgId: 'g2' }, HOLD);
    expect(second.held).toBe(false);
    expect(second.delivered).toBe(false);
    expect(second.reason).toBe('peer-unreachable');

    // …and from here nothing is even attempted: the answer is immediate and honest.
    const third = await a.peer.sendTo(DEAD, { msgId: 'g3' }, HOLD);
    expect(third).toMatchObject({ held: false, delivered: false, reason: 'peer-unreachable', msgId: 'g3' });
    expect(a.holdStats().givenUpOn).toBe(1);
    await a.shutdown();
  }, 15_000);

  it('once given up, a send is refused WITHOUT touching the wire', async () => {
    const a = await agent({ holdMaxDeliveryFailures: 1 });
    const relay = new BlackHoleTransport(new InternalBus(), a.identity.pubKey);
    await a.addSecureTransport('relay', relay);

    await a.presenceSignal(DEAD);                                  // it answered once, then went silent
    await a.peer.sendTo(DEAD, { msgId: 'w1' }, HOLD);              // attempted, fails → given up
    const attemptedPuts = relay.puts;
    expect(attemptedPuts).toBeGreaterThan(0);

    await a.peer.sendTo(DEAD, { msgId: 'w2' }, HOLD);
    expect(relay.puts, 'a written-off address must not cost another handshake').toBe(attemptedPuts);
    await a.shutdown();
  }, 15_000);

  it('presence from a PER-CIRCLE alias reinstates the peer\'s CANONICAL address too', async () => {
    // The one-directional hole found on the A33 (2026-09-02): circle members' presence arrives from
    // their per-circle address, sends target their canonical one. `addressesOfIdentity(alias)` used to
    // collect the OTHER aliases and omit the canonical — so a peer could talk to you all day from a
    // circle and stay written off for direct sends, and holds queued under the canonical never flushed.
    const a = await agent({ holdMaxDeliveryFailures: 1 });
    const relay = new BlackHoleTransport(new InternalBus(), a.identity.pubKey);
    await a.addSecureTransport('relay', relay);

    const CANONICAL = 'canonical-peer-key-000000000000000000000000';
    const ALIAS = 'their-circle-address-00000000000000000000000';
    a.registerPeerAddress(ALIAS, CANONICAL);

    await a.presenceSignal(CANONICAL);                             // it answered once, then went silent
    await a.peer.sendTo(CANONICAL, { msgId: 'c1' }, HOLD);         // fails once → written off
    expect(a.holdStats().givenUpOn).toBe(1);

    await a.presenceSignal(ALIAS);                                 // they speak — from their circle address
    expect(a.holdStats().givenUpOn, 'the canonical is reinstated by alias presence').toBe(0);
    await a.shutdown();
  }, 15_000);

  it('a presence signal reinstates a peer we had given up on', async () => {
    const a = await agent({ holdMaxDeliveryFailures: 1 });
    const relay = new BlackHoleTransport(new InternalBus(), a.identity.pubKey);
    await a.addSecureTransport('relay', relay);

    await a.presenceSignal(DEAD);                                  // it answered once, then went silent
    await a.peer.sendTo(DEAD, { msgId: 'r1' }, HOLD);              // fails once → given up
    expect(a.holdStats().givenUpOn).toBe(1);
    const before = relay.puts;

    await a.presenceSignal(DEAD);                                  // they are back
    expect(a.holdStats().givenUpOn).toBe(0);

    // Tried again FOR REAL — it fails again (nobody is really there), but it was attempted, and that
    // is the property: giving up is a suspension on current evidence, never a permanent verdict.
    await a.peer.sendTo(DEAD, { msgId: 'r2' }, HOLD);
    expect(relay.puts).toBeGreaterThan(before);
    await a.shutdown();
  }, 15_000);
});

describe('hold queue — an address never seen alive is "not yet", not dead', () => {
  // A newcomer's fresh per-circle address collected three timeouts (the join's broadcast, the create statement
  // re-told, a key event) before it was even registered, was written off, and a later send was refused
  // 'peer-unreachable', not even held. An address with no sign of life yet has given no evidence that it is DEAD.
  it('sends to an address that never answered inside the interval: ONE wire attempt, every send held, none refused', async () => {
    const a = await agent({ holdMaxDeliveryFailures: 2, notYetAttemptIntervalMs: 60_000 });
    const relay = new BlackHoleTransport(new InternalBus(), a.identity.pubKey);
    await a.addSecureTransport('relay', relay);
    const NEW = 'newcomer-circle-address-000000000000000000000';
    await a.peer.sendTo(NEW, { msgId: 'n1' }, HOLD);
    const oneAttempt = relay.puts;
    expect(oneAttempt).toBeGreaterThan(0);
    for (const id of ['n2', 'n3', 'n4', 'n5']) {
      const r = await a.peer.sendTo(NEW, { msgId: id }, HOLD);
      expect(r.held, `${id} held, not refused`).toBe(true);
    }
    expect(relay.puts, 'no wire attempt between attempts').toBe(oneAttempt);
    expect(a.holdStats().givenUpOn).toBe(0);
    await a.shutdown();
  }, 15_000);

  it('after the interval, one more attempt', async () => {
    const a = await agent({ holdMaxDeliveryFailures: 2, notYetAttemptIntervalMs: 50 });
    const relay = new BlackHoleTransport(new InternalBus(), a.identity.pubKey);
    await a.addSecureTransport('relay', relay);
    const NEW = 'newcomer-circle-address-222222222222222222222';
    await a.peer.sendTo(NEW, { msgId: 'i1' }, HOLD);
    const oneAttempt = relay.puts;
    await new Promise((r) => { setTimeout(r, 80); });
    const r = await a.peer.sendTo(NEW, { msgId: 'i2' }, HOLD);
    expect(r.held).toBe(true);
    expect(relay.puts, 'the interval passed: attempted again').toBeGreaterThan(oneAttempt);
    await a.shutdown();
  }, 15_000);

  it('a presence signal drains everything held for it: a receiver who was never seen alive gets all four, in order', async () => {
    const { startRelay } = await import('@onderling/relay');
    const R = await startRelay({ port: 0, log: false });
    const url = `ws://127.0.0.1:${R.port}`;
    const got = [];
    const anna = await agent({ holdMaxDeliveryFailures: 3, notYetAttemptIntervalMs: 60_000, relayReadyTimeoutMs: 3000 });
    const bram = await agent({ relayReadyTimeoutMs: 3000, onPeerMessage: (m) => got.push(m?.payload?.msgId ?? m?.msgId) });
    try {
      await anna.relay.connect({ relayUrl: url, awaitReady: true }); anna.setTransportMode('relay');
      const SEND = { firstSendTimeoutMs: 400, retryDelays: [], guarantee: 'hold-forward' };
      for (const id of ['p1', 'p2', 'p3', 'p4']) expect((await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'note', msgId: id }, SEND)).held).toBe(true);
      expect(anna.heldFor(bram.identity.pubKey)).toBe(4);
      await bram.relay.connect({ relayUrl: url, awaitReady: true }); bram.setTransportMode('relay');
      await anna.presenceSignal(bram.identity.pubKey);      // they are here: none stays parked behind the interval
      const t = Date.now(); while (Date.now() - t < 8000 && got.filter((x) => String(x).startsWith('p')).length < 4) await new Promise((r) => { setTimeout(r, 25); });
      expect(got.filter((x) => String(x).startsWith('p'))).toEqual(['p1', 'p2', 'p3', 'p4']);
      expect(anna.heldFor(bram.identity.pubKey)).toBe(0);
    } finally { await anna.shutdown(); await bram.shutdown(); await R.close?.(); }
  }, 60_000);

  it('a restored device with a roster of K never-seen addresses: its first boot\'s sends cost K wire attempts, not one per send', async () => {
    const K = 6, SENDS = 4;
    const a = await agent({ holdMaxDeliveryFailures: 3, notYetAttemptIntervalMs: 60_000 });
    const relay = new BlackHoleTransport(new InternalBus(), a.identity.pubKey);
    await a.addSecureTransport('relay', relay);
    const probe = 'probe-address-measuring-one-attempt-000000000';
    await a.peer.sendTo(probe, { msgId: 'probe' }, HOLD);
    const perAttempt = relay.puts;
    relay.puts = 0;
    const roster = Array.from({ length: K }, (_, i) => `roster-address-never-seen-${String(i).padStart(20, '0')}`);
    for (let n = 0; n < SENDS; n++) for (const addr of roster) await a.peer.sendTo(addr, { msgId: `${addr}-${n}` }, HOLD);
    expect(relay.puts, `K=${K} addresses x ${SENDS} sends`).toBe(K * perAttempt);
    expect(a.holdStats().givenUpOn).toBe(0);
    await a.shutdown();
  }, 30_000);

  it('once it has answered, its failures count again', async () => {
    const a = await agent({ holdMaxDeliveryFailures: 2 });
    await a.addSecureTransport('relay', new BlackHoleTransport(new InternalBus(), a.identity.pubKey));
    const NEW = 'newcomer-circle-address-111111111111111111111';
    await a.peer.sendTo(NEW, { msgId: 'm1' }, HOLD);              // not yet: held, not counted
    await a.presenceSignal(NEW);                                   // it answers (the held m1 is retried, fails: count 1)
    const r = await a.peer.sendTo(NEW, { msgId: 'm2' }, HOLD);     // count 2: written off
    expect(r).toMatchObject({ held: false, delivered: false, reason: 'peer-unreachable' });
    await a.shutdown();
  }, 15_000);
});

describe('hold queue — the bounds are visible', () => {
  it('holdStats reports what is held and the limits it is held to', async () => {
    const a = await agent({ holdTtlMs: 1234, holdMaxPerPeer: 7, holdMaxPeers: 8, holdMaxDeliveryFailures: 9 });
    await a.peer.sendTo(DEAD, { msgId: 's1' }, HOLD);
    expect(a.holdStats()).toMatchObject({
      peers: 1,
      messages: 1,
      limits: { ttlMs: 1234, maxPerPeer: 7, maxPeers: 8, maxDeliveryFailures: 9 },
    });
    await a.shutdown();
  });
});

describe('hold queue — receipt-keyed removal (removeHeld)', () => {
  it('removes exactly the confirmed message for exactly that peer — nothing else, and no drop report', async () => {
    const dropped = [];
    const a = await agent({ onHoldDropped: (d) => dropped.push(d) });
    const OTHER = 'other-peer-address-0000000000000000000000000';

    await a.peer.sendTo(DEAD, { msgId: 'm-1', text: 'one' }, HOLD);
    await a.peer.sendTo(DEAD, { msgId: 'm-2', text: 'two' }, HOLD);
    await a.peer.sendTo(OTHER, { msgId: 'm-1', text: 'one (their copy)' }, HOLD);
    expect(a.heldFor(DEAD)).toBe(2);
    expect(a.heldFor(OTHER)).toBe(1);

    // The peer's app-level receipt for m-1 arrived — their held copy is obsolete.
    expect(a.removeHeld({ addr: DEAD, msgId: 'm-1' })).toBe(1);

    expect(a.heldFor(DEAD), 'only the confirmed message left the queue').toBe(1);
    expect(a.heldFor(OTHER), "another peer's copy of the same msgId is UNTOUCHED — receipts are per-peer").toBe(1);
    expect(dropped, 'a positive removal is not a drop, so nothing is reported').toEqual([]);

    // Unknown message / malformed args → 0, never a throw.
    expect(a.removeHeld({ addr: DEAD, msgId: 'no-such' })).toBe(0);
    expect(a.removeHeld({})).toBe(0);
    await a.shutdown();
  });
});

describe("the record of addresses seen alive is bounded", () => {
  it('keeps the most recent signs of life; the oldest goes past the cap (persisted with the holds)', async () => {
    const bytes = new Map();
    const holdStore = { async read(uri) { return bytes.get(uri) ?? null; }, async write(uri, body) { bytes.set(uri, String(body)); } };
    const a = await agent({ seenAliveMax: 2, holdStore });
    for (const addr of ['alive-a', 'alive-b', 'alive-c']) await a.presenceSignal(addr);
    await a.presenceSignal('alive-b');                     // a newer sign of life moves it to the young end
    await a.presenceSignal('alive-d');
    await a.outboxFlushed();
    const alive = JSON.parse([...bytes.values()].pop()).alive;
    expect(alive).toEqual(['alive-b', 'alive-d']);
    await a.shutdown();
  });
});

/**
 * THE ALPHA SIZE FITS IN THE OUTBOX (ledger L1103, the seeded Samsung 2026-11-22): five circles of fifteen members are
 * ~75 addresses (one per circle each), above the old cap of 64 queues. A start that holds for every absent member
 * then evicted whole queues, and the boot re-fan held their lines again, evicting others: ~1350 holds and ~90 evicted
 * queues in a start's first 40 s, every one a write of the outbox. The default cap now holds the alpha size with room.
 */
describe('hold queue — the default holds the alpha size', () => {
  it('80 absent members (5 circles x 16) each keep their held line; no queue is evicted', async () => {
    const { createSecureAgent: make } = await import('../src/createSecureAgent.js');
    const { VaultMemory: V } = await import('@onderling/vault');
    const dropped = [];
    const a = await make({ vault: new V(), warnOnInsecure: false, onHoldDropped: (e) => dropped.push(e) });
    for (let i = 0; i < 80; i += 1) {
      await a.peer.sendTo(`absent-member-${String(i).padStart(3, '0')}-0000000000000000000000`, { msgId: `m-${i}`, text: 'x' }, { firstSendTimeoutMs: 50, retryDelays: [], guarantee: 'hold-forward' });
    }
    let held = 0;
    for (let i = 0; i < 80; i += 1) held += a.heldFor(`absent-member-${String(i).padStart(3, '0')}-0000000000000000000000`);
    expect(held).toBe(80);
    await a.shutdown();
  }, 60_000);
});
