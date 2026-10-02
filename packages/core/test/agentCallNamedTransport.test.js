/**
 * `agent.call(peer, skill, parts, {transport})` carries the call over the transport it names. It used to put the
 * override on a spread COPY of the agent (where the call never reads it, and where the agent's own prototype getters
 * are lost), so a named transport was ignored.
 */
import { describe, it, expect } from 'vitest';
import { Agent } from '../src/Agent.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { TextPart, Parts } from '../src/Parts.js';

describe('a call over the transport it names', () => {
  it('the named transport carries it: the peer is reachable only on that road', async () => {
    const busA = new InternalBus(); const busB = new InternalBus();
    const idA = await AgentIdentity.generate(new VaultMemory()); const idB = await AgentIdentity.generate(new VaultMemory());
    const alice = new Agent({ identity: idA, transport: new InternalTransport(busA, idA.pubKey) });
    alice.addTransport('second', new InternalTransport(busB, idA.pubKey));
    const bob = new Agent({ identity: idB, transport: new InternalTransport(busB, idB.pubKey) });   // only on the second road
    alice.addPeer(bob.address, bob.pubKey); bob.addPeer(alice.address, alice.pubKey);
    await alice.start(); await bob.start();
    bob.register('echo', async ({ parts }) => parts, { visibility: 'public' });
    const r = await alice.call(bob.address, 'echo', [TextPart('hi')], { transport: 'second', timeout: 3000 }).done();
    expect(Parts.text(r.parts)).toBe('hi');
    await alice.stop(); await bob.stop();
  });
});
