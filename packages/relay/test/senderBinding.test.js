/**
 * Sender binding — the relay refuses to forward an envelope claiming a sender the socket does not own.
 *
 * Boundary authentication, decision 2 (2026-07-31). `_from` on an envelope is free text: a signature
 * proves someone holds a key, never that the key belongs at the address the envelope claims. The relay
 * already knows, per socket, exactly which addresses that socket registered — it just never looked. This
 * file holds the two halves that have to be true together:
 *
 *   • the refusal actually refuses (and says so, and keeps the socket alive), and
 *   • legitimate multi-address traffic still flows — a device with several per-circle addresses (G13)
 *     may speak as ANY of them, and a frame with no `_from` at all is still forwarded.
 *
 * The second half is the one worth guarding. A check that refuses everything would pass a test written
 * only for the first, and would take per-circle addressing down with it.
 *
 * Driven over a real socket against a real relay on port 0, matching `server.test.js`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { startRelay } from '../src/server.js';
import { WsServerTransport } from '../src/WsServerTransport.js';
// Registration is challenge-first since 2026-07-31 (Decision 3): every address below is a real key
// the shared client can prove, and `carla` is a real key NOBODY here holds — which is what makes
// claiming her address the honest version of the attack this file is about.
import { openClient, send, addr } from './helpers/provenClient.js';

async function waitFor(predicate, timeoutMs = 1_000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for predicate (${timeoutMs}ms)`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

describe('relay sender binding — a socket may only send as an address it registered', () => {
  let relay; let url; let anna; let bram;

  beforeEach(async () => {
    relay = await startRelay({ port: 0 });
    url   = `ws://127.0.0.1:${relay.port}`;
    anna  = await openClient(url);
    bram  = await openClient(url);
    send(anna, { type: 'register', address: addr('anna') });
    send(bram, { type: 'register', address: addr('bram') });
    await waitFor(() => anna.messages.some((m) => m.type === 'registered')
                     && bram.messages.some((m) => m.type === 'registered'));
  });

  afterEach(async () => {
    try { anna.close(); } catch { /* */ }
    try { bram.close(); } catch { /* */ }
    await relay.stop();
  });

  // ── The refusal ───────────────────────────────────────────────────────────────────────────────

  it('refuses a frame claiming somebody else’s address, and does not deliver it', async () => {
    // Bram, connected and registered as `bram`, tries to speak to Anna as if he were `carla`.
    send(bram, { type: 'send', to: addr('anna'), envelope: { _p: 'OW', _from: addr('carla'), payload: { text: 'trust me' } } });

    await waitFor(() => bram.messages.some((m) => m.type === 'error' && m.message === 'SENDER_NOT_REGISTERED'));
    await settle();
    expect(anna.messages.filter((m) => m.type === 'message')).toHaveLength(0);
  });

  it('the socket stays open — one bad frame must not take a device’s other circles down with it', async () => {
    send(bram, { type: 'send', to: addr('anna'), envelope: { _p: 'OW', _from: addr('carla'), payload: {} } });
    await waitFor(() => bram.messages.some((m) => m.message === 'SENDER_NOT_REGISTERED'));

    expect(bram.readyState).toBe(1);                       // OPEN
    // …and the very next honest frame still goes through.
    send(bram, { type: 'send', to: addr('anna'), envelope: { _p: 'OW', _from: addr('bram'), payload: { text: 'sorry' } } });
    await waitFor(() => anna.messages.some((m) => m.type === 'message'));
    expect(anna.messages.find((m) => m.type === 'message').envelope.payload.text).toBe('sorry');
  });

  it('refuses a claim from a socket that has registered nothing at all', async () => {
    const stranger = await openClient(url);
    send(stranger, { type: 'send', to: addr('anna'), envelope: { _p: 'OW', _from: addr('anna'), payload: { text: 'echo' } } });

    await waitFor(() => stranger.messages.some((m) => m.message === 'SENDER_NOT_REGISTERED'));
    await settle();
    expect(anna.messages.filter((m) => m.type === 'message')).toHaveLength(0);
    stranger.close();
  });

  it('an offline recipient is not a way around it — the refused frame is not queued either', async () => {
    send(bram, { type: 'send', to: addr('offline-dora'), envelope: { _p: 'OW', _from: addr('carla'), payload: {} } });
    await waitFor(() => bram.messages.some((m) => m.message === 'SENDER_NOT_REGISTERED'));

    const dora = await openClient(url);
    send(dora, { type: 'register', address: addr('offline-dora') });
    await waitFor(() => dora.messages.some((m) => m.type === 'registered'));
    await settle();
    expect(dora.messages.filter((m) => m.type === 'message')).toHaveLength(0);
    dora.close();
  });

  // ── Legitimate traffic still flows ────────────────────────────────────────────────────────────

  it('a device may send as ANY of its per-circle addresses (G13) — several addresses, one socket', async () => {
    // Anna registers two more addresses on the SAME socket, the way a device in several circles does.
    send(anna, { type: 'register', address: addr('anna@oosterpoort') });
    send(anna, { type: 'register', address: addr('anna@voetbalclub') });
    await waitFor(() => anna.messages.filter((m) => m.type === 'registered').length === 3);

    for (const from of ['anna', 'anna@oosterpoort', 'anna@voetbalclub'].map(addr)) {
      send(anna, { type: 'send', to: addr('bram'), envelope: { _p: 'OW', _from: from, payload: { from } } });
    }

    await waitFor(() => bram.messages.filter((m) => m.type === 'message').length === 3);
    await settle();
    expect(anna.messages.filter((m) => m.type === 'error')).toHaveLength(0);
    expect(bram.messages.filter((m) => m.type === 'message').map((m) => m.envelope.payload.from))
      .toEqual(['anna', 'anna@oosterpoort', 'anna@voetbalclub'].map(addr));
  });

  it('an address registered LATER works from that moment — the set is read live, not snapshotted', async () => {
    send(anna, { type: 'send', to: addr('bram'), envelope: { _p: 'OW', _from: addr('anna@later'), payload: {} } });
    await waitFor(() => anna.messages.some((m) => m.message === 'SENDER_NOT_REGISTERED'));

    send(anna, { type: 'register', address: addr('anna@later') });
    await waitFor(() => anna.messages.filter((m) => m.type === 'registered').length === 2);

    send(anna, { type: 'send', to: addr('bram'), envelope: { _p: 'OW', _from: addr('anna@later'), payload: { ok: true } } });
    await waitFor(() => bram.messages.some((m) => m.type === 'message'));
    expect(bram.messages.find((m) => m.type === 'message').envelope.payload).toEqual({ ok: true });
  });

  it('an envelope with no `_from` is still forwarded — the check cannot see a claim, so it makes none', async () => {
    // Not a loophole worth closing here: the receiving SecurityLayer rejects a senderless envelope with
    // UNKNOWN_SENDER before any application sees it. Refusing it at the relay would break the several
    // callers that hand `_put` a bare payload object, and buy nothing.
    send(bram, { type: 'send', to: addr('anna'), envelope: { subtype: 'circle-chat-message', text: 'hoi' } });

    await waitFor(() => anna.messages.some((m) => m.type === 'message'));
    expect(anna.messages.find((m) => m.type === 'message').envelope.text).toBe('hoi');
    expect(bram.messages.filter((m) => m.type === 'error')).toHaveLength(0);
  });

  it('a non-`send` frame is untouched — peer-list still answers after a refusal', async () => {
    send(bram, { type: 'send', to: addr('anna'), envelope: { _p: 'OW', _from: addr('carla'), payload: {} } });
    await waitFor(() => bram.messages.some((m) => m.message === 'SENDER_NOT_REGISTERED'));

    send(bram, { type: 'peer-list' });
    await waitFor(() => bram.messages.some((m) => m.type === 'peer-list' && m.peers.includes(addr('anna'))));
  });
});

// ── group-publish — REMOVED 2026-07-31 ──────────────────────────────────────────────────────────────
//
// Three tests lived here, binding the sender on the relay's OTHER forward path: a `group-publish`
// fan-out claiming another member's address was refused, an honest one still reached the circle, and
// one with no `_from` was still forwarded. They are gone with the frame itself (see the `server.js`
// header): the fan-out carried a `groupId` in cleartext on the wire before the relay decided anything.
// Nothing is un-guarded by their deletion — a broadcast is now N `send` frames, and every one of them
// goes through the `send` binding above.

// ── WsServerTransport — the relay's other wire implementation ──────────────────────────────────────
//
// Same protocol, its own forward path. It used to be documented as weaker than `server.js` — its
// `register` was unauthenticated, so the check only stopped a socket from claiming an address it never
// registered, while an impersonator could simply register the victim's address first. That premise went
// on 2026-07-31: registration here is challenge-first too (Decision 3), so an address in the socket's
// set is one it PROVED, and the binding now says something about a key rather than about a claim.
describe('WsServerTransport sender binding', () => {
  let transport; let url;

  beforeEach(async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    transport = new WsServerTransport({ port: 0, address: id.pubKey });
    await transport.start();
    url = `ws://127.0.0.1:${transport.port}`;
  });

  afterEach(async () => { await transport.stop(); });

  async function registered(address) {
    const ws = await openClient(url);
    send(ws, { type: 'register', address });
    await waitFor(() => ws.messages.some((m) => m.type === 'registered'));
    return ws;
  }

  it('refuses a frame claiming an address the socket never registered', async () => {
    const anna = await registered(addr('anna'));
    const bram = await registered(addr('bram'));

    send(bram, { type: 'send', to: addr('anna'), envelope: { _p: 'OW', _from: addr('carla'), payload: {} } });
    await waitFor(() => bram.messages.some((m) => m.type === 'error' && m.message === 'SENDER_NOT_REGISTERED'));
    await settle();
    expect(anna.messages.filter((m) => m.type === 'message')).toHaveLength(0);
    expect(bram.readyState).toBe(1);

    anna.close(); bram.close();
  });

  it('does not queue a refused frame for an offline recipient either', async () => {
    const bram = await registered(addr('bram'));
    send(bram, { type: 'send', to: addr('offline-dora'), envelope: { _p: 'OW', _from: addr('carla'), payload: {} } });
    await waitFor(() => bram.messages.some((m) => m.message === 'SENDER_NOT_REGISTERED'));

    const dora = await registered(addr('offline-dora'));
    await settle();
    expect(dora.messages.filter((m) => m.type === 'message')).toHaveLength(0);

    bram.close(); dora.close();
  });

  it('a device speaking as any of its several registered addresses still gets through', async () => {
    const anna = await registered(addr('anna'));
    send(anna, { type: 'register', address: addr('anna@oosterpoort') });
    await waitFor(() => anna.messages.filter((m) => m.type === 'registered').length === 2);
    const bram = await registered(addr('bram'));

    for (const from of ['anna', 'anna@oosterpoort'].map(addr)) {
      send(anna, { type: 'send', to: addr('bram'), envelope: { _p: 'OW', _from: from, payload: { from } } });
    }

    await waitFor(() => bram.messages.filter((m) => m.type === 'message').length === 2);
    expect(anna.messages.filter((m) => m.type === 'error')).toHaveLength(0);
    expect(bram.messages.filter((m) => m.type === 'message').map((m) => m.envelope.payload.from))
      .toEqual(['anna', 'anna@oosterpoort'].map(addr));

    anna.close(); bram.close();
  });

  it('an envelope with no `_from` is still forwarded', async () => {
    const anna = await registered(addr('anna'));
    const bram = await registered(addr('bram'));

    send(bram, { type: 'send', to: addr('anna'), envelope: { subtype: 'circle-chat-message', text: 'hoi' } });
    await waitFor(() => anna.messages.some((m) => m.type === 'message'));
    expect(anna.messages.find((m) => m.type === 'message').envelope.text).toBe('hoi');

    anna.close(); bram.close();
  });
});
