/**
 * More than one relay at a time (2026-09-08).
 *
 * The device's own default relay is the PRIMARY (`sa.relay`); every relay a circle it is in rides is one
 * more socket (`sa.relays.add`). Two REAL in-process relays here — the question is whether a circle scoped
 * to relay B is carried over B while the device also sits on A, and whether the alias half of the port is
 * reachable per relay so registration can stay scoped (a relay learns only its own circles).
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { startRelay } from '@onderling/relay';
import { createSecureAgent } from '../src/createSecureAgent.js';

const FAST = { firstSendTimeoutMs: 2500, retryDelays: [] };
const HOLD = { ...FAST, guarantee: 'hold-forward' };

async function agent(onPeerMessage) {
  return createSecureAgent({ vault: new VaultMemory(), onPeerMessage, warnOnInsecure: false, relayReadyTimeoutMs: 3000 });
}
async function until(pred, { timeout = 4000, step = 20 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = pred();
    if (v) return v;
    await new Promise((r) => setTimeout(r, step));
  }
  return pred();
}

describe('sa.relays — the primary plus the relays my circles ride', () => {
  it('a circle scoped to relay B is carried over B while the device also sits on A; the list names both', async () => {
    const A = await startRelay({ port: 0, log: false });
    const B = await startRelay({ port: 0, log: false });
    const urlA = `ws://127.0.0.1:${A.port}`, urlB = `ws://127.0.0.1:${B.port}`;
    const received = [];
    const anna = await agent();
    const bram = await agent((m) => received.push(m));
    try {
      await anna.relay.connect({ relayUrl: urlA, awaitReady: true });
      const added = await anna.relays.add(urlB, { awaitReady: true });
      expect(added.primary).toBe(false);
      expect(added.connected).toBe(true);
      expect(anna.relays.list().map((r) => [r.url, r.primary])).toEqual([[urlA, true], [urlB, false]]);
      expect(anna.relays.has(urlB)).toBe(true);
      // Adding the primary again, or B again, is idempotent — one socket per url.
      expect((await anna.relays.add(urlA)).primary).toBe(true);
      await anna.relays.add(urlB);
      expect(anna.relays.list()).toHaveLength(2);
      // Adding a relay must not flip a relay-only device into 'both' (unscoped sends stay pinned).
      anna.setTransportMode('relay');
      await anna.relays.add(urlB);
      expect(anna.transportMode).toBe('relay');

      // Bram is ONLY on B.
      await bram.relay.connect({ relayUrl: urlB, awaitReady: true });

      const r = await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'circle', text: 'over B' },
        { ...HOLD, scope: { points: [urlB], requireAliasCapable: true } });
      expect(r.delivered).toBe(true);
      expect(await until(() => received.find((m) => m.payload?.text === 'over B'))).toBeTruthy();

      // The alias half is per relay: registering on B does not touch A.
      const entryB = anna.relays.list().find((e) => e.url === urlB);
      expect(entryB.port.supportsAliases).toBe(true);
      expect(typeof entryB.port.addAddress).toBe('function');

      // Removing B leaves the primary alone.
      await anna.relays.remove(urlB);
      expect(anna.relays.list().map((r) => r.url)).toEqual([urlA]);
      expect(anna.relay.status).toBe('connected');
    } finally {
      await anna.shutdown(); await bram.shutdown();
      await A.stop(); await B.stop();
    }
  }, 20000);

  it('a scope naming a relay the device is NOT on has no live route — it is held, not misrouted over A', async () => {
    const A = await startRelay({ port: 0, log: false });
    const urlA = `ws://127.0.0.1:${A.port}`;
    const anna = await agent();
    const bram = await agent();
    try {
      await anna.relay.connect({ relayUrl: urlA, awaitReady: true });
      await bram.relay.connect({ relayUrl: urlA, awaitReady: true });
      const r = await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'circle', text: 'nowhere' },
        { ...HOLD, scope: { points: ['ws://127.0.0.1:1'], requireAliasCapable: true } });
      expect(r.delivered).toBe(false);
    } finally {
      await anna.shutdown(); await bram.shutdown(); await A.stop();
    }
  }, 20000);
});
