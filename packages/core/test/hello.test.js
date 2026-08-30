import { describe, it, expect } from 'vitest';
import { Agent }                      from '../src/Agent.js';
import { AgentIdentity }              from '../src/identity/AgentIdentity.js';
import { VaultMemory }                from '@onderling/vault';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';

async function makeAgent(bus) {
  const id = await AgentIdentity.generate(new VaultMemory());
  return new Agent({ identity: id, transport: new InternalTransport(bus, id.pubKey) });
}

describe('hello handshake', () => {
  it('sendHello registers both peers without addPeer()', async () => {
    const bus   = new InternalBus();
    const alice = await makeAgent(bus);
    const bob   = await makeAgent(bus);

    await alice.start();
    await bob.start();

    // Neither side has the other registered yet.
    expect(alice.security.getPeerKey(bob.address)).toBeNull();
    expect(bob.security.getPeerKey(alice.address)).toBeNull();

    await alice.hello(bob.address);

    // Both sides should now have each other registered.
    expect(alice.security.getPeerKey(bob.address)).toBe(bob.pubKey);
    expect(bob.security.getPeerKey(alice.address)).toBe(alice.pubKey);
  });

  it('emits peer event on both sides', async () => {
    const bus   = new InternalBus();
    const alice = await makeAgent(bus);
    const bob   = await makeAgent(bus);

    await alice.start();
    await bob.start();

    const alicePeers = [];
    const bobPeers   = [];
    alice.on('peer', e => alicePeers.push(e));
    bob.on('peer',   e => bobPeers.push(e));

    await alice.hello(bob.address);

    expect(bobPeers.length).toBeGreaterThanOrEqual(1);
    expect(bobPeers[0].address).toBe(alice.address);
    expect(alicePeers.length).toBeGreaterThanOrEqual(1);
    expect(alicePeers[0].address).toBe(bob.address);
  });

  it('is idempotent — second hello is a no-op', async () => {
    const bus   = new InternalBus();
    const alice = await makeAgent(bus);
    const bob   = await makeAgent(bus);

    await alice.start();
    await bob.start();

    await alice.hello(bob.address);
    const key1 = alice.security.getPeerKey(bob.address);
    await alice.hello(bob.address);  // should be instant no-op
    expect(alice.security.getPeerKey(bob.address)).toBe(key1);
  });

  it('can call skills right after hello', async () => {
    const bus   = new InternalBus();
    const alice = await makeAgent(bus);
    const bob   = await makeAgent(bus);

    bob.register('echo', async ({ parts }) => parts);

    await alice.start();
    await bob.start();

    await alice.hello(bob.address);
    const task   = alice.call(bob.address, 'echo', 'hello world');
    const result = await task.done();

    expect(result.state).toBe('completed');
    const { Parts } = await import('../src/Parts.js');
    expect(Parts.text(result.parts)).toBe('hello world');
  });
});

describe('the ack names what it answers', () => {
  it('the responder\'s ack HI carries `_re` = the id of the HI it answers', async () => {
    // A peer that reciprocates every HI it cannot tie to one of its own (the secure agent) would otherwise
    // answer the ack with a fresh HI, which we would ack again — a hello storm at round-trip cadence.
    const bus = new InternalBus();
    class Capturing extends InternalTransport {
      constructor(...a) { super(...a); this.puts = []; }
      async _put(to, env) { this.puts.push(env); return super._put(to, env); }
    }
    const idA = await AgentIdentity.generate(new VaultMemory());
    const idB = await AgentIdentity.generate(new VaultMemory());
    const txA = new Capturing(bus, idA.pubKey);
    const txB = new Capturing(bus, idB.pubKey);
    const a = new Agent({ identity: idA, transport: txA });
    const b = new Agent({ identity: idB, transport: txB });
    await a.start(); await b.start();
    await a.hello(idB.pubKey);
    const firstHi = txA.puts.find((e) => e._p === 'HI');
    const ack = txB.puts.find((e) => e._p === 'HI');
    expect(ack.payload.ack).toBe(true);
    expect(ack._re).toBe(firstHi._id);
    await a.stop(); await b.stop();
  });
});
