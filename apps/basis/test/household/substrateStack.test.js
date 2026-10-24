import { describe, it, expect, vi } from 'vitest';
import { buildHouseholdSubstrateStack } from '../../src/household/substrateStack.js';

/**
 * A fake notify-envelope transport adapter: the {publishEnvelope,
 * subscribeEnvelopes} shape the host (basis) would inject.
 * `captured` records the subscriber callback so we can confirm
 * notifyEnvelope.start() hooked the transport.
 */
function makeFakeTransport() {
  let captured = null;
  const fake = {
    publishEnvelope: vi.fn(async () => {}),
    subscribeEnvelopes: vi.fn((cb) => { captured = cb; return () => {}; }),
  };
  return { fake, getCaptured: () => captured };
}

describe('buildHouseholdSubstrateStack', () => {
  it('builds the stack and starts the injected transport', () => {
    const { fake } = makeFakeTransport();
    const stack = buildHouseholdSubstrateStack({ transport: fake, deviceId: 'devA' });

    expect(stack.pseudoPod).toBeTruthy();
    expect(stack.podRouting).toBeTruthy();
    expect(stack.notifyEnvelope).toBeTruthy();
    expect(stack.transport).toBe(fake);
    expect(stack.deviceId).toBe('devA');
    expect(typeof stack.stop).toBe('function');

    // notifyEnvelope.start() (run inside the builder) hooks the transport.
    expect(fake.subscribeEnvelopes).toHaveBeenCalled();
  });

  it('routes published items through the injected transport', async () => {
    const { fake } = makeFakeTransport();
    const stack = buildHouseholdSubstrateStack({ transport: fake, deviceId: 'devA' });

    await stack.notifyEnvelope.publish({
      type: 'household-item',
      ref: 'pseudo-pod://devA/household/circles/c1/items/1',
      payload: { id: '1' },
      recipients: ['B'],
    });

    expect(fake.publishEnvelope).toHaveBeenCalledTimes(1);
    const wire = fake.publishEnvelope.mock.calls[0][0];
    expect(wire.kind).toBe('household-item');
    expect(wire.recipients).toContain('B');
  });

  it('throws when required args are missing', () => {
    const { fake } = makeFakeTransport();
    expect(() => buildHouseholdSubstrateStack({ deviceId: 'd' })).toThrow(/transport/);
    expect(() => buildHouseholdSubstrateStack({ transport: fake })).toThrow(/deviceId/);
  });

  it('stop() tears down without throwing', () => {
    const { fake } = makeFakeTransport();
    const stack = buildHouseholdSubstrateStack({ transport: fake, deviceId: 'devA' });
    expect(() => stack.stop()).not.toThrow();
  });
});
