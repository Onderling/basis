// @reads-source: this test reads source as text, so rung 1 runs it (docs/conventions/verification-ladder.md).
/**
 * A FRAME THE RELAY REFUSED, OR NEVER ANSWERED, IS NEITHER HELD FOR EVER NOR LOST IN SILENCE (the independent read of
 * 2026-11-20, findings 6 and 7).
 *
 * The over-rate re-send keeps a refused frame and sends it again, paced. Three holes were left: (1) while the socket is
 * down a refused frame waited with no age limit, though a receiver drops a frame older than its replay window (ten
 * minutes) and the sender was never told; (2) the waiting queue had no cap of its own; (3) a frame written just before
 * the socket closed, whose refusal never arrived, was forgotten. Now: a frame too old to be taken is given up and said;
 * a frame over the cap is given up and said; a frame left unanswered by a closing socket is sent once more on the next
 * one (a receiver drops a copy it already has by its id).
 *
 * The relay here is a stand-in that registers by the real proof, then refuses or takes `send` frames as each test says.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AgentIdentity, newAddressChallenge, verifyAddressPossession } from '@onderling/core';
import { RelayTransport, OVER_RATE_MAX_AGE_MS } from '../src/RelayTransport.js';

const throwawayVault = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
async function waitFor(pred, ms = 10_000) {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error(`timeout (${ms}ms)`); await new Promise((r) => setTimeout(r, 20)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A relay that answers `send` as `state.mode` says: 'refuse' (OVER_RATE) or 'take'; `state.answerRegister` false = offline. */
function scriptedRelay() {
  const wss = new WebSocketServer({ port: 0 });
  const state = { mode: 'take', answerRegister: true, sockets: [], taken: [] };
  wss.on('connection', (ws) => {
    state.sockets.push(ws);
    const socketNo = state.sockets.length;
    const open = new Map();
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'register') {
        if (!state.answerRegister) return;
        const nonce = newAddressChallenge(); open.set(nonce, msg.address);
        ws.send(JSON.stringify({ type: 'challenge', address: msg.address, nonce }));
        return;
      }
      if (msg.type === 'register-proof') {
        const address = open.get(msg.nonce); open.delete(msg.nonce);
        if (address !== msg.address || !verifyAddressPossession({ ...msg, isOwnRelayName: () => true })) return;
        ws.send(JSON.stringify({ type: 'registered', address }));
        return;
      }
      if (msg.type === 'send') {
        if (state.mode === 'refuse') { ws.send(JSON.stringify({ type: 'error', message: 'OVER_RATE', id: msg.envelope?._id })); return; }
        state.taken.push({ socketNo, n: msg.envelope?.payload?.n, id: msg.envelope?._id });
      }
    });
  });
  state.url = `ws://127.0.0.1:${wss.address().port}`;
  state.dropAll = () => { for (const ws of state.sockets) ws.terminate(); };
  state.stop = () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(r); });
  return state;
}

let relay; let tx;
afterEach(async () => { try { await tx?.disconnect(); } catch { /* */ } await relay?.stop(); relay = null; tx = null; });

async function connected(opts = {}) {
  const identity = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
  const gaveUp = [];
  tx = new RelayTransport({ relayUrl: relay.url, identity, onUndelivered: (i) => gaveUp.push(i), ...opts });
  await tx.connect();
  return gaveUp;
}
const TO = 'q'.repeat(43);

describe('the refused queue has an age limit and a cap', () => {
  it('the age limit sits under the receivers\' replay window, so a re-sent frame can still be taken', async () => {
    // the two layers hold one fact (how old a frame may be and still be taken): pin the agreement, read from the source
    const src = readFileSync(fileURLToPath(new URL('../../core/src/security/SecurityLayer.js', import.meta.url)), 'utf8');
    const m = /key: 'security\.replayWindowMs'[^\n]*default: ([0-9_ *]+)\}/.exec(src);
    expect(m, 'the replay window\'s declaration').not.toBeNull();
    const replayWindowMs = Function(`return (${m[1].replace(/_/g, '')})`)();
    expect(Number(OVER_RATE_MAX_AGE_MS)).toBeGreaterThan(0);
    expect(Number(OVER_RATE_MAX_AGE_MS)).toBeLessThan(replayWindowMs);
  });

  it('a refused frame waiting while the socket is down is given up, and said, once it is too old to be taken', async () => {
    relay = scriptedRelay();
    const gaveUp = await connected({ overRateResend: { delayMs: 100, maxAgeMs: 400 } });
    relay.mode = 'refuse';
    await tx.sendOneWay(TO, { n: 1 });
    await sleep(50);                       // the refusal arrives and the frame is queued
    relay.answerRegister = false;          // after the drop the relay never registers again: the socket stays down
    relay.dropAll();
    await waitFor(() => gaveUp.length > 0, 3_000);
    expect(gaveUp[0]).toMatchObject({ reason: 'over-rate-too-old', to: TO });
  }, 15_000);

  it('a refused frame past the queue\'s cap is given up and said, not held', async () => {
    relay = scriptedRelay();
    const gaveUp = await connected({ overRateResend: { delayMs: 10_000, maxQueued: 3 } });
    relay.mode = 'refuse';
    for (let n = 0; n < 5; n++) await tx.sendOneWay(TO, { n });
    await waitFor(() => gaveUp.length >= 2, 3_000);
    expect(gaveUp.map((g) => g.reason)).toEqual(['over-rate-queue-full', 'over-rate-queue-full']);
  }, 15_000);
});

describe('a frame left unanswered by a closing socket', () => {
  it('is sent once more on the next socket; an older one, long answered, is not', async () => {
    relay = scriptedRelay();
    const gaveUp = await connected({ unansweredAtCloseMs: 300 });
    await tx.sendOneWay(TO, { n: 'old' });
    await sleep(600);                      // past the window: its refusal would have come
    await tx.sendOneWay(TO, { n: 'last' });
    relay.dropAll();                       // closes before any answer could arrive
    await waitFor(() => relay.taken.some((t) => t.socketNo === 2), 10_000);
    await sleep(300);
    const second = relay.taken.filter((t) => t.socketNo === 2).map((t) => t.n);
    expect(second, 'the unanswered frame, once, on the next socket').toEqual(['last']);
    expect(gaveUp).toEqual([]);
  }, 20_000);
});
