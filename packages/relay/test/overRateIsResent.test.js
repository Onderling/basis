/**
 * A frame the relay refuses as over-rate is re-sent, not lost (ledger L1061).
 *
 * The relay's per-connection token bucket over `send` frames drops an over-rate frame and answers `OVER_RATE`. Until
 * this test, that answer named no frame, so the sender's transport could not tell which envelope was dropped and the
 * app took it as sent. Now the answer names the refused envelope's `_id` (to the sender's own socket only), and the
 * transport re-sends refused frames in order, paced, with a cap on attempts after which the give-up path
 * (`onUndelivered`, as for the relay's `undelivered` frame) is told — a line is never silently gone.
 *
 * Real relay, real RelayTransport clients, real sockets (the seam is crossed, not flanked). A relay that names no
 * frame — an older one — is played by a small proxy that strips the id: the client then behaves as before.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { AgentIdentity } from '@onderling/core';
import { RelayTransport } from '@onderling/transports';
import { startRelay } from '../src/server.js';
import { openClient, send, addr } from './helpers/provenClient.js';

const throwawayVault = () => {
  const store = new Map();
  return { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } };
};
const cleanups = [];
afterEach(async () => { while (cleanups.length) { try { await cleanups.pop()(); } catch { /* best-effort */ } } });
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { if (pred()) return true; await settle(50); }
  return pred();
}

async function client(url, opts = {}) {
  const identity = await AgentIdentity.generate(throwawayVault());
  const tx = new RelayTransport({ identity, relayUrl: url, ...opts });
  const errors = [];
  tx.on('error', (e) => errors.push(String(e?.message ?? e)));
  await tx.connect();
  await waitFor(() => tx.connected, 5_000);
  await settle();
  cleanups.push(() => tx.disconnect());
  return { tx, errors };
}
async function receiver(url) {
  const c = await client(url);
  c.got = [];
  c.at = [];
  c.tx.setReceiveHandler((env) => { if (typeof env?.payload?.n === 'number') { c.got.push(env.payload.n); c.at.push(Date.now()); } });
  return c;
}
async function relayAt(rate) {
  const relay = await startRelay({ port: 0, host: '127.0.0.1', messageRateLimit: rate });
  cleanups.push(() => relay.close?.());
  return { relay, url: `ws://127.0.0.1:${relay.port}` };
}

/** A relay that names no refused frame (an older one): a proxy that strips `id` from every `error` frame. */
async function idStrippingProxy(upstreamUrl) {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((r) => wss.once('listening', r));
  wss.on('connection', (down, req) => {
    // it passes the Host the client dialled on, as a reverse proxy in front of a relay does: the client's proof names
    // that host, and the relay accepts only a proof naming a name of its own
    const up = new WebSocket(upstreamUrl, { headers: { host: req.headers.host } });
    const pending = [];
    up.on('open', () => { while (pending.length) up.send(pending.shift()); });
    down.on('message', (data) => { const s = data.toString(); if (up.readyState === 1) up.send(s); else pending.push(s); });
    up.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'error') delete msg.id;
      if (down.readyState === 1) down.send(JSON.stringify(msg));
    });
    down.on('close', () => up.close());
    up.on('close', () => down.close());
  });
  cleanups.push(() => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(() => r()); }));
  return `ws://127.0.0.1:${wss.address().port}`;
}

const N = 40;

describe('a frame refused as over-rate', () => {
  it('reaches an online receiver all the same: every one of a burst well over the limit arrives, in order', async () => {
    const { url } = await relayAt({ perSec: 20, burst: 5 });
    const rx = await receiver(url);
    const seen = [];
    // the transport's own pace is opened wide here: this is the backstop for a relay STRICTER than the pace (a burst
    // the transport lets through at once is refused there and must still arrive, re-sent in its refusal order)
    const { tx } = await client(url, { onUndelivered: (i) => seen.push(i), sendPace: { perSec: 1000, burst: N } });
    for (let n = 0; n < N; n += 1) await tx.sendOneWay(rx.tx.address, { n, msgId: `line-${n}`, subtype: 'circle-chat' });
    await waitFor(() => rx.got.length >= N, 20_000);
    expect(rx.got.length).toBe(N);
    expect(new Set(rx.got).size).toBe(N);
    // the refused frames went again in the order they were refused, so each one's own order holds after the first burst
    const resent = rx.got.slice(5);
    expect(resent).toEqual([...resent].sort((a, b) => a - b));
    // paced: the re-sends go one at a time at the transport's pace (10/s by default), never as a second burst — the
    // 35 re-sent frames take at least ~34 intervals of 100 ms to arrive (a loaded machine only makes that longer)
    expect(rx.at[N - 1] - rx.at[5]).toBeGreaterThanOrEqual((N - 6) * 100 * 0.8);
    expect(seen).toEqual([]);
  }, 30_000);

  it('is given up after a capped number of attempts, and the give-up path is told which message it was', async () => {
    // a bucket that never refills within the test: every re-send is refused again
    const { url } = await relayAt({ perSec: 0.0001, burst: 1 });
    const rx = await receiver(url);
    const seen = [];
    const { tx } = await client(url, { onUndelivered: (i) => seen.push(i), overRateResend: { delayMs: 50, perSec: 20, maxAttempts: 3 } });
    for (let n = 0; n < 3; n += 1) await tx.sendOneWay(rx.tx.address, { n, msgId: `line-${n}`, subtype: 'circle-chat' });
    await waitFor(() => seen.length >= 2, 10_000);
    expect(rx.got).toEqual([0]);
    expect(seen.map((s) => s.msgId).sort()).toEqual(['line-1', 'line-2']);
    expect(seen[0]).toMatchObject({ reason: 'over-rate', to: rx.tx.address, subtype: 'circle-chat' });
  }, 20_000);

  it('from a relay that names no frame, leaves the client as it was: an error, no re-send', async () => {
    const { url } = await relayAt({ perSec: 0.0001, burst: 2 });
    const proxied = await idStrippingProxy(url);
    const rx = await receiver(url);
    const { tx, errors } = await client(proxied);
    for (let n = 0; n < 6; n += 1) await tx.sendOneWay(rx.tx.address, { n });
    await waitFor(() => errors.filter((e) => /OVER_RATE/.test(e)).length >= 4, 5_000);
    await settle(1_500);
    expect(errors.filter((e) => /OVER_RATE/.test(e))).toHaveLength(4);
    expect(rx.got).toEqual([0, 1]);
  }, 20_000);
});

describe('the relay names the refused frame', () => {
  it('to the sender\'s own socket, by the envelope id, and says nothing else new', async () => {
    const { url } = await relayAt({ perSec: 0.0001, burst: 1 });
    const sender = await openClient(url);
    const other = await openClient(url);
    send(sender, { type: 'register', address: addr('sender') });
    send(other, { type: 'register', address: addr('other') });
    await waitFor(() => sender.messages.some((m) => m.type === 'registered') && other.messages.some((m) => m.type === 'registered'), 3_000);
    const envelope = (id) => ({ _p: 'OW', _id: id, _from: addr('sender'), _to: addr('other'), payload: {} });
    send(sender, { type: 'send', to: addr('other'), envelope: envelope('env-1') });
    send(sender, { type: 'send', to: addr('other'), envelope: envelope('env-2') });
    await waitFor(() => sender.messages.some((m) => m.type === 'error'), 3_000);
    const refusals = sender.messages.filter((m) => m.type === 'error');
    expect(refusals).toEqual([{ type: 'error', message: 'OVER_RATE', id: 'env-2' }]);
    // the receiver hears nothing about it
    expect(other.messages.filter((m) => m.type === 'error')).toEqual([]);
    sender.close(); other.close();
  }, 20_000);
});
