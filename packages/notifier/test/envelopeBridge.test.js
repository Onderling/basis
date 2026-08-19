/**
 * createEnvelopeBridge — scheduled notify-envelope delivery.
 *
 * Uses the real Notifier with fake timers + a mock NotifyEnvelope so
 * we can fast-forward to the trigger time and observe the publish.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Notifier } from '../src/Notifier.js';
import { createEnvelopeBridge, DEFAULT_CHANNEL_NAME } from '../src/envelopeBridge.js';

function makeMockNotifyEnvelope() {
  const published = [];
  return {
    published,
    async publish(args) {
      published.push(args);
    },
  };
}

function makeRig({ failPublish = false } = {}) {
  const notifyEnvelope = failPublish
    ? {
        published: [],
        async publish() { throw new Error('relay down'); },
      }
    : makeMockNotifyEnvelope();

  const channels = {};   // bridge populates this with the noop slot
  const notifier = new Notifier({
    channels,
    now:           () => Date.now(),
    setTimeoutFn:  setTimeout,
    clearTimeoutFn: clearTimeout,
  });
  const bridge = createEnvelopeBridge({
    notifier,
    notifyEnvelope,
    channels,
  });
  return { notifier, notifyEnvelope, bridge, channels };
}

describe('createEnvelopeBridge — input validation', () => {
  it('rejects missing notifier', () => {
    expect(() => createEnvelopeBridge({ notifyEnvelope: makeMockNotifyEnvelope() }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('rejects missing notifyEnvelope', () => {
    expect(() => createEnvelopeBridge({ notifier: { scheduleOnce: () => {} } }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});

describe('createEnvelopeBridge — channel registration', () => {
  it('registers a noop channel slot into the supplied channels object', () => {
    const channels = {};
    createEnvelopeBridge({
      notifier:       { scheduleOnce: async () => 'id', cancel: async () => {} },
      notifyEnvelope: makeMockNotifyEnvelope(),
      channels,
    });
    expect(channels[DEFAULT_CHANNEL_NAME]).toBeTruthy();
    expect(typeof channels[DEFAULT_CHANNEL_NAME].send).toBe('function');
  });

  it('does not clobber a pre-existing channel slot', () => {
    const existing = { send: async () => ({ pre: true }) };
    const channels = { [DEFAULT_CHANNEL_NAME]: existing };
    createEnvelopeBridge({
      notifier:       { scheduleOnce: async () => 'id', cancel: async () => {} },
      notifyEnvelope: makeMockNotifyEnvelope(),
      channels,
    });
    expect(channels[DEFAULT_CHANNEL_NAME]).toBe(existing);
  });

  it('respects a caller-supplied channel name', () => {
    const channels = {};
    const b = createEnvelopeBridge({
      notifier:       { scheduleOnce: async () => 'id', cancel: async () => {} },
      notifyEnvelope: makeMockNotifyEnvelope(),
      channels,
      channelName:    'custom-envelope',
    });
    expect(b.channelName).toBe('custom-envelope');
    expect(channels['custom-envelope']).toBeTruthy();
  });
});

describe('scheduleEnvelope — input validation', () => {
  let bridge;
  beforeEach(() => {
    bridge = createEnvelopeBridge({
      notifier:       { scheduleOnce: async () => 'id', cancel: async () => {} },
      notifyEnvelope: makeMockNotifyEnvelope(),
    });
  });

  it('rejects missing triggerAt', async () => {
    await expect(bridge.scheduleEnvelope({
      type: 'task', ref: 'pseudo-pod://x', recipients: ['a'],
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects missing type', async () => {
    await expect(bridge.scheduleEnvelope({
      triggerAt: 1, ref: 'x', recipients: ['a'],
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects missing ref', async () => {
    await expect(bridge.scheduleEnvelope({
      triggerAt: 1, type: 't', recipients: ['a'],
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects empty recipients', async () => {
    await expect(bridge.scheduleEnvelope({
      triggerAt: 1, type: 't', ref: 'x', recipients: [],
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('scheduleEnvelope — end-to-end with the Notifier scheduler', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('publishes the envelope when the timer fires', async () => {
    const { notifier, notifyEnvelope, bridge } = makeRig();
    await notifier.start();

    const triggerAt = Date.now() + 10_000;
    await bridge.scheduleEnvelope({
      triggerAt,
      type:        'announcement',
      ref:         'pseudo-pod://anne/announcements/abc',
      etag:        '"v1"',
      payload:     { body: 'expiring offer reminder' },
      recipients:  ['agent://bob', 'agent://carol'],
      fromActor:   'agent://anne',
      circleId:      'circle-abc',
    });

    // Before the timer fires, nothing has been published.
    expect(notifyEnvelope.published).toHaveLength(0);

    // Advance past triggerAt + let any pending microtasks settle.
    await vi.advanceTimersByTimeAsync(11_000);
    expect(notifyEnvelope.published).toHaveLength(1);
    expect(notifyEnvelope.published[0]).toMatchObject({
      type:        'announcement',
      ref:         'pseudo-pod://anne/announcements/abc',
      etag:        '"v1"',
      payload:     { body: 'expiring offer reminder' },
      recipients:  ['agent://bob', 'agent://carol'],
      fromActor:   'agent://anne',
      circleId:      'circle-abc',
    });

    await notifier.stop();
    vi.useRealTimers();
  });

  it('omits optional fields cleanly when absent', async () => {
    const { notifier, notifyEnvelope, bridge } = makeRig();
    await notifier.start();
    await bridge.scheduleEnvelope({
      triggerAt:   Date.now() + 1_000,
      type:        'task',
      ref:         'pseudo-pod://anne/tasks/a',
      recipients:  ['agent://bob'],
    });
    await vi.advanceTimersByTimeAsync(2_000);
    const p = notifyEnvelope.published[0];
    expect(p.etag).toBeUndefined();
    expect(p.payload).toBeUndefined();
    expect(p.fromActor).toBeUndefined();
    expect(p.circleId).toBeUndefined();
    await notifier.stop();
    vi.useRealTimers();
  });

  it('publish errors do not break the scheduler', async () => {
    const { notifier, bridge } = makeRig({ failPublish: true });
    await notifier.start();
    await bridge.scheduleEnvelope({
      triggerAt:   Date.now() + 1_000,
      type:        'task',
      ref:         'pseudo-pod://x',
      recipients:  ['a'],
    });
    // Should not throw despite the publish failure inside the builder.
    let threw = null;
    try { await vi.advanceTimersByTimeAsync(2_000); }
    catch (err) { threw = err; }
    expect(threw).toBe(null);
    await notifier.stop();
    vi.useRealTimers();
  });

  it('cancel removes the pending job', async () => {
    const { notifier, notifyEnvelope, bridge } = makeRig();
    await notifier.start();
    await bridge.scheduleEnvelope({
      triggerAt:   Date.now() + 5_000,
      type:        'task',
      ref:         'pseudo-pod://x',
      recipients:  ['a'],
      cancelKey:   'remind-anne',
    });
    await bridge.cancel('remind-anne');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(notifyEnvelope.published).toHaveLength(0);
    await notifier.stop();
    vi.useRealTimers();
  });
});
