/**
 * THE SEAM CROSSED: a real relay gives up on a person's message, and the bubble keeps its rung with a retry hint beside
 * it, never `failed` (docs/decisions.md 2026-07-29, its addition of 2026-11-26). The chain is the one a shell composes:
 * a real relay, a real secure agent, its `onUndelivered` into the SHARED give-up consumer, the app's delivery map, and
 * the shared presentation both shells paint. Then a receipt clears the hint.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { startRelay } from '@onderling/relay';
import { bootPeople, sendBypassingTheGate, untilTrue } from '../../e2e-journeys/journeys/_app.mjs';
import { makeGiveUpConsumers } from '../src/v2/deliveryGiveUp.js';
import { createAppDeliveryMap, DELIVERY, DELIVERY_RELAY_GAVE_UP_HINT } from '../src/v2/deliveryState.js';
import { deliveryPresentation } from '../src/v2/deliverySettings.js';

let relay = null;
afterEach(async () => { await relay?.stop?.(); relay = null; });

describe('a real relay give-up reaches the bubble as a hint, not a failure', () => {
  it('the bubble keeps maybe-received with the hint; the receipt moves it on and clears it', async () => {
    relay = await startRelay({ port: 0, queueCap: 1, queueCapTotal: 1 });
    const relayUrl = `ws://127.0.0.1:${relay.port}`;
    const map = createAppDeliveryMap({ setTimer: () => null, clearTimer: () => {} });
    const consumers = makeGiveUpConsumers({ deliveryMap: map, onWarn: () => {} });
    const [a, b] = await bootPeople({ relayUrl, handles: ['a', 'b'], onUndelivered: (handle, info) => { if (handle === 'a') consumers.onUndelivered(info); } });
    await sendBypassingTheGate(a, b.pubKey, { type: 'probe', msgId: 'hint-hello' }, { reason: 'one line while b is there, so the two have met' });
    await b.agent.sa.relay.disconnect();   // b is gone: the relay holds what comes for it, one line at most

    // a's own messages, each a bubble that left this device
    const ids = ['hint-m0', 'hint-m1', 'hint-m2'];
    for (const id of ids) { map.set(id, DELIVERY.PENDING); map.set(id, DELIVERY.MAYBE); }
    for (const [i, id] of ids.entries()) {
      await sendBypassingTheGate(a, b.pubKey, { type: 'probe', msgId: id, i }, { reason: 'lines for a peer who left, to overfill the relay\'s one-line hold' });
    }
    const hinted = () => ids.find((id) => map.relayGaveUpOf(id));
    expect(await untilTrue(() => !!hinted(), 8000), 'the relay\'s give-up reached the map').toBe(true);

    const id = hinted();
    expect(map.get(id), 'the relay\'s word never sets failed').toBe(DELIVERY.MAYBE);
    expect(ids.every((x) => map.get(x) !== DELIVERY.FAILED)).toBe(true);
    const shown = deliveryPresentation(map.get(id), { relayGaveUp: map.relayGaveUpOf(id) });
    expect(shown).toMatchObject({ state: DELIVERY.MAYBE, hintKey: DELIVERY_RELAY_GAVE_UP_HINT, retryable: true });

    map.set(id, DELIVERY.STORED);
    expect(map.relayGaveUpOf(id)).toBe(null);
  }, 30000);
});
