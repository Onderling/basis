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
import WebSocket from 'ws';
import { randomBytes } from 'node:crypto';
import { AgentIdentity, signAddressPossession } from '@onderling/core';
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
});
