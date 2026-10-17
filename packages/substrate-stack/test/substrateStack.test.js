/**
 * @onderling/substrate-stack — shared factory tests.
 *
 * Covers both entry shapes (agent-derived transport / injected transport),
 * deviceId resolution + validation, existingPseudoPod reuse, stop(), the
 * per-recipient publish adapter, and the VERSIONING composition seam
 * (build-opts store on the pod's own backend; end-to-end displaced-bytes
 * capture through pseudoPod.write; the existingPseudoPod incompatibility).
 */

import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';

import { createMemoryBackend } from '@onderling/pseudo-pod';
import { buildSubstrateStack, createAgentTransportAdapter } from '../src/index.js';

const sha256Json = async (content) => {
  const h = createHash('sha256');
  h.update(typeof content === 'string' ? content : JSON.stringify(content) ?? 'undefined', 'utf8');
  return h.digest('hex');
};

/** Duck-typed core Agent — enough for the transport adapter. */
function mockAgent({ address = 'dev-agent' } = {}) {
  const published = [];
  const transport = {
    publishOneWay: vi.fn(async (to, topic, wire) => { published.push({ to, topic, wire }); }),
    subscribeEnvelopes: vi.fn(() => () => {}),
  };
  return {
    address,
    published,
    transportFor: async () => transport,
    transportNames: ['internal'],
    getTransport: () => transport,
  };
}

const fakeTransport = () => ({
  publishEnvelope: vi.fn(async () => {}),
  subscribeEnvelopes: vi.fn(() => () => {}),
});

describe('buildSubstrateStack — entry shapes + validation', () => {
  it('builds from an agent (pinboard/tasks shape): adapter transport + agent.address deviceId', () => {
    const stack = buildSubstrateStack({ agent: mockAgent({ address: 'laptop-1' }) });
    expect(stack.deviceId).toBe('laptop-1');
    expect(typeof stack.transport.publishEnvelope).toBe('function');
    expect(stack.pseudoPod).toBeTruthy();
    expect(stack.podRouting).toBeTruthy();
    expect(stack.notifyEnvelope).toBeTruthy();
    expect(stack.versionStore).toBeNull();
    stack.stop();
  });

  it('builds from an injected transport (household shape) + explicit deviceId', () => {
    const stack = buildSubstrateStack({ transport: fakeTransport(), deviceId: 'devA' });
    expect(stack.deviceId).toBe('devA');
    stack.stop();
  });

  it('injected transport wins over the agent', () => {
    const injected = fakeTransport();
    const stack = buildSubstrateStack({ agent: mockAgent(), transport: injected, deviceId: 'd' });
    expect(stack.transport).toBe(injected);
    stack.stop();
  });

  it('throws without agent or transport', () => {
    expect(() => buildSubstrateStack({ deviceId: 'd' })).toThrow(/transport/);
  });

  it('throws without a resolvable deviceId', () => {
    expect(() => buildSubstrateStack({ transport: fakeTransport() })).toThrow(/deviceId/);
  });

  it('falls back to fallbackDeviceId when the agent has no address', () => {
    const agent = mockAgent({ address: null });
    const stack = buildSubstrateStack({ agent, fallbackDeviceId: 'pinboard-device' });
    expect(stack.deviceId).toBe('pinboard-device');
    stack.stop();
  });

  it('reuses an existingPseudoPod (same reference)', () => {
    const first = buildSubstrateStack({ transport: fakeTransport(), deviceId: 'devA' });
    const second = buildSubstrateStack({
      transport: fakeTransport(), deviceId: 'devA', existingPseudoPod: first.pseudoPod,
    });
    expect(second.pseudoPod).toBe(first.pseudoPod);
    first.stop(); second.stop();
  });
});

describe('buildSubstrateStack — versioning composition seam (P2)', () => {
  it('build-opts versioning: constructs a store on the pod backend and captures displaced bytes end-to-end', async () => {
    const stack = buildSubstrateStack({
      transport: fakeTransport(),
      deviceId:  'devA',
      versioning: { hash: sha256Json, retention: { debounceMs: 0 } },
    });
    expect(stack.versionStore).toBeTruthy();

    const uri = 'pseudo-pod://devA/private/thing.json';
    await stack.pseudoPod.write(uri, 'v1');
    await stack.pseudoPod.write(uri, 'v2'); // displaces v1
    const versions = await stack.versionStore.list(uri, { withContent: true });
    expect(versions).toHaveLength(1);
    expect(versions[0].content).toBe('v1');
    expect(versions[0].writer).toBe('devA'); // multi-writer key carries the deviceId
    stack.stop();
  });

  it('accepts a prebuilt duck-typed store', async () => {
    const capture = vi.fn(async () => {});
    const stack = buildSubstrateStack({
      transport: fakeTransport(), deviceId: 'devA',
      versioning: { capture },
    });
    expect(stack.versionStore).toEqual({ capture });
    const uri = 'pseudo-pod://devA/x';
    await stack.pseudoPod.write(uri, 'a');
    await stack.pseudoPod.write(uri, 'b');
    expect(capture).toHaveBeenCalledWith(uri, 'a');
    stack.stop();
  });

  it('throws on versioning + existingPseudoPod (injection-time seam)', () => {
    const first = buildSubstrateStack({ transport: fakeTransport(), deviceId: 'devA' });
    expect(() => buildSubstrateStack({
      transport: fakeTransport(), deviceId: 'devA',
      existingPseudoPod: first.pseudoPod,
      versioning: { hash: sha256Json },
    })).toThrow(/existingPseudoPod/);
    first.stop();
  });

  it('throws on a versioning value that is neither store nor build opts', () => {
    expect(() => buildSubstrateStack({
      transport: fakeTransport(), deviceId: 'devA', versioning: { bogus: true },
    })).toThrow(/versioning/);
  });

  it('respects a custom backend for pod + version store alike', async () => {
    const backend = createMemoryBackend();
    const stack = buildSubstrateStack({
      transport: fakeTransport(), deviceId: 'devA', backend,
      versioning: { hash: sha256Json, retention: { debounceMs: 0 } },
    });
    const uri = 'pseudo-pod://devA/y';
    await stack.pseudoPod.write(uri, 'one');
    await stack.pseudoPod.write(uri, 'two');
    const versionKeys = await backend.list('versions/');
    expect(versionKeys).toHaveLength(1); // snapshots live on the SAME injected backend
    stack.stop();
  });
});

describe('createAgentTransportAdapter — per-recipient routing (lifted verbatim)', () => {
  it('publishes to every recipient via agent.transportFor', async () => {
    const agent = mockAgent();
    const adapter = createAgentTransportAdapter(agent);
    await adapter.publishEnvelope({
      kind: 'pseudo-pod.write', recipients: ['peer-1', 'peer-2'], ref: 'x', payload: { a: 1 },
    });
    expect(agent.published).toHaveLength(2);
    expect(agent.published.map((p) => p.to).sort()).toEqual(['peer-1', 'peer-2']);
    expect(agent.published[0].topic).toBe('envelope:pseudo-pod.write');
    expect(agent.published[0].wire).toMatchObject({ v: 1, kind: 'pseudo-pod.write', ref: 'x' });
  });

  it('no-ops on empty recipients and throws on a missing kind', async () => {
    const adapter = createAgentTransportAdapter(mockAgent());
    await expect(adapter.publishEnvelope({ recipients: [] })).resolves.toBeUndefined();
    await expect(adapter.publishEnvelope({ recipients: ['p'] })).rejects.toThrow(/kind/);
  });

  it('subscribeEnvelopes subscribes every named transport and returns a working un-subscriber', () => {
    const agent = mockAgent();
    const adapter = createAgentTransportAdapter(agent);
    const cb = () => {};
    const off = adapter.subscribeEnvelopes(cb);
    expect(agent.getTransport('internal').subscribeEnvelopes).toHaveBeenCalledWith(cb);
    expect(() => off()).not.toThrow();
  });
});
