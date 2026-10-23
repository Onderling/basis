/**
 * Adopting an in-process peer: two agents in ONE process, on ONE InternalBus, learn each other's key from the objects
 * themselves instead of a sealed hello.
 *
 * A hello between two agents in one process proves nothing (anything that can call the method holds both objects
 * already), and it cost a phone ~0.9 s of boot for the chat agent's five in-process agents. The adoption refuses
 * anything that is not provably in-process — a transport that is not an InternalTransport, a different bus, an address
 * not connected on the bus, an identity whose key is not the transport's address — and changes nothing else: the
 * gate and the fast path run exactly as after a hello, and an adopted peer is never handed to sibling devices
 * (`peerBindings`), since its key is this process's own business.
 */
import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../src/Agent.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { Transport } from '../src/transport/Transport.js';
import { TextPart, Parts } from '../src/Parts.js';

async function agentOn(bus) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const agent = new Agent({ identity: id, transport: new InternalTransport(bus, id.pubKey, { identity: id }) });
  await agent.start();
  return { agent, id };
}

const adopt = (from, to, toId) => from.security.adoptInProcessPeer(from.transport, to.transport, toId);

describe('SecurityLayer.adoptInProcessPeer', () => {
  it('two agents on one bus: adopted both ways, a call is answered with no hello sent', async () => {
    const bus = new InternalBus();
    const { agent: alice, id: aliceId } = await agentOn(bus);
    const { agent: bob, id: bobId } = await agentOn(bus);
    bob.register('greet', async ({ parts }) => [TextPart(`hi ${Parts.text(parts) ?? ''}`)], { visibility: 'public' });

    const helloSpy = vi.spyOn(alice.transport, 'sendHello');
    expect(adopt(alice, bob, bobId)).toBe('established');
    expect(adopt(bob, alice, aliceId)).toBe('established');
    expect(alice.security.getPeerKey(bob.address)).toBe(bobId.pubKey);

    expect(Parts.text(await alice.invoke(bob.address, 'greet', [TextPart('bob')]))).toBe('hi bob');
    expect(helloSpy).not.toHaveBeenCalled();
  });

  it('an adopted peer is still gated: the receiver\'s policy runs on its call and its refusal stands', async () => {
    const bus = new InternalBus();
    const { agent: alice } = await agentOn(bus);
    const { agent: bob, id: bobId } = await agentOn(bus);
    bob.register('secret', async () => [TextPart('reached')], { visibility: 'public' });
    const checkInbound = vi.fn(async () => { throw new Error('not for you'); });
    Object.defineProperty(bob, 'policyEngine', { get: () => ({ checkInbound }), configurable: true });
    adopt(alice, bob, bobId);
    await expect(alice.invoke(bob.address, 'secret', [])).rejects.toThrow(/not for you/);
    expect(checkInbound).toHaveBeenCalledTimes(1);
  });

  it('refuses an address that is not an InternalTransport peer on the same bus', async () => {
    const bus = new InternalBus();
    const { agent: alice } = await agentOn(bus);
    const { agent: elsewhere, id: elsewhereId } = await agentOn(new InternalBus());   // another bus
    expect(adopt(alice, elsewhere, elsewhereId)).toBe('refused');

    const wireId = await AgentIdentity.generate(new VaultMemory());
    const wire = new Transport({ address: wireId.pubKey });                          // not in-process
    expect(alice.security.adoptInProcessPeer(alice.transport, wire, wireId)).toBe('refused');

    const lonely = new InternalTransport(bus, wireId.pubKey);                          // never connected on the bus
    expect(alice.security.adoptInProcessPeer(alice.transport, lonely, wireId)).toBe('refused');

    expect(alice.security.getPeerKey(elsewhere.address)).toBe(null);
    expect(alice.security.getPeerKey(wireId.pubKey)).toBe(null);
  });

  it('refuses an identity whose key is not the peer transport\'s address, and a key handed in as a string', async () => {
    const bus = new InternalBus();
    const { agent: alice } = await agentOn(bus);
    const { agent: bob, id: bobId } = await agentOn(bus);
    const other = await AgentIdentity.generate(new VaultMemory());
    expect(alice.security.adoptInProcessPeer(alice.transport, bob.transport, other)).toBe('refused');
    expect(alice.security.adoptInProcessPeer(alice.transport, bob.transport, bobId.pubKey)).toBe('refused');
    expect(alice.security.getPeerKey(bob.address)).toBe(null);
  });

  it('an adopted peer is never handed to sibling devices', async () => {
    const bus = new InternalBus();
    const { agent: alice } = await agentOn(bus);
    const { agent: bob, id: bobId } = await agentOn(bus);
    adopt(alice, bob, bobId);
    alice.security.learnPeerKey('remote-address', 'remote-key');
    expect(alice.security.peerBindings()).toEqual([{ address: 'remote-address', pubKey: 'remote-key' }]);
  });
});
