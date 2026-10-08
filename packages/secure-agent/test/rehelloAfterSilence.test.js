/**
 * A peer that RESTARTED has forgotten our key: everything we send it is dropped unread — and since we had already said
 * hello, we never said it again. A call that gets no answer now forgets that hello, so the next call announces us once
 * more and a peer that is back answers it. A call that timed out for another reason (a slow skill) costs ONE hello on
 * the next call — never a loop. Over a REAL relay: the caller is a secure agent, the callee a node (a kernel agent on
 * its own relay socket, as a companion is) that is stopped and started again with the same key.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Agent, AgentIdentity, Transport, DataPart, Parts } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { RelayTransport } from '@onderling/transports';
import { startRelay } from '@onderling/relay';
import { createSecureAgent } from '../src/createSecureAgent.js';

const cleanups = [];
afterEach(async () => { vi.restoreAllMocks(); while (cleanups.length) { try { await cleanups.pop()(); } catch { /* best-effort */ } } });

/** A node on the relay: `ping` answers at once, `slow` never in time. Same key every start (its vault is kept). */
async function startNode(relayUrl, vault) {
  const identity = (await vault.has('agent-privkey')) ? await AgentIdentity.restore(vault) : await AgentIdentity.generate(vault);
  const agent = new Agent({ identity, transport: new RelayTransport({ relayUrl, identity }), label: 'node' });
  agent.register('ping', async () => [DataPart({ pong: true })]);
  agent.register('slow', async () => { await new Promise((r) => { setTimeout(r, 4_000); }); return [DataPart({ late: true })]; });
  await agent.start();
  cleanups.push(() => agent.stop());
  return agent;
}

async function setup() {
  const relay = await startRelay({ port: 0, log: false });
  cleanups.push(() => relay.stop());
  const relayUrl = `ws://127.0.0.1:${relay.port}`;
  const vault = new VaultMemory();
  const node = await startNode(relayUrl, vault);
  const me = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, relayReadyTimeoutMs: 3000 });
  cleanups.push(() => me.shutdown());
  await me.relay.connect({ relayUrl, awaitReady: true });
  me.setTransportMode('relay');
  // every HI this caller puts on the wire to the node
  const hellos = [];
  const real = Transport.prototype.sendHello;
  vi.spyOn(Transport.prototype, 'sendHello').mockImplementation(function (to, ...rest) {
    if (to === node.address) hellos.push(Date.now());
    return real.call(this, to, ...rest);
  });
  const call = (skill) => me.peer.invoke(node.address, skill, [DataPart({})], { timeout: 1_500 }).then((p) => Parts.data(p));
  return { relayUrl, vault, node, me, hellos, call };
}

describe('a call that gets no answer forgets the hello', () => {
  it('the peer restarted (it forgot our key): the call times out, the NEXT call says hello again and is answered', async () => {
    const { relayUrl, vault, node, hellos, call } = await setup();
    expect(await call('ping')).toEqual({ pong: true });
    expect(hellos).toHaveLength(1);
    await node.stop();
    const again = await startNode(relayUrl, vault);
    expect(again.address).toBe(node.address);
    await expect(call('ping'), 'the restarted node drops what it cannot read').rejects.toThrow(/Timeout waiting for reply/);
    expect(await call('ping'), 'the next call is answered').toEqual({ pong: true });
    expect(hellos, 'one hello more, for that call').toHaveLength(2);
  }, 30_000);

  it('a timeout for another reason (a slow skill) also forgets it — the next call says hello ONCE, and then no more', async () => {
    const { hellos, call } = await setup();
    expect(await call('ping')).toEqual({ pong: true });
    await expect(call('slow')).rejects.toThrow(/Timeout waiting for reply/);
    expect(hellos).toHaveLength(1);
    expect(await call('ping')).toEqual({ pong: true });
    expect(await call('ping')).toEqual({ pong: true });
    expect(await call('ping')).toEqual({ pong: true });
    expect(hellos, 'one hello after the timeout, never a loop').toHaveLength(2);
  }, 30_000);
});
