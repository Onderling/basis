/**
 * A ROUTE THAT REACHES NOBODY FALLS BACK TO THE PERSON — a direct message never sits held with nowhere to go.
 *
 * A contact with a pair roster is written to at their per-circle address there (`deliverTo`), as this device's
 * per-circle key. That address is one specific DEVICE's; it may not be on any relay yet (its registration is
 * fire-and-forget on the web shell), or that device may be dark while the person's primary is up. Measured in
 * CI on 2026-09-19 (the feedback-path browser walk, two runs): the maker's answer to a visitor rode the pair
 * route, the HI to the visitor's pair address timed out, the answer was held, the visitor's screen never showed
 * it. The person's address (`to`) is what every device of theirs registers and what the primary holds — so when
 * the route does not deliver, the same envelope goes there. The receiver dedups by id, so a route that turns
 * out to have delivered after all costs one duplicate on the wire and none on the screen.
 */
import { describe, it, expect, vi } from 'vitest';
import { createAddressedDeliver } from '../src/addressedDeliver.js';

const memStore = () => {
  const items = [];
  return { items, addItems: vi.fn(async (d) => { const out = d.map((x, i) => ({ id: `id-${items.length + i}`, addedAt: 1, ...x })); items.push(...out); return out; }), listOpen: vi.fn(async () => items.slice()) };
};
const env = (id) => ({ id, ts: 1, body: 'hoi', extras: {} });

describe('deliver — the route first, the person when the route does not deliver', () => {
  it('a route that delivers is the only send', async () => {
    const send = vi.fn(async () => ({ delivered: true, held: false }));
    const d = createAddressedDeliver({ send, itemStore: memStore() });
    const r = await d.deliver(env('m1'), { to: 'person', deliverTo: 'pair-addr', sendOpts: { circleId: 'pair-x' } });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe('pair-addr');
    expect(r.sent.delivered).toBe(true);
    expect(r.fallback, 'no fallback when the route delivered').toBeUndefined();
  });

  it('a route that is HELD (nobody at that address) → the same envelope goes to the person, plainly', async () => {
    const send = vi.fn(async (addr) => (addr === 'pair-addr' ? { delivered: false, held: true, reason: 'peer-unreachable' } : { delivered: true, held: false }));
    const d = createAddressedDeliver({ send, itemStore: memStore() });
    const r = await d.deliver(env('m2'), { to: 'person', deliverTo: 'pair-addr', sendOpts: { circleId: 'pair-x' } });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0], 'the person\'s own address').toBe('person');
    expect(send.mock.calls[1].length, 'plainly — no circle-scoped send options on the fallback').toBe(2);
    expect(send.mock.calls[1][1].id, 'the SAME envelope, so the receiver dedups a late double').toBe('m2');
    expect(r.fallback?.delivered).toBe(true);
    expect(r.itemId, 'stored once').toBeTruthy();
  });

  it('a route that fails outright (the send threw) → the fallback still goes; without a route nothing changes', async () => {
    const send = vi.fn(async (addr) => { if (addr === 'pair-addr') throw new Error('transport failed'); return { delivered: true }; });
    const d = createAddressedDeliver({ send, itemStore: memStore() });
    const r = await d.deliver(env('m3'), { to: 'person', deliverTo: 'pair-addr', sendOpts: { circleId: 'pair-x' } });
    expect(send).toHaveBeenCalledTimes(2);
    expect(r.fallback?.delivered).toBe(true);
    const plain = vi.fn(async () => ({ delivered: false, held: true }));
    const d2 = createAddressedDeliver({ send: plain, itemStore: memStore() });
    await d2.deliver(env('m4'), { to: 'person' });
    expect(plain, 'no route → one send, held is held (the person is offline everywhere)').toHaveBeenCalledTimes(1);
  });

  it('a send with NO verdict (an injected sender that returns nothing) is taken as delivered — the route is not doubled', async () => {
    const send = vi.fn(async () => undefined);
    const d = createAddressedDeliver({ send, itemStore: memStore() });
    const r = await d.deliver(env('m5'), { to: 'person', deliverTo: 'pair-addr', sendOpts: { circleId: 'pair-x' } });
    expect(send).toHaveBeenCalledTimes(1);
    expect(r.fallback).toBeUndefined();
  });
});
