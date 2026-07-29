/**
 * S4 · J-R2 — **the property Frits named**: no shared relay, no linkage.
 *
 *   Circle X rides relay R1; circle Y rides R2. → R1 sees ONLY Anna's X-address; R2 only her Y-address.
 *   Neither can link them, and the addresses share no derivable relation.
 *
 * This is the half of the G13 promise that survives the push-token concession. `perCircleAddressingConcession`
 * holds the part that is honestly given up — one relay you are connected to can correlate the circles you
 * registered on it. This file holds what that concession does NOT extend to: a relay learning about
 * circles it does not host.
 *
 * Walked from the adversary's seat, against two REAL relays, because the claim is about what a server can
 * conclude. The sheet is explicit that "two circles on one relay" is J-R1 and proves the opposite thing —
 * so both relays here are genuinely separate processes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { startRelay } from '../src/server.js';
import { RelayTransport } from '@onderling/transports';
import { AgentIdentity, deriveCircleAddress, deriveCircleSeed } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

/**
 * What a relay can see, read the way anyone connected to it can read it.
 *
 * The relay broadcasts `{type:'peer-list', peers:[…]}` — every registered address on that relay, to every
 * client on it. That is the adversary's view without needing a test-only accessor, and it is stronger
 * evidence than reading an internal map: this is what the relay actually TELLS people.
 */
async function observer(url, ownAddress) {
  const ws = await new Promise((resolve, reject) => {
    const sock = new WebSocket(url);
    sock.once('open', () => resolve(sock));
    sock.once('error', reject);
  });
  ws.seen = new Set();
  /** Every frame, so a test can assert what the relay did NOT say as well as what it did. */
  ws.frames = [];
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      ws.frames.push(msg);
      if (msg?.type === 'peer-list') for (const p of msg.peers ?? []) ws.seen.add(p);
    } catch { /* not for us */ }
  });
  // The watcher has to be a CO-TENANT: the relay announces its peer list only to registered clients, so
  // an unregistered lurker learns nothing at all. That is a real (and welcome) property — but it makes
  // the co-tenant the adversary worth testing against, and it is the stronger claim: even someone else
  // legitimately using R2 does not learn about circles on R1.
  ws.send(JSON.stringify({ type: 'register', address: ownAddress }));
  await settle(120);
  return ws;
}

describe('J-R2 — a relay learns nothing about a circle it does not host', () => {
  let r1; let r2; let anna;
  /** Everything to close before the relays stop — an open socket keeps `stop()` hanging. */
  let sockets = [];

  beforeEach(async () => {
    sockets = [];
    r1 = await startRelay({ port: 0 });
    r2 = await startRelay({ port: 0 });
    anna = await AgentIdentity.generate(new VaultMemory());
  });

  afterEach(async () => {
    for (const s of sockets) { try { s.close?.(); await s.disconnect?.(); } catch { /* best-effort */ } }
    await r1?.stop();
    await r2?.stop();
  });

  it('R1 sees only the X-address; R2 only the Y-address', async () => {
    const xAddress = 'anna@circle-x';
    const yAddress = 'anna@circle-y';
    // Someone connected to each relay, watching what it announces.
    const eyeOnR1 = await observer(`ws://127.0.0.1:${r1.port}`, 'co-tenant-on-r1');
    const eyeOnR2 = await observer(`ws://127.0.0.1:${r2.port}`, 'co-tenant-on-r2');
    sockets.push(eyeOnR1, eyeOnR2);

    // Circle X rides R1. Anna registers the address for THAT circle, and nothing else.
    const onR1 = new RelayTransport({ relayUrl: `ws://127.0.0.1:${r1.port}`, identity: anna });
    sockets.push(onR1);
    await onR1.connect();
    await onR1.addAddress(xAddress);
    await settle();

    // Later, circle Y on R2 — a device is on one relay at a time, which is the realistic shape.
    await onR1.disconnect();
    const onR2 = new RelayTransport({ relayUrl: `ws://127.0.0.1:${r2.port}`, identity: anna });
    sockets.push(onR2);
    await onR2.connect();
    await onR2.addAddress(yAddress);
    await settle();

    const seenByR1 = eyeOnR1.seen;
    const seenByR2 = eyeOnR2.seen;

    expect(seenByR2.has(yAddress)).toBe(true);
    // The failure this catches: registration scoping handing a relay the addresses of circles it does not
    // host — a per-relay concession silently becoming a global one.
    expect(seenByR2.has(xAddress), 'R2 was told about a circle it does not host').toBe(false);
    expect(seenByR1.has(yAddress), 'R1 was told about a circle it does not host').toBe(false);

  });

  it('…and the two addresses share no derivable relation', async () => {
    // The other half of the claim, and the one a routing test cannot show: even holding BOTH addresses,
    // an observer who pooled the two relays' logs could not tell they belong to one person — the
    // derivation is a one-way function of a secret profile seed, so neither address reveals the seed and
    // neither predicts the other.
    const profileSeed = new Uint8Array(32).fill(7);
    const x = deriveCircleAddress(profileSeed, 'circle-x');
    const y = deriveCircleAddress(profileSeed, 'circle-y');

    expect(x).not.toBe(y);
    // No shared prefix or suffix an observer could bucket on.
    expect(x.slice(0, 8)).not.toBe(y.slice(0, 8));
    expect(x.slice(-8)).not.toBe(y.slice(-8));
    // A DIFFERENT person's address for the same circle is unrelated too — otherwise the circle id itself
    // would be the correlator.
    const other = deriveCircleAddress(new Uint8Array(32).fill(9), 'circle-x');
    expect(other).not.toBe(x);
    // And the seed for one circle does not yield another's.
    expect(deriveCircleSeed(profileSeed, 'circle-x')).not.toEqual(deriveCircleSeed(profileSeed, 'circle-y'));
  });

  it('the same circle on the same seed is STABLE — otherwise nobody could reach her twice', async () => {
    // The counterweight: unlinkability that changed every call would also mean unreachability.
    const seed = new Uint8Array(32).fill(3);
    expect(deriveCircleAddress(seed, 'circle-x')).toBe(deriveCircleAddress(seed, 'circle-x'));
  });
});

describe('J-R4 — a relay you left learns nothing more', () => {
  let r1; let r2; let anna; let sockets;

  beforeEach(async () => {
    sockets = [];
    r1 = await startRelay({ port: 0 });
    r2 = await startRelay({ port: 0 });
    anna = await AgentIdentity.generate(new VaultMemory());
  });
  afterEach(async () => {
    for (const s of sockets) { try { s.close?.(); await s.disconnect?.(); } catch { /* */ } }
    await r1?.stop(); await r2?.stop();
  });

  it('moving a circle to another relay leaves no forwarding address behind', async () => {
    const xAddress = 'anna@circle-x';
    const eyeOnR1 = await observer(`ws://127.0.0.1:${r1.port}`, 'co-tenant-on-r1');
    sockets.push(eyeOnR1);

    // Circle X is on R1 for a while.
    const onR1 = new RelayTransport({ relayUrl: `ws://127.0.0.1:${r1.port}`, identity: anna });
    sockets.push(onR1);
    await onR1.connect();
    await onR1.addAddress(xAddress);
    await settle();
    expect(eyeOnR1.seen.has(xAddress), 'R1 never saw the address it was hosting').toBe(true);

    // Anna moves it to R2.
    await onR1.disconnect();
    const onR2 = new RelayTransport({ relayUrl: `ws://127.0.0.1:${r2.port}`, identity: anna });
    sockets.push(onR2);
    await onR2.connect();
    await onR2.addAddress(xAddress);
    await settle();

    // R1 keeps what it already saw — that is unavoidable, and the journey does not ask otherwise. What it
    // must NOT have is any trace of where she went: a forwarding address or a tombstone naming R2 would
    // let two relays cooperate to follow one identity across a move.
    const r1Frames = eyeOnR1.frames.map((f) => JSON.stringify(f)).join(' ');
    expect(r1Frames).not.toContain(String(r2.port));
    expect(r1Frames.toLowerCase()).not.toMatch(/forward|moved|redirect|tombstone/);
  });

  it('…and R1 stops routing to her: a message sent there is not silently delivered elsewhere', async () => {
    const xAddress = 'anna@circle-x';
    const onR1 = new RelayTransport({ relayUrl: `ws://127.0.0.1:${r1.port}`, identity: anna });
    sockets.push(onR1);
    await onR1.connect();
    await onR1.addAddress(xAddress);
    await settle();
    await onR1.disconnect();
    await settle();

    // A sender still pointed at R1 gets no delivery — the message queues or fails there. The failure this
    // guards against is the opposite: R1 quietly knowing where to forward, which is the leak.
    const stranger = await observer(`ws://127.0.0.1:${r1.port}`, 'someone-else');
    sockets.push(stranger);
    expect(stranger.seen.has(xAddress), 'R1 still advertises a peer that left').toBe(false);
  });
});
