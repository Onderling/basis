/**
 * IHubBinding — method surface + callback + close lifecycle.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IHubBinding } from '../../src/hub-binding/IHubBinding.js';

function nativeMock({ results = {} } = {}) {
  const calls = [];
  const callbacks = new Set();
  return {
    calls,
    callbacks,
    async callMethod(bindingId, methodName, args) {
      calls.push({ bindingId, methodName, args });
      return results[methodName] ?? null;
    },
    registerIncomingCallback(bindingId, cb) {
      const wrapped = (raw) => cb(raw);
      callbacks.add(wrapped);
      return () => { callbacks.delete(wrapped); };
    },
    async unbindService(bindingId) {
      calls.push({ name: 'unbindService', bindingId });
    },
    /** test helper — fire an inbound envelope into every registered callback */
    emit(raw) { for (const cb of callbacks) cb(raw); },
  };
}

function mkBinding({ version = 1, results } = {}) {
  const native = nativeMock({ results });
  const b = new IHubBinding({
    nativeModule: native,
    bindingId:    'b-1',
    sessionId:    'session-1',
    version,
  });
  return { native, b };
}

describe('IHubBinding — construction', () => {
  it('rejects missing callMethod', () => {
    expect(() => new IHubBinding({ nativeModule: {}, bindingId: 'x', sessionId: 'y', version: 1 }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('exposes negotiated version + ids', () => {
    const { b } = mkBinding({ version: 2 });
    expect(b.version).toBe(2);
    expect(b.bindingId).toBe('b-1');
    expect(b.sessionId).toBe('session-1');
    expect(b.isClosed).toBe(false);
  });
});

describe('method delegation', () => {
  let native; let b;
  beforeEach(() => {
    const r = mkBinding({
      results: {
        fetchResource:    new Uint8Array([1, 2, 3]),
        writeResource:    '"v3"',
        publishEnvelope:  null,
        declareCapabilities: 'ok',
      },
    });
    native = r.native; b = r.b;
  });

  it('fetchResource passes uri + sessionId', async () => {
    const res = await b.fetchResource('pseudo-pod://x/y');
    expect(res).toEqual(new Uint8Array([1, 2, 3]));
    expect(native.calls[0]).toMatchObject({
      methodName: 'fetchResource',
      args: { bundleSessionId: 'session-1', uri: 'pseudo-pod://x/y' },
    });
  });

  it('writeResource passes bytes + etag', async () => {
    const buf = new Uint8Array([9, 9, 9]);
    const etag = await b.writeResource('pseudo-pod://x', buf, '"prev"');
    expect(etag).toBe('"v3"');
    expect(native.calls[0].args).toMatchObject({
      bundleSessionId: 'session-1',
      uri:    'pseudo-pod://x',
      bytes:  buf,
      etag:   '"prev"',
    });
  });

  it('writeResource defaults etag to empty string when omitted', async () => {
    await b.writeResource('pseudo-pod://x', new Uint8Array([1]));
    expect(native.calls[0].args.etag).toBe('');
  });

  it('publishEnvelope marshals to JSON + recipients CSV', async () => {
    await b.publishEnvelope(
      { kind: 'task', ref: 'pseudo-pod://x', etag: '"e"' },
      ['agent://a', 'agent://b'],
    );
    expect(native.calls[0].args.envelopeJson).toContain('"kind":"task"');
    expect(native.calls[0].args.recipientsCsv).toBe('agent://a,agent://b');
  });

  it('declareCapabilities marshals to JSON', async () => {
    await b.declareCapabilities({ caps: ['pinboard'] });
    expect(JSON.parse(native.calls[0].args.capabilitiesJson)).toEqual({ caps: ['pinboard'] });
  });

  it('rejects missing required args', async () => {
    await expect(b.fetchResource('')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(b.writeResource('')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(b.publishEnvelope(null, ['a'])).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(b.publishEnvelope({ kind: 'x' }, [])).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('onIncomingEnvelope — callback path (Phase 51.9.1)', () => {
  it('fires subscribers when the native bridge delivers an envelope', () => {
    const { native, b } = mkBinding();
    const got = [];
    b.onIncomingEnvelope((env) => got.push(env));
    native.emit({ kind: 'task', ref: 'pseudo-pod://x' });
    expect(got).toEqual([{ kind: 'task', ref: 'pseudo-pod://x' }]);
  });

  it('parses string-encoded envelopes (some Android bridges hand back JSON strings)', () => {
    const { native, b } = mkBinding();
    const got = [];
    b.onIncomingEnvelope((env) => got.push(env));
    native.emit('{"kind":"task"}');
    expect(got).toEqual([{ kind: 'task' }]);
  });

  it('multiple subscribers all fire', () => {
    const { native, b } = mkBinding();
    const a = []; const c = [];
    b.onIncomingEnvelope((e) => a.push(e));
    b.onIncomingEnvelope((e) => c.push(e));
    native.emit({ kind: 'note' });
    expect(a).toHaveLength(1);
    expect(c).toHaveLength(1);
  });

  it('lazy native-callback registration; unsubscribed after last drop', () => {
    const { native, b } = mkBinding();
    expect(native.callbacks.size).toBe(0);
    const u1 = b.onIncomingEnvelope(() => {});
    expect(native.callbacks.size).toBe(1);
    const u2 = b.onIncomingEnvelope(() => {});
    expect(native.callbacks.size).toBe(1);   // lazy — still one native registration
    u1();
    expect(native.callbacks.size).toBe(1);   // still subscribed
    u2();
    expect(native.callbacks.size).toBe(0);
  });

  it('subscriber errors are swallowed', () => {
    const { native, b } = mkBinding();
    const good = [];
    b.onIncomingEnvelope(() => { throw new Error('bang'); });
    b.onIncomingEnvelope((e) => good.push(e));
    native.emit({ kind: 'x' });
    expect(good).toHaveLength(1);
  });
});

describe('V2-only methods', () => {
  it('throws VERSION_UNSUPPORTED on a V1 binding', async () => {
    const { b } = mkBinding({ version: 1 });
    await expect(b.registerInterface({}))
      .rejects.toMatchObject({ code: 'VERSION_UNSUPPORTED', negotiatedVersion: 1 });
    await expect(b.lookupInterface('task'))
      .rejects.toMatchObject({ code: 'VERSION_UNSUPPORTED' });
    await expect(b.orchestrateProtocol('p', {}))
      .rejects.toMatchObject({ code: 'VERSION_UNSUPPORTED' });
  });

  it('works on a V2 binding', async () => {
    const { native, b } = mkBinding({
      version: 2,
      results: { registerInterface: 'ok', lookupInterface: '{}' },
    });
    await b.registerInterface({ type: 'task' });
    expect(native.calls[0].methodName).toBe('registerInterface');
    await b.lookupInterface('task');
    expect(native.calls[1].methodName).toBe('lookupInterface');
  });
});

describe('close lifecycle', () => {
  it('further calls throw BINDING_CLOSED', async () => {
    const { b } = mkBinding();
    await b.close();
    expect(b.isClosed).toBe(true);
    await expect(b.fetchResource('uri')).rejects.toMatchObject({ code: 'BINDING_CLOSED' });
  });

  it('close is idempotent', async () => {
    const { native, b } = mkBinding();
    await b.close();
    await b.close();
    const unbinds = native.calls.filter(c => c.name === 'unbindService');
    expect(unbinds.length).toBeLessThanOrEqual(1);
  });

  it('close drops native callback registration', async () => {
    const { native, b } = mkBinding();
    b.onIncomingEnvelope(() => {});
    expect(native.callbacks.size).toBe(1);
    await b.close();
    expect(native.callbacks.size).toBe(0);
  });
});
