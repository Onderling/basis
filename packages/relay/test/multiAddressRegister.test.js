/**
 * G13 step A — ONE socket, SEVERAL addresses.
 *
 * A member presents a different address in every circle. For those addresses to be routable the relay has
 * to accept more than one per connection. Per `docs/decisions.md` (2026-07-27) the promise is *"unlinkable
 * to everyone except the one relay you chose"* — the relay correlates your circles anyway via the shared
 * push token, so **one connection carrying N addresses is both the cheap and the correct shape**. N sockets
 * would cost N connections and hide nothing.
 *
 * What must hold, and each is a way this could go wrong:
 *   • every address routes to the same live socket, and a message to ANY of them arrives;
 *   • the connection-quota counts DEVICES, not addresses — otherwise being in five circles exhausts a cap
 *     meant to count phones;
 *   • closing takes ALL of them down — a leftover entry routes to a dead socket, silently;
 *   • hold-forward drains PER REGISTRATION, so there is no race about which address registers first;
 *   • a push token covers every address the socket owns, including ones registered later (decision 2a) —
 *     a missed address is a circle whose offline members silently stop being woken (the G15 failure).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { startRelay } from '../src/server.js';
import { PushSender } from '../src/push/PushSender.js';
import { PushTokenRegistry } from '../src/push/PushTokenRegistry.js';

class FakePushSender extends PushSender {
  constructor() { super(); this.calls = []; }
  async send(token, payload, opts) { this.calls.push({ token, payload, opts }); return { ok: true }; }
}

const openClient = (url) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  ws.messages = [];
  ws.on('message', (raw) => { try { ws.messages.push(JSON.parse(raw)); } catch { /* not ours */ } });
  ws.once('open', () => resolve(ws));
  ws.once('error', reject);
});
const send = (ws, o) => ws.send(JSON.stringify(o));
const settle = () => new Promise((r) => setTimeout(r, 80));
async function waitFor(pred, ms = 1_500) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout (${ms}ms)`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
/** Anna's per-circle addresses — one identity per circle, as the design intends. */
const ANNA_X = 'anna@circle-x';
const ANNA_Y = 'anna@circle-y';
const BRAM = 'bram-addr';

describe('one socket, several addresses', () => {
  let relay; let url; let pushSender; let registry;

  beforeEach(async () => {
    pushSender = new FakePushSender();
    registry = new PushTokenRegistry();
    relay = await startRelay({ port: 0, pushSender, pushTokenRegistry: registry, pushThrottleMs: 0 });
    url = `ws://127.0.0.1:${relay.port}`;
  });
  afterEach(async () => { await relay.stop(); });

  it('a message to EITHER address reaches the one device', async () => {
    const anna = await openClient(url);
    const bram = await openClient(url);
    send(anna, { type: 'register', address: ANNA_X });
    send(anna, { type: 'register', address: ANNA_Y });
    send(bram, { type: 'register', address: BRAM });
    await waitFor(() => anna.messages.filter((m) => m.type === 'registered').length === 2);

    send(bram, { type: 'send', to: ANNA_X, envelope: { subtype: 'x', n: 1 } });
    send(bram, { type: 'send', to: ANNA_Y, envelope: { subtype: 'y', n: 2 } });
    await waitFor(() => anna.messages.filter((m) => m.type === 'message').length === 2);

    const got = anna.messages.filter((m) => m.type === 'message').map((m) => m.envelope.subtype).sort();
    expect(got).toEqual(['x', 'y']);
    anna.close(); bram.close();
  });

  it('closing the socket removes EVERY address, not just the primary', async () => {
    const anna = await openClient(url);
    send(anna, { type: 'register', address: ANNA_X });
    send(anna, { type: 'register', address: ANNA_Y });
    await waitFor(() => anna.messages.filter((m) => m.type === 'registered').length === 2);
    anna.close();
    await settle();

    // Both must now be treated as offline — a leftover entry would route to a dead socket, silently.
    const bram = await openClient(url);
    send(bram, { type: 'register', address: BRAM });
    await waitFor(() => bram.messages.some((m) => m.type === 'registered'));
    for (const to of [ANNA_X, ANNA_Y]) send(bram, { type: 'send', to, envelope: { subtype: 'later' } });
    await settle();

    // Reconnecting as either address gets the queued message back — proof it was HELD, not delivered
    // into the void.
    const again = await openClient(url);
    send(again, { type: 'register', address: ANNA_X });
    await waitFor(() => again.messages.some((m) => m.type === 'message'));
    expect(again.messages.find((m) => m.type === 'message').envelope.subtype).toBe('later');
    bram.close(); again.close();
  });

  it('each registration drains its OWN queue, whatever order they arrive in', async () => {
    // Decision 3: per-registration draining, so nothing depends on which address registers first.
    const bram = await openClient(url);
    send(bram, { type: 'register', address: BRAM });
    await waitFor(() => bram.messages.some((m) => m.type === 'registered'));
    send(bram, { type: 'send', to: ANNA_X, envelope: { subtype: 'for-x' } });
    send(bram, { type: 'send', to: ANNA_Y, envelope: { subtype: 'for-y' } });
    await settle();

    const anna = await openClient(url);
    send(anna, { type: 'register', address: ANNA_Y });           // Y first — the reverse order
    await waitFor(() => anna.messages.some((m) => m.type === 'message'));
    expect(anna.messages.find((m) => m.type === 'message').envelope.subtype).toBe('for-y');

    send(anna, { type: 'register', address: ANNA_X });
    await waitFor(() => anna.messages.filter((m) => m.type === 'message').length === 2);
    expect(anna.messages.filter((m) => m.type === 'message').map((m) => m.envelope.subtype))
      .toEqual(['for-y', 'for-x']);
    bram.close(); anna.close();
  });

  it('a second address on the same socket is not a second connection', async () => {
    // The quota counts DEVICES. Registering five circle addresses must not exhaust a cap meant for phones.
    const anna = await openClient(url);
    for (const a of ['a@1', 'a@2', 'a@3', 'a@4', 'a@5']) send(anna, { type: 'register', address: a });
    await waitFor(() => anna.messages.filter((m) => m.type === 'registered').length === 5);
    expect(anna.messages.some((m) => m.type === 'error')).toBe(false);
    anna.close();
  });
});

describe('the push token covers every address the socket owns', () => {
  let relay; let url; let pushSender; let registry;

  beforeEach(async () => {
    pushSender = new FakePushSender();
    registry = new PushTokenRegistry();
    relay = await startRelay({ port: 0, pushSender, pushTokenRegistry: registry, pushThrottleMs: 0 });
    url = `ws://127.0.0.1:${relay.port}`;
  });
  afterEach(async () => { await relay.stop(); });

  /** Register N addresses + a token, then disconnect — the shape of a phone going to sleep. */
  async function sleepingDevice(addresses, token = 'ExponentPushToken[anna]') {
    const ws = await openClient(url);
    for (const a of addresses) send(ws, { type: 'register', address: a });
    await waitFor(() => ws.messages.filter((m) => m.type === 'registered').length === addresses.length);
    send(ws, { type: 'register-push-token', token, platform: 'ios' });
    await waitFor(() => ws.messages.some((m) => m.type === 'push-token-registered'));
    ws.close();
    await settle();
  }

  it('a wake for ANY circle address reaches the device', async () => {
    await sleepingDevice([ANNA_X, ANNA_Y]);
    expect(registry.get(ANNA_X)?.token).toBe('ExponentPushToken[anna]');
    expect(registry.get(ANNA_Y)?.token).toBe('ExponentPushToken[anna]');

    const bram = await openClient(url);
    send(bram, { type: 'register', address: BRAM });
    await waitFor(() => bram.messages.some((m) => m.type === 'registered'));
    send(bram, { type: 'send', to: ANNA_Y, envelope: { subtype: 'wake-me' } });
    await waitFor(() => pushSender.calls.length >= 1);

    expect(pushSender.calls[0].token).toBe('ExponentPushToken[anna]');
    bram.close();
  });

  it('an address registered AFTER the token is covered too', async () => {
    // The ordering that would silently drop a circle: join a new circle after enabling notifications.
    const ws = await openClient(url);
    send(ws, { type: 'register', address: ANNA_X });
    await waitFor(() => ws.messages.some((m) => m.type === 'registered'));
    send(ws, { type: 'register-push-token', token: 'tok', platform: 'ios' });
    await waitFor(() => ws.messages.some((m) => m.type === 'push-token-registered'));

    send(ws, { type: 'register', address: ANNA_Y });             // a circle joined later
    await waitFor(() => ws.messages.filter((m) => m.type === 'registered').length === 2);
    expect(registry.get(ANNA_Y)?.token).toBe('tok');
    ws.close();
  });

  it('unregistering turns notifications off for EVERY circle, not one', async () => {
    const ws = await openClient(url);
    for (const a of [ANNA_X, ANNA_Y]) send(ws, { type: 'register', address: a });
    await waitFor(() => ws.messages.filter((m) => m.type === 'registered').length === 2);
    send(ws, { type: 'register-push-token', token: 'tok', platform: 'ios' });
    await waitFor(() => ws.messages.some((m) => m.type === 'push-token-registered'));
    expect(registry.get(ANNA_X)).toBeTruthy();

    send(ws, { type: 'unregister-push-token' });
    await settle();
    expect(registry.get(ANNA_X)).toBeNull();
    expect(registry.get(ANNA_Y)).toBeNull();
    ws.close();
  });
});
