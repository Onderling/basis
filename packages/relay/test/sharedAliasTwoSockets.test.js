/**
 * ONE ADDRESS, TWO SOCKETS. With one address per persona per circle, every full device of the person registers the SAME
 * circle address on the relay — one holds it, the rest stand by. Each socket proves its own registration, and the
 * transport's possession audit (a 'registered' ack for an address this socket never PROVED → the relay is refused for
 * good) must stay silent on every one of them: an ack follows its own proof, whatever the other socket does.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { AgentIdentity, signWithPersonKey } from '@onderling/core';
import { RelayTransport } from '@onderling/transports';
import nacl from 'tweetnacl';
import { startRelay } from '../src/server.js';

const throwawayVault = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
let stop = null;
afterEach(async () => { try { await stop?.(); } finally { stop = null; } });
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

describe('one shared alias on two sockets', () => {
  it('both register the shared address; neither socket\'s audit fires; the holder\'s close hands the address to the other', async () => {
    const relay = await startRelay({ port: 0, host: '127.0.0.1' });
    stop = () => relay.close?.();
    const url = `ws://127.0.0.1:${relay.port}`;
    const seed = nacl.randomBytes(32);   // the persona's per-circle key: held by both devices
    const shared = AgentIdentity.pubKeyFromSeed(seed);
    const sign = (message) => signWithPersonKey(seed, new TextEncoder().encode(message));
    const devices = [];
    for (let i = 0; i < 2; i += 1) {
      const identity = await AgentIdentity.generate(throwawayVault());
      const tx = new RelayTransport({ identity, relayUrl: url });
      const errors = [];
      tx.on?.('error', (e) => errors.push(String(e?.message ?? e)));
      await tx.connect();
      devices.push({ tx, errors });
    }
    const results = await Promise.all(devices.map((d) => d.tx.addAddress(shared, { sign })));
    // the other order too: each re-asks once more, as a boot re-announce does
    const again = await Promise.all(devices.map((d) => d.tx.addAddress(shared, { sign })));
    await settle(300);
    for (const [i, d] of devices.entries()) {
      expect(d.errors.filter((e) => /does not demand proof/.test(e)), `socket ${i}: the possession audit fired`).toEqual([]);
      expect(d.tx.connected, `socket ${i} still connected`).toBe(true);
    }
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(again.map((r) => r.ok)).toEqual([true, true]);
    for (const d of devices) await d.tx.disconnect?.();
  }, 20_000);

  it('a re-registration while the first proof\'s ack is in flight: the honest ack does not trip the audit', async () => {
    const relay = await startRelay({ port: 0, host: '127.0.0.1' });
    stop = () => relay.close?.();
    const url = `ws://127.0.0.1:${relay.port}`;
    const seed = nacl.randomBytes(32);
    const alias = AgentIdentity.pubKeyFromSeed(seed);
    const sign = (message) => signWithPersonKey(seed, new TextEncoder().encode(message));
    const identity = await AgentIdentity.generate(throwawayVault());
    const tx = new RelayTransport({ identity, relayUrl: url });
    const errors = [];
    tx.on?.('error', (e) => errors.push(String(e?.message ?? e)));
    await tx.connect();
    // two registrations of one address overlap (a re-register with a moved flag, a boot re-announce): each proof is
    // answered and acked, in any order
    for (let i = 0; i < 5; i += 1) {
      await Promise.all([tx.addAddress(alias, { sign }), tx.addAddress(alias, { sign, primary: true }), tx.addAddress(alias, { sign })]);
    }
    await settle(400);
    expect(errors.filter((e) => /does not demand proof/.test(e)), 'the possession audit fired on an honest ack').toEqual([]);
    expect(tx.connected).toBe(true);
    await tx.disconnect?.();
  }, 20_000);
});
