/**
 * RelayTransport integration tests — uses an in-process relay server fixture.
 *
 * The relay fixture is a minimal WebSocket server that implements the same
 * register/send/message protocol as a real relay server.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
// The fixture has to CHALLENGE: `RelayTransport` refuses a relay that acks a registration
// without demanding proof of address possession (DESIGN-boundary-authentication §7).
import { newAddressChallenge, verifyAddressPossession } from '../src/identity/addressPossession.js';

import { Agent }           from '../src/Agent.js';
import { AgentIdentity }   from '../src/identity/AgentIdentity.js';
import { VaultMemory }     from '@onderling/vault';
import { RelayTransport }  from '@onderling/transports';
import { TextPart, Parts } from '../src/Parts.js';

// ── In-process relay server ────────────────────────────────────────────────────

function startRelayServer() {
  const wss     = new WebSocketServer({ port: 0 });  // OS assigns free port
  const clients = new Map(); // address → ws

  wss.on('connection', (ws) => {
    let address = null;
    const open = new Map();               // nonce → address, single use

    ws.on('message', (raw) => {
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
        address = msg.address;
        clients.set(address, ws);
        ws.send(JSON.stringify({ type: 'registered', address }));
        return;
      }

      if (msg.type === 'send') {
        const target = clients.get(msg.to);
        if (target && target.readyState === 1 /* OPEN */) {
          target.send(JSON.stringify({ type: 'message', envelope: msg.envelope }));
        } else {
          ws.send(JSON.stringify({ type: 'error', message: `Unknown address: ${msg.to}` }));
        }
        return;
      }
    });

    ws.on('close', () => {
      if (address) clients.delete(address);
    });
  });

  const port = () => wss.address().port;
  const url  = () => `ws://127.0.0.1:${port()}`;

  const stop = () => new Promise(resolve => {
    // Close all open client sockets first.
    for (const ws of clients.values()) ws.terminate();
    wss.close(resolve);
  });

  return new Promise(resolve => {
    wss.once('listening', () => resolve({ url: url(), stop }));
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function makeRelayPair(relayUrl) {
  const aId   = await AgentIdentity.generate(new VaultMemory());
  const bId   = await AgentIdentity.generate(new VaultMemory());
  const alice = new Agent({ identity: aId, transport: new RelayTransport({ relayUrl, identity: aId }) });
  const bob   = new Agent({ identity: bId, transport: new RelayTransport({ relayUrl, identity: bId }) });
  alice.addPeer(bob.address,   bob.pubKey);
  bob.addPeer(alice.address,   alice.pubKey);
  await alice.start();
  await bob.start();
  return { alice, bob };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RelayTransport', () => {
  let relay;
  beforeEach(async () => { relay = await startRelayServer(); });
  afterEach(async  () => { await relay.stop(); });

  it('constructor throws without relayUrl', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    expect(() => new RelayTransport({ identity: id })).toThrow(/relayUrl/);
  });

  it('constructor throws without identity', () => {
    expect(() => new RelayTransport({ relayUrl: 'ws://localhost:9999' })).toThrow(/identity/);
  });

  it('connects and exposes pubKey as address', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const t  = new RelayTransport({ relayUrl: relay.url, identity: id });
    await t.connect();
    expect(t.address).toBe(id.pubKey);
    await t.disconnect();
  });

  it('emits connect event on successful registration', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const t  = new RelayTransport({ relayUrl: relay.url, identity: id });
    const connected = new Promise(res => t.once('connect', res));
    await t.connect();
    await expect(connected).resolves.toBeDefined();
    await t.disconnect();
  });

  it('two agents can invoke a skill over the relay', async () => {
    const { alice, bob } = await makeRelayPair(relay.url);
    bob.register('echo', async ({ parts }) => parts);

    const result = await alice.invoke(bob.address, 'echo', [TextPart('relay-echo')]);
    expect(Parts.text(result)).toBe('relay-echo');
  });

  it('one-way messages are delivered', async () => {
    const { alice, bob } = await makeRelayPair(relay.url);
    const received = [];
    bob.on('message', m => received.push(m));

    await alice.message(bob.address, 'hello relay');
    await new Promise(r => setTimeout(r, 50));

    expect(received).toHaveLength(1);
    expect(Parts.text(received[0].parts)).toBe('hello relay');
  });

  it('streaming skill works over the relay', async () => {
    const { alice, bob } = await makeRelayPair(relay.url);
    bob.register('count', async function* () {
      yield [TextPart('one')];
      yield [TextPart('two')];
    });

    const task   = alice.call(bob.address, 'count', []);
    const chunks = [];
    for await (const c of task.stream()) chunks.push(Parts.text(c));

    expect(chunks).toEqual(['one', 'two']);
    const res = await task.done();
    expect(res.state).toBe('completed');
  });

  it('unknown skill returns failed task', async () => {
    const { alice, bob } = await makeRelayPair(relay.url);
    await expect(alice.invoke(bob.address, 'nope', [])).rejects.toThrow(/Unknown skill/);
  });
});
