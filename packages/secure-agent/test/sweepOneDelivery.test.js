/**
 * THE RELAY SWEEP: EVERY RELAY ONCE, NEVER THE PRIMARY TWICE, AND NO FALSE 'DID NOT ARRIVE'. A device on more than one
 * relay tries them in turn for a message that names no route (`_sendWithFailover`'s sweep). A relay's one-way send
 * answers nothing when it went out, so the sweep never saw a success: it sent on every relay whose handshake passed,
 * then fell through to the budget loop and sent AGAIN on the primary (the handshake cache is shared, so the primary's
 * handshake passed too).
 *
 * Now: the relay the peer last spoke to us on first, then the primary, then the others; each relay ONCE (a relay taking
 * a message says nothing about the peer, and where they last spoke may no longer be theirs); never the primary again.
 * A relay the person is not on keeps a copy until its TTL; its give-up is reported only when EVERY relay that took the
 * message has given up (`relayGaveUp`), so a message that arrived is never marked 'did not arrive'.
 *
 * Counted at the relays: the message's own envelopes (one-way, `_p: 'OW'`) addressed to the receiver, per relay. A
 * relay with `queueCap: 1` gives up the older of two queued messages at once (a cap give-up: the same frame as the TTL's).
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { startRelay } from '@onderling/relay';
import { createSecureAgent } from '../src/createSecureAgent.js';

const FAST = { firstSendTimeoutMs: 2500, retryDelays: [] };

/** A relay that counts the one-way envelopes it is handed, per recipient. */
async function countingRelay(opts = {}) {
  const R = await startRelay({ port: 0, log: false, ...opts });
  const ow = new Map();
  R.wss.on('connection', (ws) => ws.on('message', (raw) => {
    let msg = null;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg?.type === 'send' && msg.envelope?._p === 'OW') ow.set(msg.to, (ow.get(msg.to) ?? 0) + 1);
  }));
  return { R, url: `ws://127.0.0.1:${R.port}`, owTo: (addr) => ow.get(addr) ?? 0 };
}
async function until(pred, { timeout = 4000, step = 20 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = pred(); if (v) return v; await new Promise((r) => { setTimeout(r, step); }); }
  return pred();
}
const settle = (ms = 300) => new Promise((res) => { setTimeout(res, ms); });

/** Anna on A (primary) and B; bram on `bramOn`. */
async function world({ bramOn, relayOpts = {} }) {
  const A = await countingRelay(relayOpts);
  const B = await countingRelay(relayOpts);
  const received = [];
  const undelivered = [];
  const anna = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, relayReadyTimeoutMs: 3000, onUndelivered: (u) => undelivered.push(u) });
  const bram = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, relayReadyTimeoutMs: 3000, onPeerMessage: (m) => received.push(m) });
  await anna.relay.connect({ relayUrl: A.url, awaitReady: true });
  await anna.relays.add(B.url, { awaitReady: true });
  anna.setTransportMode('relay');
  const urls = bramOn.map((k) => ({ A, B })[k].url);
  await bram.relay.connect({ relayUrl: urls[0], awaitReady: true });
  for (const u of urls.slice(1)) await bram.relays.add(u, { awaitReady: true });
  bram.setTransportMode('relay');
  const to = bram.identity.pubKey;
  const counts = () => ({ A: A.owTo(to), B: B.owTo(to) });
  const got = (id) => until(() => received.some((m) => m.payload?.msgId === id));
  const close = async () => { await anna.shutdown(); await bram.shutdown().catch(() => {}); await A.R.stop(); await B.R.stop(); };
  return { A, B, anna, bram, to, counts, got, received, undelivered, close };
}

describe('the relay sweep: every relay once, never the primary twice', () => {
  it('a peer on the second relay only: the first message once there; later ones once on each relay, never the primary twice', async () => {
    const w = await world({ bramOn: ['B'] });
    try {
      await w.anna.peer.sendTo(w.to, { subtype: 'note', msgId: 'once-1' }, FAST);
      expect(await w.got('once-1')).toBeTruthy();
      await settle();
      // the first contact: A's handshake fails (bram is not there), B takes it
      expect(w.counts(), 'one envelope, on the relay the peer is on').toEqual({ A: 0, B: 1 });
      // the handshake is cached now: each relay takes the next one ONCE (B first, where bram spoke), the primary not twice
      await w.anna.peer.sendTo(w.to, { subtype: 'note', msgId: 'once-2' }, FAST);
      expect(await w.got('once-2')).toBeTruthy();
      await settle();
      expect(w.counts()).toEqual({ A: 1, B: 2 });
      expect(w.undelivered).toEqual([]);
    } finally { await w.close(); }
  }, 30_000);

  it('a peer on both relays: each relay once per message, the primary never twice', async () => {
    const w = await world({ bramOn: ['A', 'B'] });
    try {
      await w.anna.peer.sendTo(w.to, { subtype: 'note', msgId: 'both-1' }, FAST);
      expect(await w.got('both-1')).toBeTruthy();
      await settle();
      expect(w.counts()).toEqual({ A: 1, B: 1 });
      await w.anna.peer.sendTo(w.to, { subtype: 'note', msgId: 'both-2' }, FAST);
      expect(await w.got('both-2')).toBeTruthy();
      await settle();
      expect(w.counts()).toEqual({ A: 2, B: 2 });
    } finally { await w.close(); }
  }, 30_000);

  it('a relay socket replaced after the peer was heard on it: every relay still once, and it arrives', async () => {
    const w = await world({ bramOn: ['B'] });
    try {
      await w.anna.peer.sendTo(w.to, { subtype: 'note', msgId: 'r-1' }, FAST);
      expect(await w.got('r-1')).toBeTruthy();
      await w.anna.relays.remove(w.B.url);
      await w.anna.relays.add(w.B.url, { awaitReady: true });
      const before = w.counts();
      await w.anna.peer.sendTo(w.to, { subtype: 'note', msgId: 'r-2' }, FAST);
      expect(await w.got('r-2'), 'it arrived').toBeTruthy();
      await settle();
      const after = w.counts();
      expect({ A: after.A - before.A, B: after.B - before.B }).toEqual({ A: 1, B: 1 });
    } finally { await w.close(); }
  }, 30_000);
});

describe("no false 'did not arrive'", () => {
  it('a peer on B only: the primary giving up its copy reports nothing (B delivered it)', async () => {
    const w = await world({ bramOn: ['B'], relayOpts: { queueCap: 1 } });
    try {
      await w.anna.peer.sendTo(w.to, { subtype: 'note', msgId: 'g-0' }, FAST);       // first contact: B only
      expect(await w.got('g-0')).toBeTruthy();
      await w.anna.peer.sendTo(w.to, { subtype: 'note', msgId: 'g-1' }, FAST);       // A and B take it; A queues it
      await w.anna.peer.sendTo(w.to, { subtype: 'note', msgId: 'g-2' }, FAST);       // A queues this one: g-1 given up there
      expect(await w.got('g-2')).toBeTruthy();
      await settle(800);
      expect(w.received.some((m) => m.payload?.msgId === 'g-1'), 'g-1 arrived through B').toBe(true);
      // (A also drops the handshake envelopes it queued at first contact: control traffic, reported by envelope id with no
      // message id, as today; the shells log those and paint no bubble)
      expect(w.undelivered.filter((u) => u.msgId === 'g-1'), 'A\'s give-up for g-1 is not reported').toEqual([]);
    } finally { await w.close(); }
  }, 30_000);

  it('a peer on neither relay for the whole hold: reported once, after BOTH relays gave it up', async () => {
    const w = await world({ bramOn: ['B'], relayOpts: { queueCap: 1 } });
    try {
      await w.anna.peer.sendTo(w.to, { subtype: 'note', msgId: 'n-0' }, FAST);       // the handshake, then bram leaves
      expect(await w.got('n-0')).toBeTruthy();
      await w.bram.shutdown();
      await settle(500);
      await w.anna.peer.sendTo(w.to, { subtype: 'note', msgId: 'n-1' }, FAST);       // both relays queue it
      await settle();
      expect(w.counts(), 'each relay took n-1 once').toEqual({ A: 1, B: 2 });
      await w.anna.peer.sendTo(w.to, { subtype: 'note', msgId: 'n-2' }, FAST);       // both give n-1 up (cap 1)
      await until(() => w.undelivered.some((u) => u.msgId === 'n-1'), { timeout: 5000 });
      await settle(800);
      expect(w.undelivered.filter((u) => u.msgId === 'n-1'), "one 'did not arrive', after both gave up").toHaveLength(1);
    } finally { await w.close(); }
  }, 30_000);
});
