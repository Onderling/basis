// @reads-source: this test reads source as text, so rung 1 runs it (docs/conventions/verification-ladder.md).
/**
 * A relay's give-up is the relay's word, not this device's knowledge (docs/decisions.md 2026-07-29, "The delivery
 * ladder admits doubt, and never claims arrival", its addition of 2026-11-26).
 *
 * So it never sets `failed` and never moves the ladder: the bubble keeps its rung and gets a retry hint BESIDE it,
 * a side fact on the delivery map that is not a rung, not a reason and not synced. A later real receipt moves the
 * bubble on and clears the hint; a retry (the person's act) clears it too. `failed` stays for what this device itself
 * knows: its own hold queue let the message go.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeGiveUpConsumers } from '../../src/v2/deliveryGiveUp.js';
import { createAppDeliveryMap, DELIVERY, deliveryStates, DELIVERY_RELAY_GAVE_UP_HINT } from '../../src/v2/deliveryState.js';
import { deliveryPresentation } from '../../src/v2/deliverySettings.js';

const quiet = () => {};
const mapWithBubble = (id, state = DELIVERY.MAYBE) => {
  const map = createAppDeliveryMap({ setTimer: () => null, clearTimer: () => {} });
  map.set(id, DELIVERY.PENDING);
  if (state !== DELIVERY.PENDING) map.set(id, state);
  return map;
};

describe('a relay give-up keeps the rung and adds a retry hint beside it', () => {
  it('a forged undelivered, then the receipt: the rung stays, the hint shows, the receipt moves it on and clears the hint', () => {
    const map = mapWithBubble('m1');
    const seen = [];
    map.subscribe((id, st) => seen.push([id, st, map.relayGaveUpOf(id)]));

    makeGiveUpConsumers({ deliveryMap: map, onWarn: quiet }).onUndelivered({ msgId: 'm1', reason: 'expired' });

    expect(map.get('m1'), 'the relay\'s word never moves the ladder').toBe(DELIVERY.MAYBE);
    expect(map.relayGaveUpOf('m1')).toBe('expired');
    expect(seen.at(-1), 'the screens are told, so the chip repaints').toEqual(['m1', DELIVERY.MAYBE, 'expired']);
    const shown = deliveryPresentation(map.get('m1'), { relayGaveUp: map.relayGaveUpOf('m1') });
    expect(shown.state).toBe(DELIVERY.MAYBE);
    expect(shown.labelKey, 'the rung keeps its own words').toBe('circle.chat.delivery.maybe_received');
    expect(shown.hintKey).toBe(DELIVERY_RELAY_GAVE_UP_HINT);
    expect(shown.retryable).toBe(true);

    map.set('m1', DELIVERY.STORED);   // the recipient's app chose to confirm
    expect(map.get('m1')).toBe(DELIVERY.STORED);
    expect(map.relayGaveUpOf('m1'), 'a real receipt clears the hint').toBe(null);
    expect(deliveryPresentation(DELIVERY.STORED, { relayGaveUp: map.relayGaveUpOf('m1') }).hintKey).toBeUndefined();
  });

  it('an over-rate give-up is the relay\'s word too: no failed', () => {
    const map = mapWithBubble('m2');
    makeGiveUpConsumers({ deliveryMap: map, onWarn: quiet }).onUndelivered({ msgId: 'm2', reason: 'over-rate' });
    expect(map.get('m2')).toBe(DELIVERY.MAYBE);
    expect(map.relayGaveUpOf('m2')).toBe('over-rate');
  });

  it('a retry (a reasonless pending: the act) clears the hint; the app map\'s own waiting timer does not', () => {
    const map = mapWithBubble('m3');
    makeGiveUpConsumers({ deliveryMap: map, onWarn: quiet }).onUndelivered({ msgId: 'm3', reason: 'expired' });
    map.set('m3', DELIVERY.PENDING, { reason: 'waiting-for-connection' });
    expect(map.relayGaveUpOf('m3'), 'a named wait is no retry').toBe('expired');
    map.set('m3', DELIVERY.PENDING);
    expect(map.relayGaveUpOf('m3')).toBe(null);
    expect(map.get('m3'), 'and the ladder still only goes up').toBe(DELIVERY.MAYBE);
  });

  it('lane traffic (no bubble) gets no hint, and a stored message ignores a late give-up', () => {
    const map = mapWithBubble('m4', DELIVERY.STORED);
    const c = makeGiveUpConsumers({ deliveryMap: map, onWarn: quiet });
    c.onUndelivered({ msgId: 'env-1', reason: 'expired' });
    c.onUndelivered({ msgId: 'm4', reason: 'expired' });
    expect(map.get('env-1')).toBe(null);
    expect(map.relayGaveUpOf('env-1')).toBe(null);
    expect(map.relayGaveUpOf('m4')).toBe(null);
  });

  it('a dropped HOLD is this device\'s own knowledge: still failed', () => {
    const map = mapWithBubble('m5', DELIVERY.PENDING);
    makeGiveUpConsumers({ deliveryMap: map, onWarn: quiet }).onHoldDropped({ msgId: 'm5', reason: 'ttl' });
    expect(map.get('m5')).toBe(DELIVERY.FAILED);
  });

  it('the hint is not a rung: the vocabulary is unchanged, and a terminal state keeps its own words', () => {
    expect(deliveryStates()).toEqual([DELIVERY.PENDING, DELIVERY.MAYBE, DELIVERY.STORED]);
    expect(deliveryPresentation(DELIVERY.FAILED, { relayGaveUp: 'expired' }).hintKey).toBeUndefined();
  });
});

describe('its words exist in both languages, and both shells paint it from the one decision', () => {
  const ROOT = new URL('../../../..', import.meta.url).pathname;
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, `file://${ROOT}`)), 'utf8');
  for (const lang of ['en', 'nl']) {
    it(`${lang} has the hint`, () => {
      const json = JSON.parse(read(`apps/basis/src/locales/circle.${lang}.json`));
      expect(json.chat.delivery.relay_gave_up_hint.text).toMatch(/\S/);
    });
  }
  // the renderers have no runtime coverage on mobile (src/screens/**); pin that each one hands the side fact on
  const painters = {
    'web circle bubble':        ['apps/basis/web/v2/circleView.js', /relayGaveUp:\s*typeof deliveryRelayGaveUpFor/],
    'web contact bubble':       ['apps/basis/web/v2/contactThread.js', /relayGaveUp:\s*typeof deliveryRelayGaveUpFor/],
    'web repaints':             ['apps/basis/web/v2/circleApp.js', /relayGaveUp:\s*deliveryStateMap\.relayGaveUpOf/],
    'mobile chip':              ['apps/basis-mobile/src/rn/DeliveryChip.js', /deliveryPresentation\(state,\s*\{[^}]*relayGaveUp/],
    'mobile circle bubble':     ['apps/basis-mobile/src/screens/v2/CircleLauncherScreen.js', /relayGaveUp=\{deliveryRelayGaveUp\}/],
    'mobile contact bubble':    ['apps/basis-mobile/src/screens/v2/ContactThreadScreen.js', /relayGaveUp=\{deliveryStateMap\.relayGaveUpOf/],
  };
  for (const [name, [rel, re]] of Object.entries(painters)) {
    it(`${name} passes the relay's give-up to the shared presentation`, () => {
      expect(read(rel)).toMatch(re);
    });
  }
});
