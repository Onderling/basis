/**
 * createNotifyEnvelope.publish — wire-shape selection per scenario.
 *
 * Uses fake transport + real pseudo-pod + real pod-routing so the
 * decision pipeline matches production wiring.
 */

import { describe, it, expect } from 'vitest';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createPodRouting } from '@onderling/pod-routing';
import { createNotifyEnvelope } from '../src/NotifyEnvelope.js';

function fakeTransport() {
  const sent = [];
  let inboxCb = null;
  return {
    sent,
    async publishEnvelope(env) { sent.push(env); },
    subscribeEnvelopes(cb) { inboxCb = cb; return () => { inboxCb = null; }; },
    /** Test helper to deliver an envelope to the substrate. */
    async deliver(payload, raw = {}) {
      if (inboxCb) await inboxCb(payload, raw);
    },
  };
}

function rig({ anchorPodUri = null, deviceId = 'd1', reachable = true } = {}) {
  const pseudoPod = createPseudoPod({
    backend:  createMemoryBackend(),
    mode:     'standalone',
    deviceId,
  });
  const podRouting = createPodRouting({ pseudoPod, deviceId, anchorPodUri });
  if (!reachable && anchorPodUri) podRouting.markPodUnreachable();
  const transport = fakeTransport();
  const ne = createNotifyEnvelope({ transport, pseudoPod, podRouting });
  return { pseudoPod, podRouting, transport, ne };
}

describe('publish — input validation', () => {
  it('throws on missing type', async () => {
    const { ne } = rig();
    await expect(ne.publish({ ref: 'pseudo-pod://d1/x', recipients: ['b'], payload: 1 }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('throws on missing ref', async () => {
    const { ne } = rig();
    await expect(ne.publish({ type: 'task', recipients: ['b'], payload: 1 }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('throws on missing recipients', async () => {
    const { ne } = rig();
    await expect(ne.publish({ type: 'task', ref: 'pseudo-pod://d1/x', payload: 1 }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('throws when full-payload mode is required but no payload supplied', async () => {
    const { ne } = rig();
    await expect(ne.publish({
      type: 'task',
      ref:  'pseudo-pod://d1/x',
      recipients: ['agent://bob'],
      // no payload — pseudo-pod ref forces full-payload mode
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('publish — envelope-only (pod-having, reachable)', () => {
  it('emits envelope without payload', async () => {
    const { ne, transport } = rig({
      anchorPodUri: 'https://anne.pod',
      reachable:    true,
    });
    const result = await ne.publish({
      type:       'task',
      ref:        'https://anne.pod/sharing/tasks/abc.ttl',
      etag:       '"v1"',
      payload:    { text: 'paint' },    // ignored in envelope-only mode
      recipients: ['agent://bob', 'agent://carol'],
      fromActor:  'agent://anne',
    });
    expect(result.mode).toBe('envelope-only');
    expect(result.queued).toBe(false);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toMatchObject({
      kind:       'task',
      ref:        'https://anne.pod/sharing/tasks/abc.ttl',
      etag:       '"v1"',
      fromActor:  'agent://anne',
      recipients: ['agent://bob', 'agent://carol'],
    });
    expect(transport.sent[0].payload).toBeUndefined();
    expect(await ne.pendingCount()).toBe(0);
  });
});

describe('publish — full-payload (no-pod or pseudo-pod ref)', () => {
  it('pseudo-pod ref → full-payload, no queue', async () => {
    const { ne, transport } = rig({ deviceId: 'd1' });
    const result = await ne.publish({
      type:       'task',
      ref:        'pseudo-pod://d1/tasks/abc',
      etag:       '"v-hash-1"',
      payload:    { text: 'paint' },
      recipients: ['agent://bob'],
      fromActor:  'pseudo-pod://d1/agent',
    });
    expect(result.mode).toBe('full-payload');
    expect(result.queued).toBe(false);
    expect(transport.sent[0].payload).toEqual({ text: 'paint' });
    expect(await ne.pendingCount()).toBe(0);
  });
});

describe('publish — graceful degradation (pod-having, unreachable)', () => {
  it('full-payload fan-out + queue', async () => {
    const { ne, transport, podRouting } = rig({
      anchorPodUri: 'https://anne.pod',
      reachable:    false,
    });
    expect(podRouting.isPodReachable()).toBe(false);

    const result = await ne.publish({
      type:       'task',
      ref:        'https://anne.pod/sharing/tasks/abc.ttl',
      etag:       '"v1"',
      payload:    { text: 'paint' },
      recipients: ['agent://bob'],
      fromActor:  'agent://anne',
      circleId:     'circle-abc',
    });
    expect(result.mode).toBe('full-payload');
    expect(result.queued).toBe(true);

    // Wire: full-payload over the relay.
    expect(transport.sent[0].payload).toEqual({ text: 'paint' });

    // Queue holds the entry.
    expect(await ne.pendingCount()).toBe(1);
    const pending = await ne.listPending();
    expect(pending[0]).toMatchObject({
      uri:        'https://anne.pod/sharing/tasks/abc.ttl',
      type:       'task',
      circleId:     'circle-abc',
      recipients: ['agent://bob'],
    });
  });
});

describe('drainQueue — re-emit envelope-only on success', () => {
  it('drainQueue with uploadFn drains + re-emits envelope-only', async () => {
    const pseudoPod = createPseudoPod({
      backend:  createMemoryBackend(),
      mode:     'standalone',
      deviceId: 'd1',
    });
    const podRouting = createPodRouting({
      pseudoPod,
      deviceId:     'd1',
      anchorPodUri: 'https://anne.pod',
    });
    podRouting.markPodUnreachable();
    const transport = fakeTransport();

    const uploaded = [];
    const ne = createNotifyEnvelope({
      transport,
      pseudoPod,
      podRouting,
      uploadFn: async (entry) => { uploaded.push(entry.uri); },
    });

    await ne.publish({
      type:       'task',
      ref:        'https://anne.pod/sharing/tasks/x.ttl',
      etag:       '"v1"',
      payload:    { text: 'a' },
      recipients: ['agent://bob'],
      fromActor:  'agent://anne',
    });
    expect(await ne.pendingCount()).toBe(1);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0].payload).toBeDefined();

    podRouting.markPodReachable();
    const result = await ne.drainQueue();
    expect(result.drained).toBe(1);
    expect(uploaded).toEqual(['https://anne.pod/sharing/tasks/x.ttl']);
    expect(await ne.pendingCount()).toBe(0);

    // Re-emit envelope-only (no payload, same ref).
    expect(transport.sent).toHaveLength(2);
    expect(transport.sent[1]).toMatchObject({
      kind:      'task',
      ref:       'https://anne.pod/sharing/tasks/x.ttl',
      etag:      '"v1"',
      fromActor: 'agent://anne',
    });
    expect(transport.sent[1].payload).toBeUndefined();
  });

  it('drainQueue is a no-op without uploadFn', async () => {
    const { ne, podRouting } = rig({ anchorPodUri: 'https://anne.pod', reachable: false });
    await ne.publish({
      type: 'task', ref: 'https://anne.pod/sharing/tasks/x', etag: 'e',
      payload: 1, recipients: ['agent://bob'], fromActor: 'agent://anne',
    });
    expect(await ne.pendingCount()).toBe(1);
    podRouting.markPodReachable();
    const r = await ne.drainQueue();
    expect(r.drained).toBe(0);
    expect(await ne.pendingCount()).toBe(1);
  });

  it('drainQueue marks pod reachable on first upload success', async () => {
    const pseudoPod = createPseudoPod({
      backend:  createMemoryBackend(),
      mode:     'standalone',
      deviceId: 'd1',
    });
    const podRouting = createPodRouting({
      pseudoPod,
      deviceId:     'd1',
      anchorPodUri: 'https://anne.pod',
    });
    podRouting.markPodUnreachable();
    const transport = fakeTransport();
    const ne = createNotifyEnvelope({
      transport, pseudoPod, podRouting,
      uploadFn: async () => {},
    });
    await ne.publish({
      type: 'task',
      ref:  'https://anne.pod/sharing/tasks/x',
      etag: 'e',
      payload: 1,
      recipients: ['agent://bob'],
      fromActor: 'agent://anne',
    });
    expect(podRouting.isPodReachable()).toBe(false);
    await ne.drainQueue();
    expect(podRouting.isPodReachable()).toBe(true);
  });
});
