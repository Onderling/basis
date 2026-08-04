/**
 * The address-fallback setting and the offer that makes it findable.
 *
 * The setting is easy; the offer is the whole design. Off fails as SILENCE — no error, no bounce, just
 * messages nobody answers — so a setting nobody is told about is a trap rather than a choice. These tests
 * pin the three rules that make the offer honest: not on the first failure, not repeatedly, and never the
 * fix without its cost.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createFallbackOffer, OFFER_AFTER_PEERS, OFFER_COOLDOWN_MS,
} from '../../src/v2/addressFallback.js';
// (Batch 4) The SETTING's tests moved with the setting: it lives in `deliverySettings.js` as
// `allowFallback` — the duplicate store half that lived here (a second key nothing read) retired.

const T0 = 1_700_000_000_000;

describe('the offer — rule 1: not on the first failure', () => {
  it('says nothing about one unreachable person', () => {
    // One is normal: they are offline, their app is closed. Offering immediately teaches people to dismiss.
    const onOffer = vi.fn();
    const offer = createFallbackOffer({ onOffer, now: () => T0 });
    offer.report({ blocked: true, webid: 'ada' });
    expect(onOffer).not.toHaveBeenCalled();
    expect(offer.shouldOffer()).toBe(false);
  });

  it('offers once a SECOND distinct person is unreachable', () => {
    const onOffer = vi.fn();
    const offer = createFallbackOffer({ onOffer, now: () => T0 });
    offer.report({ blocked: true, webid: 'ada' });
    offer.report({ blocked: true, webid: 'bea' });
    expect(onOffer).toHaveBeenCalledTimes(1);
    expect(onOffer.mock.calls[0][0].peers).toBe(OFFER_AFTER_PEERS);
  });

  it('counts PEOPLE, not messages — ten to one person is one person', () => {
    // Counting messages would fire on a single retry loop, which is not evidence of anything.
    const onOffer = vi.fn();
    const offer = createFallbackOffer({ onOffer, now: () => T0 });
    for (let i = 0; i < 10; i += 1) offer.report({ blocked: true, webid: 'ada' });
    expect(onOffer).not.toHaveBeenCalled();
    expect(offer.blockedPeers()).toBe(1);
  });

  it('ignores reports the setting did NOT cause', () => {
    // An ordinary fallback means the setting is ON and working. Offering to turn on what is already on
    // would be nonsense, and would fire constantly.
    const onOffer = vi.fn();
    const offer = createFallbackOffer({ onOffer, now: () => T0 });
    offer.report({ via: 'pubkey', webid: 'ada' });
    offer.report({ via: 'webid', webid: 'bea' });
    expect(offer.blockedPeers()).toBe(0);
    expect(onOffer).not.toHaveBeenCalled();
  });
});

describe('the offer — rule 2: not repeatedly', () => {
  it('offers ONCE, not on every subsequent failure', () => {
    const onOffer = vi.fn();
    const offer = createFallbackOffer({ onOffer, now: () => T0 });
    offer.report({ blocked: true, webid: 'ada' });
    offer.report({ blocked: true, webid: 'bea' });
    offer.report({ blocked: true, webid: 'cato' });
    offer.report({ blocked: true, webid: 'dee' });
    expect(onOffer).toHaveBeenCalledTimes(1);
  });

  it('a declined offer stays declined — asking again until someone says yes is a dark pattern', () => {
    const onOffer = vi.fn();
    let clock = T0;
    const offer = createFallbackOffer({ onOffer, now: () => clock });
    offer.report({ blocked: true, webid: 'ada' });
    offer.report({ blocked: true, webid: 'bea' });
    offer.decline();
    onOffer.mockClear();

    clock = T0 + OFFER_COOLDOWN_MS - 1;
    offer.report({ blocked: true, webid: 'cato' });
    expect(onOffer).not.toHaveBeenCalled();

    clock = T0 + OFFER_COOLDOWN_MS;
    offer.report({ blocked: true, webid: 'dee' });
    expect(onOffer).toHaveBeenCalledTimes(1);      // …but it is a cooldown, not a permanent silence
  });

  it('remembers a decline across restarts', () => {
    const onOffer = vi.fn();
    const save = vi.fn();
    const first = createFallbackOffer({ onOffer, now: () => T0, save });
    first.report({ blocked: true, webid: 'ada' });
    first.report({ blocked: true, webid: 'bea' });
    first.decline();

    const restored = createFallbackOffer({ onOffer, now: () => T0 + 1_000, state: save.mock.calls.at(-1)[0] });
    restored.report({ blocked: true, webid: 'cato' });
    restored.report({ blocked: true, webid: 'dee' });
    expect(restored.shouldOffer()).toBe(false);
  });

  it('accepting clears the evidence — a recurrence is new information', () => {
    const onOffer = vi.fn();
    const offer = createFallbackOffer({ onOffer, now: () => T0 });
    offer.report({ blocked: true, webid: 'ada' });
    offer.report({ blocked: true, webid: 'bea' });
    offer.accept();
    expect(offer.blockedPeers()).toBe(0);

    onOffer.mockClear();
    offer.report({ blocked: true, webid: 'cato' });
    offer.report({ blocked: true, webid: 'dee' });
    expect(onOffer).toHaveBeenCalledTimes(1);
  });
});

describe('the offer — rule 3: never the fix without its cost', () => {
  it('carries the cost key alongside the message and the action', () => {
    // An offer that only says "this will fix it" is not a choice either.
    const onOffer = vi.fn();
    const offer = createFallbackOffer({ onOffer, now: () => T0 });
    offer.report({ blocked: true, webid: 'ada' });
    offer.report({ blocked: true, webid: 'bea' });

    const payload = onOffer.mock.calls[0][0];
    expect(payload.messageKey).toBe('circle.nearbyScreen.delivery_fallback_hint');
    expect(payload.costKey).toBe('circle.nearbyScreen.delivery_fallback_cost');
    expect(payload.actionKey).toBe('circle.nearbyScreen.delivery_fallback_enable');
  });

  it('an offer handler that throws does not break the send path that produced it', () => {
    const offer = createFallbackOffer({ onOffer: () => { throw new Error('bad render'); }, now: () => T0 });
    offer.report({ blocked: true, webid: 'ada' });
    expect(() => offer.report({ blocked: true, webid: 'bea' })).not.toThrow();
  });

  it('a report with nobody to name is ignored rather than counted', () => {
    const offer = createFallbackOffer({ now: () => T0 });
    offer.report({ blocked: true });
    expect(offer.blockedPeers()).toBe(0);
  });
});
