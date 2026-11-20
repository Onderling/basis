/**
 * THE RELAY TRANSPORT PACES ITS OWN SENDS UNDER THE RELAY'S LIMIT (the start burst, 2026-11-20).
 *
 * The relay refuses a `send` frame over its per-connection rate (a token bucket: 30 a second, a burst of 60) with
 * OVER_RATE. A cold start sends hundreds of frames at once (every lane's catch-up to every member of every circle) and
 * was refused from ~25 s, re-sent later, slow. The transport now holds what is over its own rate and sends it as the
 * bucket allows: a burst is never refused. And what a person waits on goes ahead of background sends (catch-ups,
 * re-announces): a line typed during a start's catch-up must not wait behind hundreds of frames.
 *
 * The relay here is a stand-in with the real relay's rule (register, challenge, proof; a token bucket on `send`).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';
import { AgentIdentity, newAddressChallenge, verifyAddressPossession } from '@onderling/core';
import { RelayTransport, RELAY_SEND_RATE } from '../src/RelayTransport.js';

const throwawayVault = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
async function waitFor(pred, ms = 20_000) {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error(`timeout (${ms}ms)`); await new Promise((r) => setTimeout(r, 20)); }
}

/** A relay with the real relay's rate rule: a token bucket per connection on `send` frames, OVER_RATE past it. */
function ratedRelay({ perSec = 30, burst = 60 } = {}) {
  const wss = new WebSocketServer({ port: 0 });
  const state = { sends: [], refused: 0, sockets: [] };
  wss.on('connection', (ws) => {
    state.sockets.push(ws);
    const open = new Map();
    let tokens = burst; let at = Date.now();
    const take = () => { const now = Date.now(); tokens = Math.min(burst, tokens + ((now - at) * perSec) / 1000); at = now; if (tokens >= 1) { tokens -= 1; return true; } return false; };
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'register') {
        const nonce = newAddressChallenge(); open.set(nonce, msg.address);
        ws.send(JSON.stringify({ type: 'challenge', address: msg.address, nonce }));
        return;
      }
      if (msg.type === 'register-proof') {
        const address = open.get(msg.nonce); open.delete(msg.nonce);
        if (address !== msg.address || !verifyAddressPossession(msg)) return;
        ws.send(JSON.stringify({ type: 'registered', address }));
        return;
      }
      if (msg.type === 'send') {
        if (!take()) { state.refused += 1; ws.send(JSON.stringify({ type: 'error', message: 'OVER_RATE', ...(msg.envelope?._id ? { id: msg.envelope._id } : {}) })); return; }
        state.sends.push({ at: Date.now(), n: msg.envelope?.payload?.n, fg: msg.envelope?.payload?.fg === true });
      }
    });
  });
  state.url = `ws://127.0.0.1:${wss.address().port}`;
  state.stop = () => new Promise((r) => wss.close(r));
  return state;
}

let relay; let tx;
afterEach(async () => { try { await tx?.disconnect(); } catch { /* */ } await relay?.stop(); relay = null; tx = null; });

async function connected() {
  const identity = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
  tx = new RelayTransport({ relayUrl: relay.url, identity });
  await tx.connect();
  return tx;
}

describe('the relay transport paces its own sends', () => {
  it('a burst of 200 sends is never refused, and arrives in order', async () => {
    relay = ratedRelay();
    await connected();
    const to = 'x'.repeat(43);
    await Promise.all(Array.from({ length: 200 }, (_, n) => tx.sendOneWay(to, { n })));
    await waitFor(() => relay.sends.length + relay.refused >= 200 && relay.sends.length >= 200 - relay.refused);
    await waitFor(() => relay.sends.length >= 200, 30_000).catch(() => {});
    expect(relay.refused, 'frames the relay refused as over its rate').toBe(0);
    expect(relay.sends.map((s) => s.n)).toEqual(Array.from({ length: 200 }, (_, n) => n));
  }, 40_000);

  it('what a person waits on goes ahead of background sends: one line after 300 catch-up frames leaves within a second', async () => {
    relay = ratedRelay();
    await connected();
    const to = 'y'.repeat(43);
    const bg = Array.from({ length: 300 }, (_, n) => tx.sendOneWay(to, { n }, { background: true }));
    await new Promise((r) => setTimeout(r, 50));
    const t0 = Date.now();
    const fg = tx.sendOneWay(to, { n: 'typed', fg: true });
    await waitFor(() => relay.sends.some((s) => s.fg), 15_000);
    const took = relay.sends.find((s) => s.fg).at - t0;
    expect(took, `the typed line left after ${took} ms`).toBeLessThan(1000);
    await Promise.all([fg, ...bg]);
    await waitFor(() => relay.sends.length >= 301, 30_000);
    expect(relay.refused, 'nothing refused on the way').toBe(0);
  }, 60_000);

  it('frames waiting for a token when the socket drops are refused, as a send while offline is; none is written after the reconnect', async () => {
    relay = ratedRelay();
    await connected();
    const to = 'z'.repeat(43);
    // the burst goes at once; the next 60 wait for tokens
    const burst = RELAY_SEND_RATE.burst;
    const sends = Array.from({ length: burst + 60 }, (_, n) => tx.sendOneWay(to, { n }).then(() => 'sent', (err) => `refused: ${err?.message ?? err}`));
    await waitFor(() => relay.sends.length >= burst, 5_000);
    for (const ws of relay.sockets) ws.terminate();
    const outcomes = await Promise.race([Promise.all(sends), new Promise((r) => setTimeout(() => r(null), 5_000))]);
    expect(outcomes, 'every waiting send ended within 5 s of the drop').not.toBeNull();
    const refused = outcomes.filter((o) => o.startsWith('refused'));
    expect(refused.length, 'the frames waiting for a token were refused').toBe(60);
    expect(refused.every((o) => /not connected/i.test(o)), refused[0]).toBe(true);
    await waitFor(() => tx.connected, 10_000);
    await new Promise((r) => setTimeout(r, 1_500));
    const late = relay.sends.filter((x) => x.n >= burst + 2);
    expect(late.length, 'nothing that was refused is written after the reconnect').toBe(0);
  }, 40_000);
});
