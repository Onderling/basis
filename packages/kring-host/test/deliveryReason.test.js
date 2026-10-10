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
  it('the map keeps a reason only beside failed/undeliverable, and drops it when the state moves on', () => {
    const m = createDeliveryStateMap();
    m.set('m1', 'pending');
    m.set('m1', 'failed', { reason: 'persona-no-connection' });
    expect(m.get('m1')).toBe('failed');
    expect(m.reasonOf('m1')).toBe('persona-no-connection');
    m.set('m1', 'pending');           // a retry
    expect(m.reasonOf('m1')).toBe(null);
    m.set('m2', 'maybe-received', { reason: 'persona-no-connection' });
    expect(m.reasonOf('m2')).toBe(null);
    m.set('m3', 'failed', { reason: 'x' }); m.clear('m3');
    expect(m.reasonOf('m3')).toBe(null);
  });
});
