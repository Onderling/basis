/**
 * Two registrations of one address in flight on one socket (a reconnect's replay and a caller's own bind, 147 ms
 * apart on a phone): BOTH waits settle on the relay's acks. A second wait that replaced the first left the first
 * one's timer running, so it reported "no acknowledgement within 5s" for an address the relay had acked twice.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';
import { AgentIdentity, newAddressChallenge, verifyAddressPossession } from '@onderling/core';
import { RelayTransport } from '../src/RelayTransport.js';

const throwawayVault = () => { const store = new Map(); return { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } }; };

/** A proof-demanding stand-in relay that acks every proven registration. */
function stubRelay() {
  const wss = new WebSocketServer({ port: 0 });
  const state = { acks: 0 };
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
        state.acks += 1;
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

describe('two binds of one address in flight', () => {
  it('both settle on the acks; neither reports a missing acknowledgement', async () => {
    relay = stubRelay();
    const identity = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    const circle = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    transport = new RelayTransport({ relayUrl: relay.url, identity });
    const connected = new Promise((r) => transport.once('connect', r));
    await transport.connect(); await connected;
    const sign = (m) => circle.sign(m);
    // The replay's bind and the caller's bind, both before the first ack is back.
    const first = transport._bindAddress(circle.pubKey, { sign }).then(() => 'ok', (e) => e.message);
    const second = transport._bindAddress(circle.pubKey, { sign }).then(() => 'ok', (e) => e.message);
    expect(await Promise.all([first, second])).toEqual(['ok', 'ok']);
  }, 10_000);
});
