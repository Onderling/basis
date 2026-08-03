/**
 * The relay's own view of per-circle addressing, from the adversary's seat.
 *
 * Per-circle addressing (G13) promises unlinkability against **other members**, against **anyone watching
 * the wire**, and against **every relay you did not use**. It does NOT promise unlinkability against a
 * relay you are connected to, because a device has exactly one OS push token, and registering N
 * per-circle addresses writes N rows carrying that same token.
 *
 * `docs/decisions.md` (2026-07-27) says so in prose. Prose drifts. These tests hold the concession as a
 * FACT the relay demonstrates — both halves of it:
 *
 *   • the part that is honestly given up (J-R1): one socket, N addresses, one token — correlatable
 *     in a glance by whoever runs the relay;
 *   • the part that must not quietly get worse (J-R5): the token maps to the SOCKET, never to a circle.
 *     Per-circle push metadata would hand the relay circle membership on top of the correlation it
 *     already has, which is a different and much larger loss.
 *
 * If the first ever starts passing "better" than written — a relay that cannot correlate — that is good
 * news and this file should be rewritten, not deleted. The failure mode it guards against is the promise
 * silently overstating itself, in either direction.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startRelay } from '../src/server.js';
import { PushTokenRegistry } from '../src/push/PushTokenRegistry.js';
import { RelayTransport } from '@onderling/transports';
import { AgentIdentity, deriveCircleAddress, circleAddressSigner } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { randomBytes } from 'node:crypto';

const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

/**
 * A per-circle address is a KEY, and since 2026-07-31 the relay makes a device prove it holds it
 * (Decision 3) — so an alias here is the real derived address plus its vault-free signer, exactly as
 * a device would present it. Nothing about the concession this file measures changes: what the relay
 * correlates is the shared push token, which proof of possession does not touch.
 */
const seedFor = new Map();
const seedOf = (who) => {
  if (!seedFor.has(who)) seedFor.set(who, new Uint8Array(randomBytes(32)));
  return seedFor.get(who);
};
const circleAddr = (who, circleId) => deriveCircleAddress(seedOf(who), circleId);
const alias = (who, circleId) =>
  [circleAddr(who, circleId), { sign: circleAddressSigner(seedOf(who), circleId) }];

describe('J-R1 — one socket, several addresses, one token (the concession, exactly)', () => {
  let relay; let url; let registry; let anna; let annaId;

  beforeEach(async () => {
    registry = new PushTokenRegistry();
    relay = await startRelay({ port: 0, pushTokenRegistry: registry });
    url = `ws://127.0.0.1:${relay.port}`;
    annaId = await AgentIdentity.generate(new VaultMemory());
    anna = new RelayTransport({ relayUrl: url, identity: annaId });
    await anna.connect();
  });

  afterEach(async () => {
    try { await anna.disconnect(); } catch { /* */ }
    await relay.stop();
  });

  it('the relay CAN correlate a device’s circle addresses through the shared push token', async () => {
    await anna.registerPushToken?.({ token: 'ExponentPushToken[anna-device]', platform: 'android' });
    await anna.addAddress(...alias('anna', 'anna@oosterpoort'));
    await anna.addAddress(...alias('anna', 'anna@voetbalclub'));
    await settle();

    const rows = ['anna@oosterpoort', 'anna@voetbalclub'].map((c) => registry.get(circleAddr('anna', c)));
    // Both addresses are known to the relay…
    expect(rows.every(Boolean), 'the relay did not learn both per-circle addresses').toBe(true);
    // …and they carry the SAME token. This is the concession, stated as a fact rather than a caveat:
    // whoever runs this relay can join these two circle identities to one device without effort.
    expect(rows[0].token).toBe(rows[1].token);
    expect(rows[0].token).toBe('ExponentPushToken[anna-device]');
  });

  it('…and it holds whichever order the device does it in', async () => {
    // The token can arrive before or after an alias — a device registers circles as it joins them, and
    // the OS hands over a token whenever it feels like it. If only one order wired the token through,
    // the other order would leave addresses unwoken, which is the G15 failure (a circle whose offline
    // members silently stop being notified) rather than a privacy one.
    await anna.addAddress(...alias('anna', 'anna@eerst'));
    await settle();
    await anna.registerPushToken?.({ token: 'ExponentPushToken[anna-device]', platform: 'android' });
    await settle();
    await anna.addAddress(...alias('anna', 'anna@daarna'));
    await settle();

    expect(registry.get(circleAddr('anna', 'anna@eerst'))?.token, 'an address registered BEFORE the token was left unwoken').toBe('ExponentPushToken[anna-device]');
    expect(registry.get(circleAddr('anna', 'anna@daarna'))?.token, 'an address registered AFTER the token was left unwoken').toBe('ExponentPushToken[anna-device]');
  });

  it('what G13 still delivers: the addresses do not carry the identity that links them', async () => {
    await anna.addAddress(...alias('anna', 'anna@oosterpoort'));
    await settle();
    // The correlation above comes from the TOKEN, not from the address space. A relay with no push
    // configured — and every relay Anna never used — learns nothing linking these two names. That is
    // the part of the promise that survives, and it is why the concession is worth making.
    const plain = await startRelay({ port: 0 });   // no pushTokenRegistry
    try {
      const bramId = await AgentIdentity.generate(new VaultMemory());
      const bram = new RelayTransport({ relayUrl: `ws://127.0.0.1:${plain.port}`, identity: bramId });
      await bram.connect();
      await bram.addAddress(...alias('bram', 'bram@oosterpoort'));
      await settle();
      // Nothing about Anna's device reached this relay at all.
      expect(registry.get(circleAddr('bram', 'bram@oosterpoort'))).toBeNull();
      await bram.disconnect();
    } finally { await plain.stop(); }
  });
});

describe('J-R5 — the token maps to the socket, never to a circle', () => {
  let relay; let url; let registry;

  beforeEach(async () => {
    registry = new PushTokenRegistry();
    relay = await startRelay({ port: 0, pushTokenRegistry: registry });
    url = `ws://127.0.0.1:${relay.port}`;
  });
  afterEach(async () => { await relay.stop(); });

  it('a token record carries no circle — only the address, platform and timestamps', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const dev = new RelayTransport({ relayUrl: url, identity: id });
    await dev.connect();
    await dev.registerPushToken?.({ token: 'ExponentPushToken[dev]', platform: 'android' });
    await dev.addAddress(...alias('dev', 'someone@buurt'));
    await settle();

    const row = registry.get(circleAddr('dev', 'someone@buurt'));
    expect(row).toBeTruthy();
    // The shape IS the guarantee: a relay that stored a circle id here would know which circles a device
    // belongs to, which is strictly more than the token already leaks.
    expect(Object.keys(row).sort()).toEqual(['lastPushedAt', 'platform', 'registeredAt', 'token']);
    expect(JSON.stringify(row)).not.toContain('buurt');
    await dev.disconnect();
  });

  it('two DEVICES are not correlated — the token is per-device, so this is where linkage stops', async () => {
    const [aId, bId] = await Promise.all([
      AgentIdentity.generate(new VaultMemory()),
      AgentIdentity.generate(new VaultMemory()),
    ]);
    const a = new RelayTransport({ relayUrl: url, identity: aId });
    const b = new RelayTransport({ relayUrl: url, identity: bId });
    await Promise.all([a.connect(), b.connect()]);
    await a.registerPushToken?.({ token: 'ExponentPushToken[device-a]', platform: 'android' });
    await b.registerPushToken?.({ token: 'ExponentPushToken[device-b]', platform: 'ios' });
    await a.addAddress(...alias('a', 'x@circle'));
    await b.addAddress(...alias('b', 'y@circle'));
    await settle();

    // Same circle, two members: nothing joins them. The concession is per-device and stays there.
    expect(registry.get(circleAddr('a', 'x@circle'))?.token).not.toBe(registry.get(circleAddr('b', 'y@circle'))?.token);
    await a.disconnect(); await b.disconnect();
  });
});
