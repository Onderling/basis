/**
 * E2c integration: relay wires `register-push-token` envelopes and fires
 * `pushSender.send(...)` when a `send` lands for an offline peer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startRelay }       from '../../src/server.js';
import { PushSender }       from '../../src/push/PushSender.js';
import { PushTokenRegistry } from '../../src/push/PushTokenRegistry.js';
import { openClient, send, addr } from '../helpers/provenClient.js';

class FakePushSender extends PushSender {
  constructor() { super(); this.calls = []; this.next = { ok: true }; }
  async send(token, payload, opts) {
    this.calls.push({ token, payload, opts });
    return this.next;
  }
}

// Registration is challenge-first (Decision 3), so the client + the addresses come from the shared
// helper: `addr('alice')` is a real public key it can prove possession of.

async function waitFor(predicate, timeoutMs = 1_000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout (${timeoutMs}ms)`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('relay — push wake (E2c)', () => {
  let relay;
  let pushSender;
  let registry;

  beforeEach(async () => {
    pushSender = new FakePushSender();
    registry   = new PushTokenRegistry();
    relay = await startRelay({
      port:              0,
      pushSender,
      pushTokenRegistry: registry,
      // Tight throttle window so tests can exercise it deterministically.
      pushThrottleMs:    50,
    });
  });

  afterEach(async () => {
    await relay.stop();
  });

  it('register-push-token requires prior register', async () => {
    const ws = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(ws, { type: 'register-push-token', token: 'tok-1', platform: 'ios' });
    await waitFor(() =>
      ws.messages.some((m) => m.type === 'error' && /requires register first/.test(m.message)));
    ws.close();
  });

  it('register-push-token after register stores the token', async () => {
    const ws = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(ws, { type: 'register', address: addr('alice') });
    await waitFor(() => ws.messages.some((m) => m.type === 'registered'));
    send(ws, { type: 'register-push-token', token: 'tok-1', platform: 'ios' });
    await waitFor(() => ws.messages.some((m) => m.type === 'push-token-registered'));
    expect(registry.get(addr('alice'))).toMatchObject({ token: 'tok-1', platform: 'ios' });
    ws.close();
  });

  it('rejects empty token', async () => {
    const ws = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(ws, { type: 'register', address: addr('alice') });
    await waitFor(() => ws.messages.some((m) => m.type === 'registered'));
    send(ws, { type: 'register-push-token', token: '', platform: 'ios' });
    await waitFor(() => ws.messages.some((m) => m.type === 'error' && /token required/.test(m.message)));
    ws.close();
  });

  it('unregister-push-token removes the entry', async () => {
    const ws = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(ws, { type: 'register', address: addr('alice') });
    await waitFor(() => ws.messages.some((m) => m.type === 'registered'));
    send(ws, { type: 'register-push-token', token: 'tok-1' });
    await waitFor(() => ws.messages.some((m) => m.type === 'push-token-registered'));
    send(ws, { type: 'unregister-push-token' });
    await waitFor(() => ws.messages.some((m) => m.type === 'push-token-unregistered'));
    expect(registry.get(addr('alice'))).toBeNull();
    ws.close();
  });

  it('fires push when send lands for an offline peer with a token', async () => {
    // Alice connects + registers a push token, then disconnects.
    const alice = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(alice, { type: 'register', address: addr('alice') });
    await waitFor(() => alice.messages.some((m) => m.type === 'registered'));
    send(alice, { type: 'register-push-token', token: 'tok-alice', platform: 'ios' });
    await waitFor(() => alice.messages.some((m) => m.type === 'push-token-registered'));
    alice.close();
    await waitFor(() => alice.readyState === alice.CLOSED);

    // Bob sends to offline alice.
    const bob = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(bob, { type: 'register', address: addr('bob') });
    await waitFor(() => bob.messages.some((m) => m.type === 'registered'));
    send(bob, { type: 'send', to: addr('alice'), envelope: { _p: 'OW', payload: 'x' } });

    await waitFor(() => pushSender.calls.length >= 1, 500);
    expect(pushSender.calls[0].token).toBe('tok-alice');
    expect(pushSender.calls[0].payload).toMatchObject({ wake: true, hint: 'message-pending' });
    expect(pushSender.calls[0].opts).toMatchObject({ platform: 'ios' });
    bob.close();
  });

  it('no-wake flag: hold-forwards WITHOUT a push, while a normal message DOES wake', async () => {
    const url = `ws://127.0.0.1:${relay.port}`;
    // Two offline peers, each with a push token registered.
    for (const [who, tok] of [['nw-alice', 'tok-nw'], ['w-dave', 'tok-w']]) {
      const c = await openClient(url);
      send(c, { type: 'register', address: addr(who) });
      await waitFor(() => c.messages.some((m) => m.type === 'registered'));
      send(c, { type: 'register-push-token', token: tok, platform: 'ios' });
      await waitFor(() => c.messages.some((m) => m.type === 'push-token-registered'));
      c.close();
      await waitFor(() => c.readyState === c.CLOSED);
    }

    const bob = await openClient(url);
    send(bob, { type: 'register', address: addr('bob') });
    await waitFor(() => bob.messages.some((m) => m.type === 'registered'));

    // A routine governance vote (envelope stamped `noWake`) → hold-forwarded, NO push.
    send(bob, { type: 'send', to: addr('nw-alice'), envelope: { _p: 'OW', noWake: true, subtype: 'circle-governance-broadcast' } });
    // A normal message to a different offline peer → DOES push.
    send(bob, { type: 'send', to: addr('w-dave'), envelope: { _p: 'OW' } });

    await waitFor(() => pushSender.calls.length >= 1, 500);
    // Give any spurious (no-wake) push a tick to (not) fire.
    await new Promise((r) => setTimeout(r, 40));
    expect(pushSender.calls).toHaveLength(1);
    expect(pushSender.calls[0].token).toBe('tok-w');   // only dave woke; alice did not

    // The no-wake message was still BUFFERED — alice receives it on reconnect
    // (hold-forward is preserved; only the wake was suppressed).
    const alice = await openClient(url);
    send(alice, { type: 'register', address: addr('nw-alice') });
    await waitFor(() => alice.messages.some((m) => m.type === 'message'));
    const got = alice.messages.find((m) => m.type === 'message');
    expect(got.envelope).toMatchObject({ noWake: true });

    bob.close(); alice.close();
  });

  it('does NOT fire push when target is online', async () => {
    const alice = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(alice, { type: 'register', address: addr('alice') });
    await waitFor(() => alice.messages.some((m) => m.type === 'registered'));
    send(alice, { type: 'register-push-token', token: 'tok-alice' });
    await waitFor(() => alice.messages.some((m) => m.type === 'push-token-registered'));

    const bob = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(bob, { type: 'register', address: addr('bob') });
    await waitFor(() => bob.messages.some((m) => m.type === 'registered'));
    send(bob, { type: 'send', to: addr('alice'), envelope: { _p: 'OW' } });

    await waitFor(() => alice.messages.some((m) => m.type === 'message'));
    // Give any spurious push a tick to fire.
    await new Promise((r) => setTimeout(r, 30));
    expect(pushSender.calls).toHaveLength(0);

    alice.close(); bob.close();
  });

  it('does NOT fire push when offline target has no registered token', async () => {
    const bob = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(bob, { type: 'register', address: addr('bob') });
    await waitFor(() => bob.messages.some((m) => m.type === 'registered'));
    send(bob, { type: 'send', to: addr('never-registered'), envelope: { _p: 'OW' } });

    await new Promise((r) => setTimeout(r, 30));
    expect(pushSender.calls).toHaveLength(0);
    bob.close();
  });

  it('throttles repeated sends to the same offline peer', async () => {
    const alice = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(alice, { type: 'register', address: addr('alice') });
    await waitFor(() => alice.messages.some((m) => m.type === 'registered'));
    send(alice, { type: 'register-push-token', token: 'tok-alice' });
    await waitFor(() => alice.messages.some((m) => m.type === 'push-token-registered'));
    alice.close();
    await waitFor(() => alice.readyState === alice.CLOSED);

    const bob = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(bob, { type: 'register', address: addr('bob') });
    await waitFor(() => bob.messages.some((m) => m.type === 'registered'));

    // Three rapid sends within the 50ms throttle window.
    send(bob, { type: 'send', to: addr('alice'), envelope: { _p: 'OW', n: 1 } });
    send(bob, { type: 'send', to: addr('alice'), envelope: { _p: 'OW', n: 2 } });
    send(bob, { type: 'send', to: addr('alice'), envelope: { _p: 'OW', n: 3 } });

    await waitFor(() => pushSender.calls.length >= 1, 500);
    await new Promise((r) => setTimeout(r, 30));
    expect(pushSender.calls).toHaveLength(1);

    // After the throttle window, the next send should fire again.
    await new Promise((r) => setTimeout(r, 80));
    send(bob, { type: 'send', to: addr('alice'), envelope: { _p: 'OW', n: 4 } });
    await waitFor(() => pushSender.calls.length >= 2, 500);
    expect(pushSender.calls).toHaveLength(2);

    bob.close();
  });

  it('push-sender errors are swallowed (relay stays healthy)', async () => {
    pushSender.next = { ok: false, error: 'expo-error: DeviceNotRegistered' };

    const alice = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(alice, { type: 'register', address: addr('alice') });
    await waitFor(() => alice.messages.some((m) => m.type === 'registered'));
    send(alice, { type: 'register-push-token', token: 'tok-alice' });
    await waitFor(() => alice.messages.some((m) => m.type === 'push-token-registered'));
    alice.close();
    await waitFor(() => alice.readyState === alice.CLOSED);

    const bob = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(bob, { type: 'register', address: addr('bob') });
    await waitFor(() => bob.messages.some((m) => m.type === 'registered'));
    send(bob, { type: 'send', to: addr('alice'), envelope: { _p: 'OW' } });

    // Push fired but failed; relay should still be responsive.
    await waitFor(() => pushSender.calls.length >= 1, 500);
    send(bob, { type: 'peer-list' });
    await waitFor(() => bob.messages.some((m) => m.type === 'peer-list'));
    bob.close();
  });

  it('push not configured: register-push-token returns an error', async () => {
    // Standalone relay with no pushSender at all.
    const plain = await startRelay({ port: 0 });
    try {
      const ws = await openClient(`ws://127.0.0.1:${plain.port}`);
      send(ws, { type: 'register', address: addr('alice') });
      await waitFor(() => ws.messages.some((m) => m.type === 'registered'));
      send(ws, { type: 'register-push-token', token: 'tok-1' });
      await waitFor(() => ws.messages.some((m) => m.type === 'error' && /push not configured/.test(m.message)));
      ws.close();
    } finally {
      await plain.stop();
    }
  });
});
