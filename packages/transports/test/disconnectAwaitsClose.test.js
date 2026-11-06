/**
 * DISCONNECT MEANS CLOSED. `disconnect()` used to start the socket's close and return at once; until the relay had
 * processed the close, the socket was still a holder of every address it had registered — and a frame for one of them
 * could be handed to a device that had already stopped reading (walked: a feedback turn went to a phone being turned
 * off, the relay said delivered, the person's other device never saw it). A caller that awaits `disconnect()` — the
 * box's stop, a shutdown, a walk's teardown — now knows the relay no longer counts this socket.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { AgentIdentity, newAddressChallenge } from '@onderling/core';
import { RelayTransport } from '../src/RelayTransport.js';

const throwawayVault = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

/** A relay that acks every registration and counts the closes it has seen. */
function stubRelay() {
  const wss = new WebSocketServer({ port: 0 });
  let closes = 0;
  wss.on('connection', (ws) => {
    ws.on('close', () => { closes += 1; });
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'register') { ws.send(JSON.stringify({ type: 'challenge', address: msg.address, nonce: newAddressChallenge() })); return; }
      if (msg.type === 'register-proof') ws.send(JSON.stringify({ type: 'registered', address: msg.address }));
    });
  });
  return {
    port: wss.address().port,
    closes: () => closes,
    clients: () => wss.clients.size,
    close: () => new Promise((r) => wss.close(() => r())),
  };
}

describe('disconnect resolves once the socket is closed at the relay', () => {
  let stub = null; let tx = null;
  afterEach(async () => { try { await tx?.disconnect?.(); } catch { /* */ } tx = null; await stub?.close(); stub = null; });

  it('after `await disconnect()` the relay has seen the close and holds no socket of ours', async () => {
    stub = stubRelay();
    const identity = await AgentIdentity.generate(throwawayVault());
    tx = new RelayTransport({ identity, relayUrl: `ws://127.0.0.1:${stub.port}` });
    await tx.connect();
    for (let i = 0; i < 40 && !tx.connected; i++) await settle(50);
    expect(tx.connected, 'connected first').toBe(true);
    expect(stub.clients()).toBe(1);

    await tx.disconnect();
    // no settle: the promise itself is the guarantee
    expect(stub.closes(), 'the relay saw the close before disconnect resolved').toBe(1);
    expect(stub.clients(), 'no socket of ours is left at the relay').toBe(0);
  });

  it('a disconnect with no socket open resolves at once', async () => {
    stub = stubRelay();
    const identity = await AgentIdentity.generate(throwawayVault());
    tx = new RelayTransport({ identity, relayUrl: `ws://127.0.0.1:${stub.port}` });
    await tx.disconnect();
    expect(stub.closes()).toBe(0);
  });
});
