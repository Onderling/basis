/**
 * An awaited `addAddress` means the relay has acked the alias ON THIS SOCKET — for every caller.
 *
 * The base transport answers a known alias with ok at once, and a bind made before the socket opened is replayed
 * on connect. A second caller therefore read "ok" while the replay's proof was still in flight, sent as the
 * alias, and the relay refused it as an unregistered sender — silently for the sender (the runner's enrol
 * walk, 2026-09-16). Now a known-but-not-yet-acked alias waits for the ack.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { AgentIdentity, signWithPersonKey, b64encode } from '@onderling/core';
import { RelayTransport } from '@onderling/transports';
import nacl from 'tweetnacl';
import { startRelay } from '../src/server.js';
import { openClient, send, addr } from './helpers/provenClient.js';

const throwawayVault = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
let stop = null;
afterEach(async () => { try { await stop?.(); } finally { stop = null; } });
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

describe('addAddress awaits the ack on this socket', () => {
  it('an alias bound before connect, re-asked right after connect, is registered before the caller may send as it', async () => {
    const relay = await startRelay({ port: 0, host: '127.0.0.1' });
    stop = () => relay.close?.();
    const url = `ws://127.0.0.1:${relay.port}`;
    const identity = await AgentIdentity.generate(throwawayVault());
    const tx = new RelayTransport({ identity, relayUrl: url });
    const seed = nacl.randomBytes(32);
    const alias = AgentIdentity.pubKeyFromSeed(seed);
    const sign = (message) => signWithPersonKey(seed, new TextEncoder().encode(message));
    // 1. before the socket opens: the bind is deferred and reported ok (the base's contract)
    expect(await tx.addAddress(alias, { sign })).toEqual({ ok: true });
    // 2. connect, and immediately ask again — this must not resolve before the relay acked the alias
    const errors = [];
    tx.on?.('error', (e) => errors.push(String(e?.message ?? e)));
    await tx.connect();
    const again = await tx.addAddress(alias, { sign });
    expect(again).toEqual({ ok: true });
    // 3. send AS the alias at once: a registered receiver hears it from the alias, and the relay refuses nothing
    const bob = await openClient(url);
    send(bob, { type: 'register', address: addr('bob') });
    await settle(200);
    await tx.sendOneWay(addr('bob'), { hello: 'from-alias' }, { from: alias });
    await settle(300);
    expect(errors.filter((e) => /SENDER_NOT_REGISTERED/.test(e)), 'the relay refused the alias as a sender').toEqual([]);
    const got = bob.messages.find((m) => m.type === 'message' && m.envelope?._from === alias);
    expect(got, 'bob received the frame from the alias').toBeTruthy();
    bob.close(); await tx.disconnect?.();
  }, 20_000);
});
