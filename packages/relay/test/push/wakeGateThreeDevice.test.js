/**
 * Wake gating across a circle — story 4.3 of `plans/NOTE-multi-device-user-stories.md`.
 *
 * "Anna opens a decision (should wake) and then votes (should not) → Cato's device is woken ONCE, for the
 * propose only."
 *
 * `server-push-wake.test.js` proves the relay honours a single `noWake` envelope. What it cannot express is
 * the story's actual claim, which is about a SEQUENCE across THREE members: one wake-worthy event followed
 * by several routine ones, with a third member online throughout. Both failure directions hurt, and they
 * hurt differently:
 *   • over-waking is a notification storm — a circle that buzzes on every vote gets muted, and then the
 *     decision that mattered is missed anyway;
 *   • under-waking is a silent miss — the decision opens and nobody hears about it, which is exactly the
 *     failure the wake exists to prevent.
 * Nothing tested the two together, so a change that fixed one could quietly cause the other.
 *
 * Real relay over a real socket with a fake push sender — the pattern from `server-push-wake.test.js`.
 * The OS side (iOS NSE, FCM, Low-Power-Mode drops) is genuinely device-only; what is asserted here is
 * everything up to `pushSender.send`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startRelay } from '../../src/server.js';
// Challenge-first registration (Decision 3): these three members' addresses are real keys.
import { openClient, send, addr } from '../helpers/provenClient.js';
import { PushSender } from '../../src/push/PushSender.js';
import { PushTokenRegistry } from '../../src/push/PushTokenRegistry.js';

class FakePushSender extends PushSender {
  constructor() { super(); this.calls = []; this.next = { ok: true }; }
  async send(token, payload, opts) { this.calls.push({ token, payload, opts }); return this.next; }
}


async function waitFor(predicate, timeoutMs = 1_000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout (${timeoutMs}ms)`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
const settle = () => new Promise((r) => setTimeout(r, 60));

/**
 * Put a peer OFFLINE but wakeable: a push token belongs to the socket that registered it, so the device
 * must connect, register, hand over its token, and only then disconnect. That is also what really happens —
 * a phone registers its token while it is running and is woken after it goes away.
 */
async function offlineWithToken(url, address, token, platform = 'ios') {
  const ws = await openClient(url);
  send(ws, { type: 'register', address });
  await waitFor(() => ws.messages.some((m) => m.type === 'registered'));
  send(ws, { type: 'register-push-token', token, platform });
  await settle();
  ws.close();
  await settle();                     // let the relay observe the socket closing
}

/** The wire shape stoop's `broadcastToCircle` produces for a control-plane fan (no chat envelope). */
const govEnvelope = (event, { noWake }) => ({
  subtype: 'circle-governance-broadcast',
  circleId: 'oosterpoort',
  event,
  ...(noWake ? { noWake: true } : {}),
});

const ANNA = addr('anna-addr');
const BRAM = addr('bram-addr');
const CATO = addr('cato-addr');

describe('4.3 — a decision wakes; the votes that follow do not', () => {
  let relay; let pushSender; let registry; let url;

  beforeEach(async () => {
    pushSender = new FakePushSender();
    registry = new PushTokenRegistry();
    // No throttle window: the point of this story is which events wake, not rate limiting. A throttle
    // would mask an over-wake bug by silently swallowing the extra pushes.
    relay = await startRelay({ port: 0, pushSender, pushTokenRegistry: registry, pushThrottleMs: 0 });
    url = `ws://127.0.0.1:${relay.port}`;
  });
  afterEach(async () => { await relay.stop(); });

  it('Anna proposes then votes twice: Cato (offline) is woken exactly ONCE', async () => {
    const anna = await openClient(url);
    const bram = await openClient(url);
    send(anna, { type: 'register', address: ANNA });
    send(bram, { type: 'register', address: BRAM });
    // Cato is OFFLINE but has a push token registered — the only way a wake is even possible.
    await offlineWithToken(url, CATO, 'ExponentPushToken[cato]');
    expect(registry.get(CATO)).toBeTruthy();

    // The sequence the story names: one propose (wake-worthy), then routine traffic.
    send(anna, { type: 'send', to: CATO, envelope: govEnvelope({ event: 'propose', proposalId: 'p1' }, { noWake: false }) });
    await waitFor(() => pushSender.calls.length >= 1);
    send(anna, { type: 'send', to: CATO, envelope: govEnvelope({ event: 'vote', proposalId: 'p1', voter: ANNA }, { noWake: true }) });
    send(bram, { type: 'send', to: CATO, envelope: govEnvelope({ event: 'vote', proposalId: 'p1', voter: BRAM }, { noWake: true }) });
    send(anna, { type: 'send', to: CATO, envelope: govEnvelope({ event: 'resolve', proposalId: 'p1' }, { noWake: true }) });
    await settle();

    expect(pushSender.calls).toHaveLength(1);                       // exactly one, not four
    expect(pushSender.calls[0].token).toBe('ExponentPushToken[cato]');
    // …and the wake carries NO content — it says "something is pending", never what.
    expect(pushSender.calls[0].payload).toEqual({ wake: true, hint: 'message-pending' });

    anna.close(); bram.close();
  });

  it('the un-woken events are still DELIVERED — noWake suppresses the push, not the message', async () => {
    // The failure this guards: "don't wake" quietly becoming "don't deliver". Cato must find the whole
    // decision waiting for him, or the circle silently diverges for anyone who was offline.
    const anna = await openClient(url);
    send(anna, { type: 'register', address: ANNA });
    await offlineWithToken(url, CATO, 'ExponentPushToken[cato]');

    for (const e of [
      govEnvelope({ event: 'propose', proposalId: 'p1' }, { noWake: false }),
      govEnvelope({ event: 'vote', proposalId: 'p1', voter: ANNA }, { noWake: true }),
      govEnvelope({ event: 'resolve', proposalId: 'p1' }, { noWake: true }),
    ]) send(anna, { type: 'send', to: CATO, envelope: e });
    await settle();
    expect(pushSender.calls).toHaveLength(1);

    // Cato reconnects: every event is there, in order, including the ones that did not wake him.
    const cato = await openClient(url);
    send(cato, { type: 'register', address: CATO });
    await waitFor(() => cato.messages.filter((m) => m.type === 'message').length >= 3);

    const events = cato.messages.filter((m) => m.type === 'message').map((m) => m.envelope.event.event);
    expect(events).toEqual(['propose', 'vote', 'resolve']);
    anna.close(); cato.close();
  });

  it('an ONLINE member is never push-woken — Bram gets the socket, not a notification', async () => {
    const anna = await openClient(url);
    const bram = await openClient(url);
    send(anna, { type: 'register', address: ANNA });
    send(bram, { type: 'register', address: BRAM });
    // Registration is challenge-first (Decision 3), so it completes a round-trip later than the
    // `register` frame — and `register-push-token` still requires a completed registration. Wait for
    // the ack before handing the token over, which is what a real client does anyway.
    await waitFor(() => bram.messages.some((m) => m.type === 'registered'));
    // Bram has a token too; being ONLINE must be what prevents the push, not the absence of a token.
    send(bram, { type: 'register-push-token', token: 'ExponentPushToken[bram]', platform: 'android' });
    await waitFor(() => registry.get(BRAM));

    send(anna, { type: 'send', to: BRAM, envelope: govEnvelope({ event: 'propose', proposalId: 'p1' }, { noWake: false }) });
    await waitFor(() => bram.messages.some((m) => m.type === 'message'));
    await settle();

    expect(pushSender.calls).toHaveLength(0);
    anna.close(); bram.close();
  });

  it('a second decision wakes AGAIN — the gate is per-event, not once-per-circle', async () => {
    // The over-correction: suppressing everything after the first wake would make the second decision
    // silent, which is the under-wake failure wearing the other hat.
    const anna = await openClient(url);
    send(anna, { type: 'register', address: ANNA });
    await offlineWithToken(url, CATO, 'ExponentPushToken[cato]');

    send(anna, { type: 'send', to: CATO, envelope: govEnvelope({ event: 'propose', proposalId: 'p1' }, { noWake: false }) });
    await waitFor(() => pushSender.calls.length >= 1);
    send(anna, { type: 'send', to: CATO, envelope: govEnvelope({ event: 'vote', proposalId: 'p1' }, { noWake: true }) });
    send(anna, { type: 'send', to: CATO, envelope: govEnvelope({ event: 'propose', proposalId: 'p2' }, { noWake: false }) });
    await waitFor(() => pushSender.calls.length >= 2);
    await settle();

    expect(pushSender.calls).toHaveLength(2);
    anna.close();
  });

  it('a REPORT never wakes anyone, however urgent it feels', async () => {
    // §8 reports are hold-forwarded so an admin sees them on next presence, but they are silent-lane by
    // design: a report is about a person, and a buzzing phone is a disclosure of its own.
    const anna = await openClient(url);
    send(anna, { type: 'register', address: ANNA });
    await offlineWithToken(url, CATO, 'ExponentPushToken[cato]');

    send(anna, { type: 'send', to: CATO, envelope: { subtype: 'circle-report-broadcast', circleId: 'oosterpoort', event: { event: 'report' }, noWake: true } });
    await settle();
    expect(pushSender.calls).toHaveLength(0);

    // …but it IS waiting for them.
    const cato = await openClient(url);
    send(cato, { type: 'register', address: CATO });
    await waitFor(() => cato.messages.some((m) => m.type === 'message'));
    expect(cato.messages.find((m) => m.type === 'message').envelope.subtype).toBe('circle-report-broadcast');
    anna.close(); cato.close();
  });
});
