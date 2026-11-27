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
async function waitFor(pred, ms = 2_000) {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error(`timeout (${ms}ms)`); await new Promise((r) => setTimeout(r, 10)); }
}

/**
 * A proof-demanding stand-in relay. `answer: 'now'` acks every proven registration at once; 'never' stays silent;
 * 'held' keeps each ack in `state.held` until the test calls `state.release()` (oldest first, as the relay sends).
 */
function stubRelay({ answer = 'now' } = {}) {
  const wss = new WebSocketServer({ port: 0 });
  const state = { acks: 0, held: [], frames: [] };
  state.release = () => { const send = state.held.shift(); if (send) send(); };
  wss.on('connection', (ws, req) => {
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
        if (address !== msg.address || !verifyAddressPossession({ ...msg, isOwnRelayName: (n) => n === req?.headers?.host })) return;
        const ack = () => { state.acks += 1; ws.send(JSON.stringify({ type: 'registered', address: msg.address })); };
        // the socket's own address (the first frame) is always acked at once, so 'connect' fires; silence and the
        // hold are for the alias
        if (state.frames.length === 1 || answer === 'now') ack();
        else if (answer === 'held') state.held.push(ack);
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

  it('a relay that never answers: BOTH waits reject at the timeout, neither hangs', async () => {
    relay = stubRelay({ answer: 'never' });
    const identity = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    const circle = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    transport = new RelayTransport({ relayUrl: relay.url, identity });
    const connected = new Promise((r) => transport.once('connect', r));
    await transport.connect(); await connected;
    const sign = (m) => circle.sign(m);
    const settled = (p) => Promise.race([p.then(() => 'ok', (e) => e.message), new Promise((r) => setTimeout(() => r('still waiting'), 7_000))]);
    const first = settled(transport._bindAddress(circle.pubKey, { sign }));
    const second = settled(transport._bindAddress(circle.pubKey, { sign }));
    const out = await Promise.all([first, second]);
    for (const line of out) expect(line).toMatch(/no acknowledgement for .* within 5s/);
  }, 15_000);

  it('a moved flag waits for the ack of ITS frame, not the one that carried the old flag', async () => {
    relay = stubRelay({ answer: 'held' });
    const identity = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    const circle = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    transport = new RelayTransport({ relayUrl: relay.url, identity });
    const connected = new Promise((r) => transport.once('connect', r));
    await transport.connect(); await connected;
    const sign = (m) => circle.sign(m);
    let oldDone = false; let newDone = false;
    const old = transport._bindAddress(circle.pubKey, { sign }).then(() => { oldDone = true; });
    const moved = transport._bindAddress(circle.pubKey, { sign, primary: true }).then(() => { newDone = true; });
    await waitFor(() => relay.held.length === 2);
    expect(relay.frames.slice(1).map((f) => f.primary)).toEqual([false, true]);
    relay.release();                          // the old flag's ack
    await old;
    await new Promise((r) => setTimeout(r, 100));
    expect([oldDone, newDone]).toEqual([true, false]);
    relay.release();                          // the new flag's ack
    await moved;
    expect(newDone).toBe(true);
  }, 10_000);
});
