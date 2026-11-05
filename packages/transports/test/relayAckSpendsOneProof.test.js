/**
 * ONE ACK SPENDS ONE PROOF. Several of a person's devices hold one circle address now, and one socket may register an
 * address again while its first registration is still in flight (a moved primary flag, a boot re-announce). The relay's
 * `registered` for the FIRST proof may then arrive after the second `register` went out. That ack is honest — this socket
 * did prove the address — and must not trip the possession audit; but an ack with no proof of ours outstanding still is
 * the relay that never demanded one, and refuses it for good.
 *
 * A fake relay that holds its acks, so the order is the test's, not the network's.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';
import nacl from 'tweetnacl';
import { AgentIdentity, newAddressChallenge, verifyAddressPossession, signWithPersonKey } from '@onderling/core';
import { RelayTransport } from '../src/RelayTransport.js';

const throwawayVault = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
async function waitFor(pred, ms = 3_000) {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error(`timeout (${ms}ms)`); await new Promise((r) => setTimeout(r, 10)); }
}
/** A proof-demanding relay that acks the socket's OWN address at once and HOLDS every alias ack until released. */
function holdingRelay() {
  const wss = new WebSocketServer({ port: 0 });
  const state = { registers: [], proofs: [], held: [], ws: null, own: null };
  wss.on('connection', (ws) => {
    state.ws = ws;
    const open = new Map();
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'register') {
        state.registers.push(msg.address);
        const nonce = newAddressChallenge(); open.set(nonce, msg.address);
        ws.send(JSON.stringify({ type: 'challenge', address: msg.address, nonce }));
        return;
      }
      if (msg.type === 'register-proof') {
        const address = open.get(msg.nonce); open.delete(msg.nonce);
        if (address !== msg.address || !verifyAddressPossession(msg)) return;
        state.proofs.push(address);
        if (!state.own) { state.own = address; ws.send(JSON.stringify({ type: 'registered', address })); return; }
        state.held.push(address);
      }
    });
  });
  state.url = `ws://127.0.0.1:${wss.address().port}`;
  state.release = () => { const a = state.held.shift(); state.ws.send(JSON.stringify({ type: 'registered', address: a })); };
  state.ackUnasked = (address) => state.ws.send(JSON.stringify({ type: 'registered', address }));
  state.stop = () => new Promise((r) => wss.close(r));
  return state;
}
let relay; let tx;
afterEach(async () => { try { await tx?.disconnect(); } catch { /* */ } await relay?.stop(); relay = null; tx = null; });

describe('one ack spends one proof', () => {
  it('two registrations of one address, the first ack after the second register: both honest, the audit silent; a third ack is refused', async () => {
    relay = holdingRelay();
    const identity = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    tx = new RelayTransport({ relayUrl: relay.url, identity });
    const errors = [];
    tx.on('error', (e) => errors.push(String(e?.message ?? e)));
    const connected = new Promise((r) => tx.once('connect', r));
    await tx.connect(); await connected;
    const seed = nacl.randomBytes(32);
    const alias = AgentIdentity.pubKeyFromSeed(seed);
    const sign = (m) => signWithPersonKey(seed, new TextEncoder().encode(m));

    const first = tx.addAddress(alias, { sign });
    await waitFor(() => relay.proofs.filter((a) => a === alias).length === 1);
    // the flag moves while the first ack is still held: the rebind sends a second register for the same address
    const second = tx._bindAddress(alias, { sign, primary: true });
    await waitFor(() => relay.registers.filter((a) => a === alias).length === 2);
    // the FIRST proof's ack lands now — after the second register, before its proof
    relay.release();
    await waitFor(() => relay.proofs.filter((a) => a === alias).length === 2);
    relay.release();
    await Promise.all([first, second]);
    expect(errors.filter((e) => /without demanding proof of possession/.test(e)), 'an honest ack tripped the audit').toEqual([]);
    expect(tx.connected).toBe(true);

    // a THIRD ack, with both proofs spent: the relay acked what we never proved → refused for good
    relay.ackUnasked(alias);
    await waitFor(() => errors.some((e) => /without demanding proof of possession/.test(e)));
    expect(tx.connected).toBe(false);
  }, 15_000);
});
