/**
 * An awaited `addAddress` means the relay has acked the alias ON THIS SOCKET — for every caller.
 *
 * The base transport answers a known alias with ok at once, and a bind made before the socket opened is replayed
 * on connect. A second caller therefore read "ok" while the replay's proof was still in flight, sent as the alias,
 * and the relay refused it as an unregistered sender — silently for the sender (the runner's enrol walk,
 * 2026-09-16). A stub relay that holds the alias's ack makes the race deterministic.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import nacl from 'tweetnacl';
import { AgentIdentity, signWithPersonKey, newAddressChallenge } from '@onderling/core';
import { RelayTransport } from '../src/RelayTransport.js';

const throwawayVault = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

/** A relay that challenges every registration and HOLDS the ack for any address but the primary until released. */
function stubRelay({ primary }) {
  const wss = new WebSocketServer({ port: 0 });
  const held = [];
  const sends = [];
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'register') { ws.send(JSON.stringify({ type: 'challenge', address: msg.address, nonce: newAddressChallenge() })); return; }
      if (msg.type === 'send') { sends.push(msg); return; }
      if (msg.type === 'register-proof') {
        const ack = () => ws.send(JSON.stringify({ type: 'registered', address: msg.address }));
        if (msg.address === primary) ack(); else held.push(ack);
      }
    });
  });
  return {
    port: wss.address().port,
    release: () => { while (held.length) held.shift()(); },
    heldCount: () => held.length,
    sends,
    close: () => new Promise((r) => wss.close(() => r())),
  };
}

describe('addAddress waits for this socket\'s ack', () => {
  let stub = null; let tx = null;
  afterEach(async () => { try { await tx?.disconnect?.(); } catch { /* */ } tx = null; await stub?.close(); stub = null; });

  it('a second addAddress for an alias whose replayed bind is still unacked resolves only when the ack lands', async () => {
    const identity = await AgentIdentity.generate(throwawayVault());
    stub = stubRelay({ primary: identity.pubKey });
    tx = new RelayTransport({ identity, relayUrl: `ws://127.0.0.1:${stub.port}` });
    const seed = nacl.randomBytes(32);
    const alias = AgentIdentity.pubKeyFromSeed(seed);
    const sign = (message) => signWithPersonKey(seed, new TextEncoder().encode(message));
    expect(await tx.addAddress(alias, { sign }), 'before connect: deferred, reported ok').toEqual({ ok: true });
    await tx.connect();               // the primary is acked at once; the alias's replay is challenged and its ack HELD
    await settle(200);
    expect(stub.heldCount(), 'the alias\'s proof reached the relay and its ack is being held').toBe(1);
    let resolved = false;
    const again = tx.addAddress(alias, { sign }).then((r) => { resolved = true; return r; });
    await settle(300);
    expect(resolved, 'the caller must not be told ok while the relay has not acked this socket').toBe(false);
    stub.release();
    expect(await again).toEqual({ ok: true });
    expect(resolved).toBe(true);
  }, 15_000);
  it('a frame sent AS an alias goes out only once the alias is acked — a held message cannot outrun the bind', async () => {
    const identity = await AgentIdentity.generate(throwawayVault());
    stub = stubRelay({ primary: identity.pubKey });
    tx = new RelayTransport({ identity, relayUrl: `ws://127.0.0.1:${stub.port}` });
    const seed = nacl.randomBytes(32);
    const alias = AgentIdentity.pubKeyFromSeed(seed);
    await tx.addAddress(alias, { sign: (m) => signWithPersonKey(seed, new TextEncoder().encode(m)) });
    await tx.connect();
    await settle(200);
    expect(stub.heldCount()).toBe(1);
    let sent = false;
    const p = tx.sendOneWay('someone', { hello: 1 }, { from: alias }).then(() => { sent = true; });
    await settle(300);
    expect(sent, 'the send waits').toBe(false);
    expect(stub.sends, 'no frame from the alias reached the relay before the ack').toEqual([]);
    stub.release();
    await p;
    await settle(200);
    expect(stub.sends.map((f) => f.envelope?._from)).toEqual([alias]);
  }, 15_000);
});
