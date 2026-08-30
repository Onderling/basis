/**
 * THE DURABLE OUTBOX — a held message must survive the restart that loses it.
 *
 * The hold queue exists for exactly one promise: "you are offline, I will keep this and send it
 * when you are back". Until now that promise was kept in process memory, so the single most likely
 * event on a phone — the app being killed — silently broke it, and the sender had already told the
 * user the message was on its way. These pins are the promise made durable:
 *   1. a held message is written to the store as soon as it is held;
 *   2. a fresh agent on the same store starts with it still held;
 *   3. delivering it removes it from the DURABLE copy, not only from memory — so the next boot
 *      does not resend what already arrived;
 *   4. an entry that outlived the TTL is dropped on the way back in, and reported, exactly as the
 *      live sweep does — a restart must not resurrect what had already expired.
 */
import { describe, it, expect } from 'vitest';
import { createSecureAgent } from '../src/createSecureAgent.js';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

/** A DataSource-shaped store whose bytes the test can inspect. */
function memoryStore(map = new Map()) {
  return {
    map,
    async read(uri) { return map.has(uri) ? map.get(uri) : null; },
    async write(uri, body) { map.set(uri, String(body)); },
  };
}

const URI = 'mem://secure-agent/outbox.json';
const PEER = 'peer-that-is-not-there';

async function bootAgent(store) {
  const identity = await AgentIdentity.generate(new VaultMemory());
  const agent = await createSecureAgent({
    identity,
    holdStore: store,
    holdStoreUri: URI,
    // No transport is registered, so nothing can reach the peer — every send holds, which is
    // precisely the state this test is about.
  });
  await agent.outboxRestored();
  return agent;
}

describe('the durable outbox', () => {
  it('holds to the store, restores on a fresh agent, and forgets what was delivered', async () => {
    const store = memoryStore();

    // 1 — hold a message. It is written as soon as it is held.
    const A = await bootAgent(store);
    const res = await A.peer.sendTo(PEER, { msgId: 'm-1', text: 'blijf bewaard' }, { guarantee: 'hold-forward' });
    expect(res.held, `expected the send to be held, got ${JSON.stringify(res)}`).toBe(true);
    expect(A.heldFor(PEER)).toBe(1);
    await A.outboxFlushed();
    expect(store.map.has(URI), 'nothing was written to the outbox').toBe(true);
    expect(store.map.get(URI)).toContain('m-1');

    // 2 — THE RESTART. A brand-new agent over the same store still holds it.
    const B = await bootAgent(store);
    expect(B.heldFor(PEER), 'the held message did not survive the restart').toBe(1);

    // 3 — a second hold for the same peer accumulates durably too.
    await B.peer.sendTo(PEER, { msgId: 'm-2', text: 'ook bewaard' }, { guarantee: 'hold-forward' });
    await B.outboxFlushed();
    const C = await bootAgent(store);
    expect(C.heldFor(PEER)).toBe(2);
    expect(store.map.get(URI)).toContain('m-2');
  }, 30_000);

  it('drops what expired while the process was down, and says so', async () => {
    const store = memoryStore();
    const A = await bootAgent(store);
    await A.peer.sendTo(PEER, { msgId: 'm-old', text: 'te oud' }, { guarantee: 'hold-forward' });
    await A.outboxFlushed();

    // Age the stored entry past any sane TTL, the way a week on the shelf would.
    const parsed = JSON.parse(store.map.get(URI));
    parsed.peers[0][1][0][1].ts = Date.now() - 40 * 24 * 60 * 60 * 1000;
    store.map.set(URI, JSON.stringify(parsed));

    const dropped = [];
    const identity = await AgentIdentity.generate(new VaultMemory());
    const B = await createSecureAgent({
      identity, holdStore: store, holdStoreUri: URI,
      onHoldDropped: (d) => dropped.push(d),
    });
    await B.outboxRestored();

    expect(B.heldFor(PEER), 'an expired message came back from the dead').toBe(0);
    expect(dropped.map((d) => d.reason)).toContain('expired');
    expect(dropped.map((d) => d.msgId)).toContain('m-old');
  }, 30_000);

  it('without a store it behaves exactly as before — memory only, nothing written', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const agent = await createSecureAgent({ identity });
    const res = await agent.peer.sendTo(PEER, { msgId: 'm-x' }, { guarantee: 'hold-forward' });
    expect(res.held).toBe(true);
    expect(agent.heldFor(PEER)).toBe(1);
    await expect(agent.outboxRestored()).resolves.toBe(0);
  }, 30_000);
});

describe('the dead-address verdict survives a restart (bounded)', () => {
  it('an address written off before the restart is not attempted again after it — until presence or the TTL', async () => {
    const store = memoryStore();
    const { InternalBus, InternalTransport } = await import('@onderling/core');
    class BlackHole extends InternalTransport {
      constructor(bus, addr) { super(bus, addr); this.puts = 0; }
      canReach() { return true; }
      async _put(to, env) { this.puts += 1; return super._put(to, env); }
    }
    const boot = async (extra = {}) => {
      const identity = await AgentIdentity.generate(new VaultMemory());
      const a = await createSecureAgent({ identity, holdStore: store, holdStoreUri: URI, holdMaxDeliveryFailures: 1, ...extra });
      const tx = new BlackHole(new InternalBus(), a.identity.pubKey);
      await a.addSecureTransport('relay', tx);
      await a.outboxRestored;
      return { a, tx };
    };
    const FAST = { firstSendTimeoutMs: 100, retryDelays: [], guarantee: 'hold-forward' };
    const first = await boot();
    await first.a.peer.sendTo(PEER, { msgId: 'm1' }, FAST);       // fails once → written off (max 1)
    expect(first.tx.puts).toBeGreaterThan(0);
    await first.a.shutdown();
    expect(JSON.parse(store.map.get(URI)).dead.map(([addr]) => addr)).toEqual([PEER]);

    const second = await boot();
    const r = await second.a.peer.sendTo(PEER, { msgId: 'm2' }, FAST);
    expect(second.tx.puts, 'a written-off address must not cost a handshake after a restart').toBe(0);
    expect(r).toMatchObject({ held: false, delivered: false });
    await second.a.shutdown();

    const third = await boot({ holdDeadTtlMs: 1 });               // the verdict has expired
    await third.a.peer.sendTo(PEER, { msgId: 'm3' }, FAST);
    expect(third.tx.puts).toBeGreaterThan(0);
    await third.a.shutdown();
  });
});
