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

    await a.peer.sendTo(DEAD, { msgId: 'w1' }, HOLD);              // attempted, fails → given up
    const attemptedPuts = relay.puts;
    expect(attemptedPuts).toBeGreaterThan(0);

    await a.peer.sendTo(DEAD, { msgId: 'w2' }, HOLD);
    expect(relay.puts, 'a written-off address must not cost another handshake').toBe(attemptedPuts);
    await a.shutdown();
  }, 15_000);

  it('a presence signal reinstates a peer we had given up on', async () => {
    const a = await agent({ holdMaxDeliveryFailures: 1 });
    const relay = new BlackHoleTransport(new InternalBus(), a.identity.pubKey);
    await a.addSecureTransport('relay', relay);

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
