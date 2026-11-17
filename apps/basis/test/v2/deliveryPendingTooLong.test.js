// A message that is still "sending" after a while says so: "Not sent yet: waiting for a connection" (Frits, the
// interface oddities walk). The words clear themselves when the message goes.
import { describe, it, expect, vi } from 'vitest';
import { createAppDeliveryMap, PENDING_SAYS_WAITING_MS } from '../../src/v2/deliveryState.js';
import { deliveryPresentation } from '../../src/v2/deliverySettings.js';
import { createDeliveryStateMap } from '@onderling/kring-host/deliveryState';

describe('a pending message that waits too long', () => {
  it('the substrate map tells its watchers when only the reason changes', () => {
    const m = createDeliveryStateMap();
    m.set('a', 'pending');
    const seen = [];
    m.subscribe((id, st) => seen.push([id, st]));
    m.set('a', 'pending', { reason: 'held' });
    expect(m.reasonOf('a')).toBe('held');
    expect(seen).toEqual([['a', 'pending']]);
  });

  it('after the wait, a still-pending message reads "waiting for a connection"; it clears when it goes', () => {
    vi.useFakeTimers();
    try {
      const m = createAppDeliveryMap();
      const seen = [];
      m.subscribe((id) => seen.push(id));
      m.set('a', 'pending');
      expect(deliveryPresentation(m.get('a'), { reason: m.reasonOf('a') }).labelKey).toBe('circle.chat.delivery.pending');
      vi.advanceTimersByTime(PENDING_SAYS_WAITING_MS);
      expect(m.reasonOf('a')).toBe('waiting-for-connection');
      expect(deliveryPresentation(m.get('a'), { reason: m.reasonOf('a') })).toMatchObject({ labelKey: 'circle.chat.delivery.waiting_for_connection', tone: 'muted' });
      expect(seen.filter((x) => x === 'a').length, 'the screen is told, so it repaints').toBe(2);
      m.set('a', 'maybe-received');
      expect(m.reasonOf('a')).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('arms one timer per wait: the reason it sets, or a reason it was given, arms none', () => {
    const armed = [];
    const m = createAppDeliveryMap({ setTimer: (fn) => { armed.push(fn); return armed.length; }, clearTimer: () => {} });
    m.set('a', 'pending');
    expect(armed.length).toBe(1);
    armed[0]();   // the wait is over: the reason is set, and the map tells its watchers (its own included)
    expect(m.reasonOf('a')).toBe('waiting-for-connection');
    expect(armed.length, 'its own notify arms no second timer').toBe(1);
    m.set('b', 'pending', { reason: 'held' });
    expect(armed.length, 'a message with its own reason waits for no timer').toBe(1);
  });

  it('a message that went before the wait, or that waits for its own reason, keeps its words', () => {
    vi.useFakeTimers();
    try {
      const m = createAppDeliveryMap();
      m.set('a', 'pending'); m.set('a', 'maybe-received');
      m.set('b', 'pending', { reason: 'held' });
      vi.advanceTimersByTime(PENDING_SAYS_WAITING_MS * 2);
      expect(m.reasonOf('a')).toBeNull();
      expect(m.reasonOf('b')).toBe('held');
    } finally { vi.useRealTimers(); }
  });
});
