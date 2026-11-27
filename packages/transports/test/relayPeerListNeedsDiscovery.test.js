// A relay's peer list is the relay's word about who is online. Peer discovery is off on the relay by default, so a
// client that did not turn it on never asked for one: a peer list (or a single peer-joined) that arrives anyway is
// dropped, not turned into found peers (which would lift their routing penalty and, on the phone, list them as
// reachable). A client that turns discovery on (`peerDiscovery: true`) takes them, as before.
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';
import { AgentIdentity, newAddressChallenge, verifyAddressPossession } from '@onderling/core';
import { RelayTransport } from '../src/RelayTransport.js';

const throwawayVault = () => { const store = new Map(); return { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } }; };
const settle = (ms = 150) => new Promise((r) => { setTimeout(r, ms); });

/** A proof-demanding stand-in relay that, once a registration is proved, pushes a peer list and a peer-joined unasked. */
function chattyRelay() {
  const wss = new WebSocketServer({ port: 0 });
  wss.on('connection', (ws, req) => {
    const open = new Map();
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'register') {
        const nonce = newAddressChallenge(); open.set(nonce, msg.address);
        ws.send(JSON.stringify({ type: 'challenge', address: msg.address, nonce }));
        return;
      }
      if (msg.type === 'register-proof') {
        const address = open.get(msg.nonce); open.delete(msg.nonce);
        if (address !== msg.address || !verifyAddressPossession({ ...msg, isOwnRelayName: (n) => n === req?.headers?.host })) return;
        ws.send(JSON.stringify({ type: 'registered', address: msg.address }));
        ws.send(JSON.stringify({ type: 'peer-list', peers: ['PEER-A', 'PEER-B'] }));
        ws.send(JSON.stringify({ type: 'peer-joined', address: 'PEER-C' }));
      }
    });
  });
  return { url: `ws://127.0.0.1:${wss.address().port}`, stop: () => new Promise((r) => wss.close(r)) };
}

let relay; let transport;
afterEach(async () => { try { await transport?.disconnect(); } catch { /* */ } await relay?.stop(); relay = null; transport = null; });

async function connectAndCollect(opts = {}) {
  relay = chattyRelay();
  const identity = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
  transport = new RelayTransport({ relayUrl: relay.url, identity, ...opts });
  const found = [];
  transport.on('peer-discovered', (a) => found.push(a));
  const connected = new Promise((r) => transport.once('connect', r));
  await transport.connect(); await connected;
  await settle();
  return found;
}

describe('a relay peer list is taken only when this client turned discovery on', () => {
  it('discovery off (the default): an unasked peer list and peer-joined are dropped', async () => {
    expect(await connectAndCollect()).toEqual([]);
  });

  it('discovery on: the peers are found, as before', async () => {
    expect((await connectAndCollect({ peerDiscovery: true })).sort()).toEqual(['PEER-A', 'PEER-B', 'PEER-C']);
  });
});
