/**
 * The PRIMARY flag on a registration (sync-policy §12, the DM half): the socket's own address registers with
 * `primary: true` when this device is the one the person chose; an alias may carry it too; the choice can move
 * at runtime, and 'connect' fires once per socket however often the own address re-registers.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';
import { AgentIdentity, newAddressChallenge, verifyAddressPossession } from '@onderling/core';
import { RelayTransport } from '../src/RelayTransport.js';

const throwawayVault = () => { const store = new Map(); return { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } }; };
async function waitFor(pred, ms = 2_000) {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error(`timeout (${ms}ms)`); await new Promise((r) => setTimeout(r, 10)); }
}
/** A proof-demanding stand-in relay that records the FLAG each register frame carried. */
function stubRelay() {
  const wss = new WebSocketServer({ port: 0 });
  const state = { frames: [], registered: [] };
  wss.on('connection', (ws) => {
    const open = new Map();
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'register') {
        state.frames.push({ address: msg.address, primary: msg.primary === true });
        const nonce = newAddressChallenge(); open.set(nonce, msg.address);
        ws.send(JSON.stringify({ type: 'challenge', address: msg.address, nonce }));
        return;
      }
      if (msg.type === 'register-proof') {
        const address = open.get(msg.nonce); open.delete(msg.nonce);
        if (address !== msg.address || !verifyAddressPossession(msg)) return;
        state.registered.push(msg.address);
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

describe('the primary flag', () => {
  it('a plain device registers plainly; the primary device registers its own address with the flag', async () => {
    relay = stubRelay();
    const identity = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    transport = new RelayTransport({ relayUrl: relay.url, identity, primaryDevice: () => true });
    const connected = new Promise((r) => transport.once('connect', r));
    await transport.connect(); await connected;
    expect(relay.frames).toEqual([{ address: identity.pubKey, primary: true }]);
    await transport.disconnect();
    relay.frames.length = 0;
    transport = new RelayTransport({ relayUrl: relay.url, identity });
    const c2 = new Promise((r) => transport.once('connect', r));
    await transport.connect(); await c2;
    expect(relay.frames).toEqual([{ address: identity.pubKey, primary: false }]);
  });

  it('an alias carries its own flag; changing it re-binds; the choice moving re-registers the own address, and connect fires once', async () => {
    relay = stubRelay();
    const identity = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    const person = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    let connects = 0;
    transport = new RelayTransport({ relayUrl: relay.url, identity, primaryDevice: () => false });
    transport.on('connect', () => { connects += 1; });
    await transport.connect(); await waitFor(() => connects === 1);
    const sign = (m) => person.sign(m);   // the adapter b64-encodes a Uint8Array signature
    expect((await transport.addAddress(person.pubKey, { sign })).ok).toBe(true);
    expect(relay.frames.at(-1)).toEqual({ address: person.pubKey, primary: false });
    // the person made THIS device primary: the alias re-binds with the flag, the own address re-registers with it
    expect((await transport.addAddress(person.pubKey, { sign, primary: true })).ok).toBe(true);
    expect(relay.frames.at(-1)).toEqual({ address: person.pubKey, primary: true });
    expect((await transport.setPrimaryDevice(true)).ok).toBe(true);
    expect(relay.frames.at(-1)).toEqual({ address: identity.pubKey, primary: true });
    expect(transport.primaryDevice).toBe(true);
    expect(connects, "'connect' is once per socket, not once per registration").toBe(1);
    // the same flag again is idempotent (no frame)
    const n = relay.frames.length;
    expect((await transport.addAddress(person.pubKey, { sign, primary: true })).ok).toBe(true);
    expect(relay.frames.length).toBe(n);
  });
});
