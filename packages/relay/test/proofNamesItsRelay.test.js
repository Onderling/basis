/**
 * A PROOF THAT A DEVICE HOLDS AN ADDRESS NAMES THE RELAY IT WAS GIVEN TO (the independent read, 2026-11-20).
 *
 * The signed message used to be the scheme, the address and a nonce. A hostile relay could fetch a challenge for a
 * person's address from an honest relay, hand it to the person's device as its own, and register that address at the
 * honest relay with the answer: taking the person's address there. Now the device signs the name of the relay it
 * DIALLED, and a relay accepts a proof only for one of its own names (the Host the connection dialled, or a configured
 * name): the hostile relay's answer names the hostile relay and is refused.
 */
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';
import { AgentIdentity, signAddressPossession } from '@onderling/core';
import { RelayTransport } from '@onderling/transports';
import { startRelay } from '../src/server.js';

const throwawayVault = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
let relay; const sockets = [];
afterEach(async () => { for (const s of sockets.splice(0)) { try { s.close(); } catch { /* */ } } await relay?.stop?.(); relay = null; });

/** Register `identity`'s address on the relay, answering the challenge for the relay named `signFor`. */
async function registerNaming(identity, signFor, { send = signFor } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${relay.port}`);
  sockets.push(ws);
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  return new Promise((resolve) => {
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'challenge') {
        ws.send(JSON.stringify({ type: 'register-proof', address: identity.pubKey, nonce: msg.nonce, proof: signAddressPossession(identity, identity.pubKey, msg.nonce, signFor), relay: send }));
      } else if (msg.type === 'registered') resolve('registered');
      else if (msg.type === 'error') resolve(msg.message);
    });
    ws.send(JSON.stringify({ type: 'register', address: identity.pubKey }));
  });
}

describe('the proof of an address names the relay it was answered for', () => {
  it('a proof naming THIS relay registers the address', async () => {
    relay = await startRelay({ port: 0 });
    const id = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    expect(await registerNaming(id, `127.0.0.1:${relay.port}`)).toBe('registered');
  });

  it('a proof answered for ANOTHER relay is refused, even with a valid signature', async () => {
    relay = await startRelay({ port: 0 });
    const id = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    // the device dialled the hostile relay and signed its name; the hostile relay passes the answer on
    expect(await registerNaming(id, 'hostile.example:443')).toBe('PROOF_INVALID');
  });

  it('a proof that claims this relay but was signed for another is refused (the name is inside the signature)', async () => {
    relay = await startRelay({ port: 0 });
    const id = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    expect(await registerNaming(id, 'hostile.example:443', { send: `127.0.0.1:${relay.port}` })).toBe('PROOF_INVALID');
  });

  it('a configured name (a relay behind a proxy that rewrites Host) is its own too', async () => {
    relay = await startRelay({ port: 0, relayNames: ['relay.example.org'] });
    const id = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    expect(await registerNaming(id, 'relay.example.org')).toBe('registered');
  });

  it('a host name is case-insensitive on both sides', async () => {
    relay = await startRelay({ port: 0, relayNames: ['Relay.Example.org'] });
    const id = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    expect(await registerNaming(id, 'relay.EXAMPLE.org')).toBe('registered');
  });
});

describe('the attack end to end: a hostile relay passes an honest relay\'s challenge to a real device', () => {
  let hostile;
  afterEach(async () => { if (hostile) { for (const c of hostile.clients) c.terminate(); await new Promise((r) => hostile.close(() => r())); hostile = null; } });

  it('the device answers for the relay it dialled, so the honest relay refuses to give the hostile one its address', async () => {
    relay = await startRelay({ port: 0, host: '127.0.0.1' });
    // the hostile relay: every frame both ways is passed on to the honest relay, which it dials as itself
    hostile = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise((r) => hostile.once('listening', r));
    const upstreamSaid = [];
    hostile.on('connection', (down) => {
      const up = new WebSocket(`ws://127.0.0.1:${relay.port}`);
      const pending = [];
      up.on('open', () => { while (pending.length) up.send(pending.shift()); });
      down.on('message', (d) => { const t = String(d); if (up.readyState === 1) up.send(t); else pending.push(t); });
      up.on('message', (d) => { upstreamSaid.push(JSON.parse(String(d))); if (down.readyState === 1) down.send(String(d)); });
      down.on('close', () => up.close()); up.on('close', () => down.close());
    });
    const identity = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    const tx = new RelayTransport({ relayUrl: `ws://127.0.0.1:${hostile.address().port}`, identity });
    tx.on('error', () => { /* the refusal surfaces here too */ });
    await tx.connect().catch(() => {});
    const t0 = Date.now();
    while (!upstreamSaid.some((m) => m.type === 'error' || m.type === 'registered') && Date.now() - t0 < 4_000) await new Promise((r) => setTimeout(r, 20));
    // before the proof named its relay, this was `registered`: the honest relay handed the address to the hostile one
    expect(upstreamSaid.find((m) => m.type === 'registered')).toBeUndefined();
    expect(upstreamSaid.find((m) => m.type === 'error')).toMatchObject({ message: 'PROOF_INVALID', address: identity.pubKey });
    await tx.disconnect?.().catch?.(() => {});
  }, 15_000);
});
