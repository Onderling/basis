/**
 * basis — file-share end-to-end round-trip.
 *
 * Catches the bug class the existing suites missed: sender-side
 * state OK, but receiver never gets the bytes (silent drop on the
 * wire / wrong handler / envelope-shape mismatch).
 *
 * Strategy: a loopback fake NKN that routes between two real
 * createSecureAgent instances.  When Tab A's NknTransport calls
 * `client.send(to, payload)`, the hub looks up Tab B's client +
 * fires its 'message' handler with the payload — exactly what the
 * real NKN nodes would do.  Both sides run real Agent +
 * SecurityLayer + bilateral HI, just over our fake transport.
 *
 * Why this matters: a hub like this would have caught the bug
 * Frits hit 2026-05-23 — sender-side test happily passed because
 * sa.peer.sendTo resolved, but the receiver never saw the envelope.
 * The fix (lower MAX_INLINE) is in localBuiltins.js; THIS file
 * keeps the regression from recurring.
 */
import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';

import { createSecureAgent } from '@onderling/secure-agent';
import { VaultMemory }       from '@onderling/vault';

/* ─── Loopback NKN hub ────────────────────────────────── */

/**
 * Build a hub that routes between any number of "clients" by
 * address.  Each `factoryFor(addr)` call returns an nknLib-shaped
 * object suitable for createSecureAgent({ nknLib }).
 *
 * Real NKN drops messages over ~64KB silently.  This hub honours
 * the same cap so headless tests catch oversize-payload bugs the
 * same way the real network would.
 *
 * MAX_NKN_PAYLOAD chosen to match nkn-sdk-js MaxClientMessageSize
 * (~65528 bytes).  Tests asserting "too large" should expect
 * undelivered when payload exceeds this.
 */
const MAX_NKN_PAYLOAD = 65_528;

function makeLoopbackNknHub({ droppedSink } = {}) {
  const clients = new Map();   // addr → instance

  function lookup(addr) { return clients.get(addr) ?? null; }

  function factoryFor(address) {
    return {
      // Real nkn-sdk: `new nkn.Client({seed})` returns an instance.
      // We ignore seed; the address is bound at factory time.
      Client: function (_opts) {
        const instance = {
          addr: address,
          handlers: { connect: [], message: [], error: [] },
          on(event, cb) { (this.handlers[event] ??= []).push(cb); },
          async send(to, payload, _opts) {
            const wire = typeof payload === 'string' ? payload : String(payload);
            if (wire.length > MAX_NKN_PAYLOAD) {
              // Mirror real NKN: silently dropped — sender's send()
              // STILL resolves (this is the trap).  Record in
              // droppedSink for the test to assert against.
              droppedSink?.push({ from: address, to, size: wire.length });
              return;
            }
            const target = lookup(to);
            if (!target) {
              // Unknown peer — also silent drop (real NKN: nodes
              // forward best-effort; unreachable peers see nothing).
              return;
            }
            const msg = { src: address, payload: wire };
            for (const cb of target.handlers.message) cb(msg);
          },
          close() { clients.delete(address); },
        };
        clients.set(address, instance);
        queueMicrotask(() => {
          for (const cb of instance.handlers.connect) cb();
        });
        return instance;
      },
    };
  }

  return { factoryFor, lookup, get clientCount() { return clients.size; } };
}

/* ─── Two-agent fixture ───────────────────────────────── */

async function makeTwoAgents({ droppedSink } = {}) {
  const hub = makeLoopbackNknHub({ droppedSink });
  const received = { alice: [], bob: [] };

  const alice = await createSecureAgent({
    vault:         new VaultMemory(),
    nknLib:        hub.factoryFor('app.alice.test'),
    onPeerMessage: ({ from, payload }) => received.alice.push({ from, payload }),
  });
  const bob = await createSecureAgent({
    vault:         new VaultMemory(),
    nknLib:        hub.factoryFor('app.bob.test'),
    onPeerMessage: ({ from, payload }) => received.bob.push({ from, payload }),
  });
  await alice.peer.connect();
  await bob.peer.connect();
  return { alice, bob, hub, received };
}

/**
 * Build a synthetic file-share payload like basis's
 * /send-file does (without the OS file picker).  Bytes can be any
 * size; tests pass `bytes` as a Uint8Array and we base64 + wrap.
 */
function makeFileSharePayload(bytes, { name = 'test.bin', mime = 'application/octet-stream' } = {}) {
  // btoa-via-string for headless test env (no Buffer-coupling).
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const dataB64 = btoa(bin);
  return {
    type:    'p2p-chat',
    subtype: 'file-share',
    file: {
      id:    `file-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name, mime,
      size:  bytes.length,
      dataB64,
    },
    sentAt: Date.now(),
  };
}

/**
 * Wait until a condition becomes truthy (or a timeout fires).
 * Lets us poll the receiver's inbox for an envelope without
 * coupling to a specific event ordering.
 */
async function waitFor(check, { timeoutMs = 2000, intervalMs = 25 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/* ─── Tests ──────────────────────────────────────────── */

describe('file-share end-to-end round-trip', () => {
  it('small file (1KB) delivers bytes intact', async () => {
    const { alice, bob, received } = await makeTwoAgents();
    const bytes = new Uint8Array(1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    const payload = makeFileSharePayload(bytes, { name: 'tiny.bin' });
    await alice.peer.sendTo(bob.peer.address, payload);

    const got = await waitFor(() => received.bob.some((r) =>
      r.payload?.subtype === 'file-share' && r.payload?.file?.name === 'tiny.bin'
    ));
    expect(got).toBe(true);

    const env = received.bob.find((r) => r.payload?.subtype === 'file-share');
    expect(env.payload.file.size).toBe(1024);
    // Round-trip the bytes: decode the base64 back to bytes + compare.
    const bin = atob(env.payload.file.dataB64);
    const round = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) round[i] = bin.charCodeAt(i);
    expect(round).toEqual(bytes);

    await alice.shutdown();
    await bob.shutdown();
  });

  it('medium file (16KB) still delivers cleanly', async () => {
    const { alice, bob, received } = await makeTwoAgents();
    const bytes = new Uint8Array(16 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) % 256;
    const payload = makeFileSharePayload(bytes, { name: 'mid.bin' });
    await alice.peer.sendTo(bob.peer.address, payload);

    const got = await waitFor(() => received.bob.some((r) =>
      r.payload?.file?.name === 'mid.bin'
    ));
    expect(got).toBe(true);
    const env = received.bob.find((r) => r.payload?.file?.name === 'mid.bin');
    expect(env.payload.file.size).toBe(16 * 1024);
    await alice.shutdown();
    await bob.shutdown();
  });

  it('at-the-cap file (32KB raw) delivers — verifies our chosen MAX_INLINE is safe', async () => {
    const { alice, bob, received } = await makeTwoAgents();
    const bytes = new Uint8Array(32 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i & 0xff;
    const payload = makeFileSharePayload(bytes, { name: 'cap.bin' });
    await alice.peer.sendTo(bob.peer.address, payload);

    const got = await waitFor(() => received.bob.some((r) =>
      r.payload?.file?.name === 'cap.bin'
    ));
    expect(got).toBe(true);
    const env = received.bob.find((r) => r.payload?.file?.name === 'cap.bin');
    expect(env.payload.file.size).toBe(32 * 1024);
    await alice.shutdown();
    await bob.shutdown();
  });

  it('oversize file (128KB) now ARRIVES — the façade chunks it under the NKN ceiling it used to die on', async () => {
    // This test used to document the trap (Frits 2026-05-23): sendTo resolved, the hub silently
    // dropped the over-size message, the bytes never arrived. NknTransport now DECLARES its ~64 KB
    // ceiling and the peer façade chunks anything bigger (peerChunking.js), so the same 128 KB file
    // arrives whole — and the hub's drop-sink, which used to prove the loss, now proves that no
    // single wire message ever exceeded what real NKN can carry.
    const dropped = [];
    const { alice, bob, received } = await makeTwoAgents({ droppedSink: dropped });
    const bytes = new Uint8Array(128 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 3) % 256;
    const payload = makeFileSharePayload(bytes, { name: 'big.bin' });
    const res = await alice.peer.sendTo(bob.peer.address, payload);
    expect(res?.chunked).toBe(true);
    expect(res.chunks).toBeGreaterThan(1);

    const start = Date.now();
    while (Date.now() - start < 4000
      && !received.bob.some((r) => r.payload?.file?.name === 'big.bin')) {
      await new Promise((r) => setTimeout(r, 25));
    }
    const whole = received.bob.find((r) => r.payload?.file?.name === 'big.bin');
    expect(whole, 'the reassembled file reaches the app').toBeTruthy();
    expect(whole.payload.file.size).toBe(128 * 1024);
    // Nothing on the wire was ever big enough for real NKN to drop.
    expect(dropped).toEqual([]);

    await alice.shutdown();
    await bob.shutdown();
  });

  it('multiple small files in sequence: each arrives in order', async () => {
    const { alice, bob, received } = await makeTwoAgents();
    const names = ['a.bin', 'b.bin', 'c.bin'];
    for (const name of names) {
      const bytes = new Uint8Array(512);
      for (let i = 0; i < 512; i++) bytes[i] = name.charCodeAt(0) + i;
      await alice.peer.sendTo(bob.peer.address, makeFileSharePayload(bytes, { name }));
    }
    const got = await waitFor(() => received.bob.length >= 3);
    expect(got).toBe(true);
    const namesArrived = received.bob
      .filter((r) => r.payload?.subtype === 'file-share')
      .map((r) => r.payload.file.name);
    expect(namesArrived).toEqual(names);
    await alice.shutdown();
    await bob.shutdown();
  });
});
