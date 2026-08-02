/**
 * LocalTransport tests — uses an in-process WsServerTransport as the server.
 * Requires the @onderling/relay package to be installed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalTransport } from '../src/transport/LocalTransport.js';
import { Agent }          from '../src/Agent.js';
import { AgentIdentity }  from '../src/identity/AgentIdentity.js';
import { VaultMemory }    from '@onderling/vault';
import { TextPart, Parts } from '../src/Parts.js';

// ── Inline relay server fixture ───────────────────────────────────────────────
// We replicate the minimal relay protocol from RelayTransport.test.js
// rather than depending on @onderling/relay (separate package).

import { WebSocketServer } from 'ws';
// The fixture has to CHALLENGE: a client refuses a server that registers it without
// demanding proof of address possession (DESIGN-boundary-authentication §7).
import { newAddressChallenge, verifyAddressPossession } from '../src/identity/addressPossession.js';


function startServer() {
  const wss     = new WebSocketServer({ port: 0 });
  const clients = new Map();

  wss.on('connection', ws => {
    let addr = null;
    const open = new Map();               // nonce → address, single use
    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'register') {
        const nonce = newAddressChallenge();
        open.set(nonce, msg.address);
        ws.send(JSON.stringify({ type: 'challenge', address: msg.address, nonce }));
        return;
      }
      if (msg.type === 'register-proof') {
        if (open.get(msg.nonce) !== msg.address || !verifyAddressPossession(msg)) {
          ws.send(JSON.stringify({ type: 'error', message: 'PROOF_INVALID' }));
          return;
        }
        open.delete(msg.nonce);
        addr = msg.address; clients.set(addr, ws);
        ws.send(JSON.stringify({ type: 'registered', address: addr }));
        return;
      }
      if (msg.type === 'send') {
        const t = clients.get(msg.to);
        if (t) t.send(JSON.stringify({ type: 'message', envelope: msg.envelope }));
        else   ws.send(JSON.stringify({ type: 'error', message: `unknown: ${msg.to}` }));
      }
    });
    ws.on('close', () => { if (addr) clients.delete(addr); });
  });

  return new Promise(resolve => {
    wss.once('listening', () =>
      resolve({ port: wss.address().port, stop: () => new Promise(r => wss.close(r)) }));
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeAgent(port) {
  const id        = await AgentIdentity.generate(new VaultMemory());
  const transport = new LocalTransport({ identity: id, port });
  const agent     = new Agent({ identity: id, transport, label: 'test' });
  await agent.start();
  return { agent, id };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LocalTransport', () => {
  let server;
  beforeEach(async () => { server = await startServer(); });
  afterEach(async ()  => { await server.stop(); });

  it('constructor throws without identity', () => {
    expect(() => new LocalTransport({ port: 8080 })).toThrow(/identity/);
  });

  it('constructor throws without connection target', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    expect(() => new LocalTransport({ identity: id })).toThrow(/port|socketPath|url/);
  });

  it('connects and exposes address as pubKey', async () => {
    const { agent, id } = await makeAgent(server.port);
    expect(agent.address).toBe(id.pubKey);
    expect(agent.transport.connected).toBe(true);
    await agent.stop();
  });

  it('accepts an explicit URL', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const t  = new LocalTransport({ identity: id, url: `ws://localhost:${server.port}` });
    const a  = new Agent({ identity: id, transport: t });
    await a.start();
    expect(a.transport.connected).toBe(true);
    await a.stop();
  });

  it('two agents exchange a skill call through the local server', async () => {
    const { agent: alice } = await makeAgent(server.port);
    const { agent: bob }   = await makeAgent(server.port);

    bob.register('echo', async ({ parts }) => parts);
    alice.addPeer(bob.address, bob.pubKey);
    bob.addPeer(alice.address, alice.pubKey);

    const result = await alice.invoke(bob.address, 'echo', [TextPart('local hello')]);
    expect(Parts.text(result)).toBe('local hello');

    await alice.stop(); await bob.stop();
  });

  it('emits connect event on registration', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const t  = new LocalTransport({ identity: id, port: server.port });
    const connected = new Promise(r => t.once('connect', r));
    await t.connect();
    const evt = await connected;
    expect(evt.address).toBe(id.pubKey);
    await t.disconnect();
  });

  it('emits disconnect on stop', async () => {
    const { agent } = await makeAgent(server.port);
    const disc = new Promise(r => agent.transport.once('disconnect', r));
    await agent.stop();
    await disc;
  });
});
