/**
 * RelayTransport — push-control extensions (E2c).
 *
 * Targeted fixture that handles `register-push-token` /
 * `unregister-push-token` so we can exercise the ack flow.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
// The fixture has to CHALLENGE — see RelayTransport.test.js.
import { newAddressChallenge, verifyAddressPossession } from '../src/identity/addressPossession.js';

import { AgentIdentity }   from '../src/identity/AgentIdentity.js';
import { VaultMemory }     from '@onderling/vault';
import { RelayTransport }  from '@onderling/transports';

function startPushFixture({ rejectRegister = false, dropAcks = false } = {}) {
  const wss     = new WebSocketServer({ port: 0 });
  const tokens  = new Map();   // address → {token, platform}
  const events  = [];          // observed control frames

  wss.on('connection', (ws) => {
    let address = null;
    const open = new Map();               // nonce → address, single use
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      events.push(msg);

      if (msg.type === 'register') {
        const nonce = newAddressChallenge();
        open.set(nonce, msg.address);
        ws.send(JSON.stringify({ type: 'challenge', address: msg.address, nonce }));
        return;
      }
      if (msg.type === 'register-proof') {
        if (open.get(msg.nonce) !== msg.address || !verifyAddressPossession(msg)) {
          ws.send(JSON.stringify({ type: 'error', message: 'PROOF_INVALID' }));
          return;
        }
        open.delete(msg.nonce);
        address = msg.address;
        ws.send(JSON.stringify({ type: 'registered', address }));
        return;
      }
      if (msg.type === 'register-push-token') {
        if (!address) {
          ws.send(JSON.stringify({ type: 'error', message: 'register-push-token requires register first' }));
          return;
        }
        if (rejectRegister) {
          ws.send(JSON.stringify({ type: 'error', message: 'register-push-token: token required' }));
          return;
        }
        tokens.set(address, { token: msg.token, platform: msg.platform });
        if (!dropAcks) ws.send(JSON.stringify({ type: 'push-token-registered' }));
        return;
      }
      if (msg.type === 'unregister-push-token') {
        if (address) tokens.delete(address);
        if (!dropAcks) ws.send(JSON.stringify({ type: 'push-token-unregistered' }));
        return;
      }
    });
  });

  const url = () => `ws://127.0.0.1:${wss.address().port}`;
  const stop = () => new Promise((resolve) => {
    for (const c of wss.clients) c.terminate();
    wss.close(resolve);
  });
  return new Promise((resolve) => {
    wss.once('listening', () => resolve({ url: url(), stop, tokens, events }));
  });
}

async function makeTransport(relayUrl) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const t  = new RelayTransport({ relayUrl, identity: id });
  await t.connect();
  return { t, id };
}

describe('RelayTransport — push-control (E2c)', () => {
  let fixture;
  beforeEach(async () => { fixture = await startPushFixture(); });
  afterEach(async  () => { await fixture.stop(); });

  it('registerPushToken stores token at the relay and resolves on ack', async () => {
    const { t, id } = await makeTransport(fixture.url);
    await t.registerPushToken({ token: 'tok-1', platform: 'ios' });
    expect(fixture.tokens.get(id.pubKey)).toEqual({ token: 'tok-1', platform: 'ios' });
    await t.disconnect();
  });

  it('unregisterPushToken removes the entry and resolves on ack', async () => {
    const { t, id } = await makeTransport(fixture.url);
    await t.registerPushToken({ token: 'tok-1', platform: 'ios' });
    await t.unregisterPushToken();
    expect(fixture.tokens.has(id.pubKey)).toBe(false);
    await t.disconnect();
  });

  it('rejects when called without a token', async () => {
    const { t } = await makeTransport(fixture.url);
    await expect(t.registerPushToken({})).rejects.toThrow(/token required/);
    await t.disconnect();
  });

  it('relay-side error rejects the in-flight register call', async () => {
    await fixture.stop();
    fixture = await startPushFixture({ rejectRegister: true });
    const { t } = await makeTransport(fixture.url);
    await expect(t.registerPushToken({ token: 'tok-1' }))
      .rejects.toThrow(/token required/);
    await t.disconnect();
  });

  it('rejects on timeout when relay never sends an ack', async () => {
    await fixture.stop();
    fixture = await startPushFixture({ dropAcks: true });
    const { t } = await makeTransport(fixture.url);
    await expect(t.registerPushToken({ token: 'tok-1' }))
      .rejects.toThrow(/did not acknowledge/);
    await t.disconnect();
  }, 7_000);

  it('rejects in-flight calls when transport disconnects', async () => {
    await fixture.stop();
    fixture = await startPushFixture({ dropAcks: true });
    const { t } = await makeTransport(fixture.url);
    const p = t.registerPushToken({ token: 'tok-1' });
    // Disconnect before the timeout fires.
    setTimeout(() => { t.disconnect(); }, 30);
    await expect(p).rejects.toThrow(/disconnected before ack/);
  });
});
