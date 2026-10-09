/**
 * A hello is about THEM knowing US. Seen on phones (2026-10-09): after an app restart, the chat agent still held the
 * host agent's key (persisted), so its boot hello was skipped as "already registered" — but the host's security layer
 * is new at every start and never learned the chat agent's key, so it refused every call as an unknown sender, in
 * silence. The skip now keys on "they acknowledged our key in THIS process" (in memory, empty at every start); a peer
 * whose key we already know is still told who we are, without waiting.
 */
import { describe, it, expect } from 'vitest';
import { Agent } from '../src/Agent.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { Parts } from '../src/Parts.js';
import { forgetHello } from '../src/protocol/hello.js';

const within = (p, ms) => Promise.race([p, new Promise((_, rej) => { setTimeout(() => rej(new Error(`no answer in ${ms} ms`)), ms); })]);
const agentFor = (bus, identity) => new Agent({ identity, transport: new InternalTransport(bus, identity.pubKey) });

describe('the hello after a restart', () => {
  it('the caller still holds the host\'s key; the host is new — the boot hello is SENT and the call is answered', async () => {
    const callerId = await AgentIdentity.generate(new VaultMemory());
    const hostId = await AgentIdentity.generate(new VaultMemory());
    // the second start: both agents are new objects on a new bus; the caller's layer carries the host's key over
    const bus = new InternalBus();
    const caller = agentFor(bus, callerId);
    const host = agentFor(bus, hostId);
    caller.security.registerPeer(host.address, host.pubKey);   // what a persisted peer record restores
    host.register('echo', async ({ parts }) => parts);
    await caller.start(); await host.start();

    await within(caller.hello(host.address), 3_000);
    expect(host.security.getPeerKey(caller.address), 'the host learned who is calling').toBe(caller.pubKey);
    const result = await within(caller.call(host.address, 'echo', 'nog steeds hier').done(), 3_000);
    expect(Parts.text(result.parts)).toBe('nog steeds hier');
  });

  it('a hello the peer acknowledged in this process is not sent again; a forgotten one is', async () => {
    const bus = new InternalBus();
    const a = agentFor(bus, await AgentIdentity.generate(new VaultMemory()));
    const b = agentFor(bus, await AgentIdentity.generate(new VaultMemory()));
    await a.start(); await b.start();
    const sent = [];
    const orig = a.transport.sendHello.bind(a.transport);
    a.transport.sendHello = (...args) => { sent.push(args[0]); return orig(...args); };
    await a.hello(b.address);
    await a.hello(b.address);
    expect(sent).toHaveLength(1);
    forgetHello(a, b.address);   // e.g. a call to them timed out: they may have restarted
    await a.hello(b.address);
    expect(sent).toHaveLength(2);
  });
});
