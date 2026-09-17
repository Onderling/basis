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

describe('changing the relay you are on', () => {
  it('connect() to a DIFFERENT url moves the socket — it used to be a silent no-op', async () => {
    // The in-app relay setting (Mij → Relayserver) reconnects by calling connect() with the new url. While
    // a relay was connected that returned early with the OLD state, so the setting appeared to save and
    // changed nothing until the next start — and the panel then reported the old relay as the live one.
    const A = await startRelay({ port: 0, log: false });
    const B = await startRelay({ port: 0, log: false });
    const urlA = `ws://127.0.0.1:${A.port}`, urlB = `ws://127.0.0.1:${B.port}`;
    const anna = await agent();
    try {
      await anna.relay.connect({ relayUrl: urlA, awaitReady: true });
      expect(anna.relay.url).toBe(urlA);

      const moved = await anna.relay.connect({ relayUrl: urlB, awaitReady: true });
      expect(moved.url).toBe(urlB);
      expect(anna.relay.url).toBe(urlB);
      expect(anna.relay.status).toBe('connected');
      // …and the one it left is not still listed as a relay this device is on.
      expect(anna.relays.list().map((r) => r.url)).toEqual([urlB]);

      // Connecting to the SAME url stays the cheap no-op it always was.
      const again = await anna.relay.connect({ relayUrl: urlB });
      expect(again.url).toBe(urlB);
      expect(anna.relays.list()).toHaveLength(1);
    } finally {
      await anna.shutdown(); await A.stop(); await B.stop();
    }
  }, 20000);

  it('an extra relay survives a change of the primary — it belongs to a kring, not to the setting', async () => {
    const A = await startRelay({ port: 0, log: false });
    const B = await startRelay({ port: 0, log: false });
    const C = await startRelay({ port: 0, log: false });
    const urlA = `ws://127.0.0.1:${A.port}`, urlB = `ws://127.0.0.1:${B.port}`, urlC = `ws://127.0.0.1:${C.port}`;
    const anna = await agent();
    try {
      await anna.relay.connect({ relayUrl: urlA, awaitReady: true });
      await anna.relays.add(urlC, { awaitReady: true });
      await anna.relay.connect({ relayUrl: urlB, awaitReady: true });
      expect(anna.relays.list().map((r) => [r.url, r.primary])).toEqual([[urlB, true], [urlC, false]]);
    } finally {
      await anna.shutdown(); await A.stop(); await B.stop(); await C.stop();
    }
  }, 25000);
});

/**
 * A MESSAGE WITH NO CIRCLE — a DM, a receipt — when the person is on a relay that is not my primary.
 *
 * A circle-scoped send names its relay, so it lands (the tests above). A DM carries no circle, so nothing
 * names one, and `route()` then picks `candidates.find(eligible && reachable)` — with `relayTransport`,
 * the PRIMARY, first in that list. `eligibleUnderScope` returns true for everything when the scope is
 * empty, and a relay socket's `reachable` only means "I am connected". So the primary always wins.
 *
 * Nobody notices, because nothing fails. The primary relay ACCEPTS the frame — it cannot know the
 * recipient is not registered with it — and parks it. The message is not lost; it is waiting on a relay
 * the recipient will never dial. The sender is told it was delivered.
 *
 * Which is the point: **the sender cannot know which relay a peer is on.** `canReach` on a relay socket
 * answers a different question. Picking one is a guess, and this is what the guess costs.
 *
 * Seen first as `two-relays.spec.js` STEP4 failing in the browser (2026-09-10); this is the same thing in
 * one file, without a browser.
 */
describe('a circle-less message reaches a peer who is not on my primary relay', () => {
  it('anna (primary A, also on B) writes to bram (B only) with no scope', async () => {
    const A = await startRelay({ port: 0, log: false });
    const B = await startRelay({ port: 0, log: false });
    const urlA = `ws://127.0.0.1:${A.port}`, urlB = `ws://127.0.0.1:${B.port}`;
    const received = [];
    const anna = await agent();
    const bram = await agent((m) => received.push(m));
    try {
      await anna.relay.connect({ relayUrl: urlA, awaitReady: true });
      await anna.relays.add(urlB, { awaitReady: true });
      await bram.relay.connect({ relayUrl: urlB, awaitReady: true });   // bram is ONLY on B
      // Compose it the way the app does: `realAgent` pins the mode when a relay comes up —
      // `sa.setTransportMode(nknLib ? 'both' : 'relay')` — and this run has no NKN, exactly like the
      // browser walk. Without this the agent sits on the factory default ('nkn') with no NKN transport,
      // and every unscoped send is held for a reason that belongs to the harness, not the product.
      anna.setTransportMode('relay');
      bram.setTransportMode('relay');
      expect(anna.relays.list().map((r) => r.url)).toEqual([urlA, urlB]);

      // No scope: this is a DM. Nothing tells the send path which relay bram is on.
      const r = await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'dm', text: 'waar ben je' }, HOLD);

      expect(await until(() => received.find((m) => m.payload?.text === 'waar ben je'), { timeout: 6000 }),
        `bram never got it — the send reported ${JSON.stringify({ delivered: r?.delivered, held: r?.held })}, `
        + 'which is the shape of a message parked on the wrong relay').toBeTruthy();
    } finally {
      await anna.shutdown(); await bram.shutdown();
      await A.stop(); await B.stop();
    }
  }, 30000);
});
