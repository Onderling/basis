/**
 * δ.2 — deliveryStateMap substrate tests.
 *
 * Pure JS factory; no DOM/RN dependencies.
 */
// Vocabulary note (decision 1, 2026-07-29): `sent` and `reached-device` are retired. `sent` read as
// success while meaning only "the fan-out accepted it", so the app said the same thing for "their phone
// took it" and "we never heard anything back" (S2/J-D2). `reached-device` is the transport ack, never
// shown, because a phone acks whatever its owner's receipt setting says — surfacing it would identify a
// peer who turned receipts off by where their ladder stops (S2/J-D5). The resting state for an
// unconfirmed message is `maybe-received`.

import { describe, it, expect, vi } from 'vitest';
import { createDeliveryStateMap } from '../src/deliveryState.js';

describe('createDeliveryStateMap', () => {
  it('returns null for unknown ids', () => {
    const m = createDeliveryStateMap();
    expect(m.get('nope')).toBeNull();
    expect(m.size()).toBe(0);
  });

  it('round-trips pending / maybe-received / failed via set/get', () => {
    const m = createDeliveryStateMap();
    m.set('a', 'pending');
    m.set('b', 'maybe-received');
    m.set('c', 'failed');
    expect(m.get('a')).toBe('pending');
    expect(m.get('b')).toBe('maybe-received');
    expect(m.get('c')).toBe('failed');
    expect(m.size()).toBe(3);
  });

  it('overwrites a previous state for the same id', () => {
    const m = createDeliveryStateMap();
    m.set('a', 'pending');
    m.set('a', 'maybe-received');
    expect(m.get('a')).toBe('maybe-received');
    m.set('a', 'failed');
    expect(m.get('a')).toBe('failed');
    expect(m.size()).toBe(1);
  });

  it('set(id, null) removes the entry', () => {
    const m = createDeliveryStateMap();
    m.set('a', 'pending');
    m.set('a', null);
    expect(m.get('a')).toBeNull();
    expect(m.size()).toBe(0);
  });

  it('clear(id) removes the entry and reports whether it existed', () => {
    const m = createDeliveryStateMap();
    m.set('a', 'pending');
    expect(m.clear('a')).toBe(true);
    expect(m.clear('a')).toBe(false); // already gone
    expect(m.get('a')).toBeNull();
  });

  it('ignores invalid msgIds + invalid state values', () => {
    const m = createDeliveryStateMap();
    m.set('', 'pending');                   // empty msgId — ignored
    m.set(null, 'pending');                 // non-string  — ignored
    m.set('a', 'bogus');                    // unknown state — ignored
    expect(m.size()).toBe(0);
    expect(m.get('')).toBeNull();
  });

  it('notifies subscribers on set + clear', () => {
    const m = createDeliveryStateMap();
    const fn = vi.fn();
    const off = m.subscribe(fn);
    m.set('a', 'pending');
    m.set('a', 'maybe-received');
    m.set('a', null);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(fn.mock.calls[0]).toEqual(['a', 'pending']);
    expect(fn.mock.calls[1]).toEqual(['a', 'maybe-received']);
    expect(fn.mock.calls[2]).toEqual(['a', null]);
    off();
    m.set('a', 'failed');
    expect(fn).toHaveBeenCalledTimes(3); // post-unsubscribe: no more calls
  });

  it('swallows subscriber throws so one bad listener cannot block the rest', () => {
    const m = createDeliveryStateMap();
    const good = vi.fn();
    m.subscribe(() => { throw new Error('boom'); });
    m.subscribe(good);
    expect(() => m.set('a', 'pending')).not.toThrow();
    expect(good).toHaveBeenCalledWith('a', 'pending');
  });

  it('does NOT notify when clear targets an unknown id', () => {
    const m = createDeliveryStateMap();
    const fn = vi.fn();
    m.subscribe(fn);
    m.clear('never-was');
    expect(fn).not.toHaveBeenCalled();
  });

  /* ─── δ.2 contract: full optimistic-send lifecycle ─── */

  it('models the happy-path lifecycle: pending → maybe-received', () => {
    const m = createDeliveryStateMap();
    m.set('msg-1', 'pending');
    expect(m.get('msg-1')).toBe('pending');
    // After the broadcast resolves with no errors:
    m.set('msg-1', 'maybe-received');
    expect(m.get('msg-1')).toBe('maybe-received');
  });

  it('models the failure path: pending → failed → (retry) pending → maybe-received', () => {
    const m = createDeliveryStateMap();
    // 1. Initial send fires.
    m.set('msg-1', 'pending');
    // 2. Broadcast rejects (or returns errors).
    m.set('msg-1', 'failed');
    expect(m.get('msg-1')).toBe('failed');
    // 3. User taps the warning icon → host re-fires fan-out with SAME msgId.
    m.set('msg-1', 'pending');
    expect(m.get('msg-1')).toBe('pending');
    // 4. Second attempt succeeds.
    m.set('msg-1', 'maybe-received');
    expect(m.get('msg-1')).toBe('maybe-received');
  });

  it('keeps independent state per msgId during concurrent sends', () => {
    const m = createDeliveryStateMap();
    m.set('a', 'pending');
    m.set('b', 'pending');
    m.set('c', 'pending');
    // Resolves arrive out of order.
    m.set('b', 'failed');
    m.set('a', 'maybe-received');
    // c still in flight.
    expect(m.get('a')).toBe('maybe-received');
    expect(m.get('b')).toBe('failed');
    expect(m.get('c')).toBe('pending');
    expect(m.size()).toBe(3);
  });

  describe('pruneUnconfirmed', () => {
    it('returns 0 when the map is empty', () => {
      const m = createDeliveryStateMap();
      expect(m.pruneUnconfirmed()).toBe(0);
      expect(m.size()).toBe(0);
    });

    it('drops only unconfirmed entries; pending + failed survive', () => {
      const m = createDeliveryStateMap();
      m.set('a', 'pending');
      m.set('b', 'maybe-received');
      m.set('c', 'failed');
      m.set('d', 'maybe-received');
      expect(m.size()).toBe(4);
      expect(m.pruneUnconfirmed()).toBe(2);
      expect(m.size()).toBe(2);
      expect(m.get('a')).toBe('pending');
      expect(m.get('b')).toBe(null);
      expect(m.get('c')).toBe('failed');
      expect(m.get('d')).toBe(null);
    });

    it('notifies subscribers with (msgId, null) for each cleared entry', () => {
      const m = createDeliveryStateMap();
      m.set('a', 'maybe-received');
      m.set('b', 'maybe-received');
      m.set('c', 'pending');
      const fn = vi.fn();
      m.subscribe(fn);
      m.pruneUnconfirmed();
      expect(fn).toHaveBeenCalledTimes(2);
      const calls = fn.mock.calls.map((args) => args.slice());
      expect(calls).toContainEqual(['a', null]);
      expect(calls).toContainEqual(['b', null]);
    });

    it('is a no-op when no entries are sent', () => {
      const m = createDeliveryStateMap();
      m.set('a', 'pending');
      m.set('b', 'failed');
      const fn = vi.fn();
      m.subscribe(fn);
      expect(m.pruneUnconfirmed()).toBe(0);
      expect(fn).not.toHaveBeenCalled();
      expect(m.size()).toBe(2);
    });
  });
});
