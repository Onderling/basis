/**
 * A failed send can say WHY, when it knows: the fan's per-recipient reason rides beside the state (never a new state),
 * so a persona with no connection to the circle is told so instead of a bare "failed".
 */
import { describe, it, expect } from 'vitest';
import { createDeliveryStateMap } from '../src/deliveryState.js';
import { classifyFanOut, fanOutReason } from '../src/circleBroadcast.js';

describe('the reason beside a failed state', () => {
  it('fanOutReason: one shared reason of every failing recipient, else null', () => {
    expect(fanOutReason({ errors: [{ reason: 'persona-no-connection' }, { reason: 'persona-no-connection' }] })).toBe('persona-no-connection');
    expect(classifyFanOut({ errors: [{ reason: 'persona-no-connection' }] })).toBe('failed');   // retryable: the socket can come back
    expect(fanOutReason({ errors: [{ reason: 'persona-no-connection' }, { reason: 'offline' }] })).toBe(null);
    expect(fanOutReason({ errors: [] })).toBe(null);
    expect(fanOutReason({ error: 'chat-unavailable' })).toBe(null);
  });
  it('a fan whose every recipient was HELD because the persona has no connection of its own: waiting, and why', () => {
    const held = { errors: [], outcomes: [{ webid: 'a', outcome: 'held:persona-no-connection' }, { webid: 'b', outcome: 'held:persona-no-connection' }] };
    expect(classifyFanOut(held)).toBe('pending');
    expect(fanOutReason(held)).toBe('persona-waiting');
    // one recipient went out, or held for another reason: the ordinary answer
    const mixed = { errors: [], outcomes: [{ webid: 'a', outcome: 'held:persona-no-connection' }, { webid: 'b', outcome: 'delivered' }] };
    expect(classifyFanOut(mixed)).toBe('maybe-received');
    expect(fanOutReason(mixed)).toBe(null);
    expect(classifyFanOut({ errors: [], outcomes: [{ webid: 'a', outcome: 'held' }] })).toBe('maybe-received');
  });
  it('the map keeps a reason only beside failed/undeliverable/pending, and drops it when the state moves on', () => {
    const m = createDeliveryStateMap();
    m.set('m1', 'pending');
    m.set('m1', 'failed', { reason: 'persona-no-connection' });
    expect(m.get('m1')).toBe('failed');
    expect(m.reasonOf('m1')).toBe('persona-no-connection');
    m.set('m1', 'pending');           // a retry
    expect(m.reasonOf('m1')).toBe(null);
    m.set('m2', 'maybe-received', { reason: 'persona-no-connection' });
    expect(m.reasonOf('m2')).toBe(null);
    // …and beside a WAIT: held here for a reason the person can act on — dropped the moment it moves on
    m.set('m4', 'pending');
    m.set('m4', 'pending', { reason: 'persona-waiting' });
    expect(m.reasonOf('m4')).toBe('persona-waiting');
    m.set('m4', 'maybe-received');    // the held message went out
    expect(m.reasonOf('m4')).toBe(null);
    m.set('m5', 'pending', { reason: 'persona-waiting' });
    m.set('m5', 'stored');            // a receipt
    expect(m.reasonOf('m5')).toBe(null);
    m.set('m3', 'failed', { reason: 'x' }); m.clear('m3');
    expect(m.reasonOf('m3')).toBe(null);
  });
});
