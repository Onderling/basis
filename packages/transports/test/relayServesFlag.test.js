/**
 * What a node SERVES the relay's seat (`serves: ['feed']`) is said by the node itself, on its own address's register
 * frame only — an alias never carries it, and a transport built without it says nothing.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';
import { AgentIdentity, newAddressChallenge, verifyAddressPossession } from '@onderling/core';
import { RelayTransport } from '../src/RelayTransport.js';

const throwawayVault = () => { const store = new Map(); return { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } }; };
function stubRelay() {
  const wss = new WebSocketServer({ port: 0 });
  const state = { frames: [] };
  wss.on('connection', (ws) => {
    const open = new Map();
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'register') {
        state.frames.push({ address: msg.address, serves: msg.serves ?? null });
        const nonce = newAddressChallenge(); open.set(nonce, msg.address);
        ws.send(JSON.stringify({ type: 'challenge', address: msg.address, nonce }));
        return;
      }
      if (msg.type === 'register-proof') {
        const address = open.get(msg.nonce); open.delete(msg.nonce);
        if (address !== msg.address || !verifyAddressPossession(msg)) return;
        ws.send(JSON.stringify({ type: 'registered', address: msg.address }));
      }
    });
  });
  state.url = `ws://127.0.0.1:${wss.address().port}`;
  state.stop = () => new Promise((r) => wss.close(r));
  return state;
}
let relay; let transport;
afterEach(async () => { try { await transport?.disconnect(); } catch { /* */ } await relay?.stop(); relay = null; transport = null; });

describe('the serves flag', () => {
  it('rides the node\'s own register frame when asked for, and only then', async () => {
    relay = stubRelay();
    const identity = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    transport = new RelayTransport({ relayUrl: relay.url, identity, serves: ['feed'] });
    const connected = new Promise((r) => transport.once('connect', r));
    await transport.connect(); await connected;
    expect(relay.frames).toEqual([{ address: identity.pubKey, serves: ['feed'] }]);
    // an alias (a per-circle address) never opts the node into anything
    const alias = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    expect((await transport.addAddress(alias.pubKey, { sign: (m) => alias.sign(m) })).ok).toBe(true);
    expect(relay.frames.at(-1)).toEqual({ address: alias.pubKey, serves: null });
    await transport.disconnect();
    relay.frames.length = 0;
    transport = new RelayTransport({ relayUrl: relay.url, identity });
    const c2 = new Promise((r) => transport.once('connect', r));
    await transport.connect(); await c2;
    expect(relay.frames).toEqual([{ address: identity.pubKey, serves: null }]);
  });
});
