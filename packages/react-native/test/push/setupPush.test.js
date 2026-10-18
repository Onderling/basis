/**
 * setupPush — substrate-level coverage. Mirrors the orchestration
 * checks apps/pinboard-mobile/test/push.test.js exercises through the
 * re-export shim.
 */

import { describe, it, expect, vi } from 'vitest';
import { setupPush, requestPushPermission } from '../../src/push/setupPush.js';

class FakeAdapter {
  constructor({ shouldFail = false, token = 'fake-token', platform = 'android' } = {}) {
    this.shouldFail = shouldFail;
    this.token      = token;
    this.platform   = platform;
    this.subscribers  = new Set();
    this.unregistered = false;
  }
  async register() {
    if (this.shouldFail) throw Object.assign(new Error('denied'), { code: 'PUSH_PERMISSION_DENIED' });
    return { token: this.token, platform: this.platform };
  }
  onNotification(h) { this.subscribers.add(h); return () => this.subscribers.delete(h); }
  async unregister() { this.unregistered = true; }
}

function makeAgentStub() {
  const events = new Map();
  return {
    address: 'agent://stub',
    skills:  { get: () => null },
    on: (evt, cb) => { (events.get(evt) ?? events.set(evt, new Set()).get(evt)).add(cb); },
    emit: (evt, payload) => { for (const cb of events.get(evt) ?? []) cb(payload); },
  };
}

describe('@onderling/react-native/push setupPush', () => {
  it('returns bridge + token + platform on success', async () => {
    const agent = makeAgentStub();
    const onToken = vi.fn();
    const r = await setupPush({
      agent,
      AdapterFactory: () => new FakeAdapter(),
      onToken,
    });
    expect(r.token).toBe('fake-token');
    expect(r.platform).toBe('android');
    expect(onToken).toHaveBeenCalledWith('fake-token', 'android');
    expect(r.bridge).toBeTruthy();
    await r.teardown();
  });

  it('resolves with null token when adapter throws', async () => {
    const onError = vi.fn();
    const r = await setupPush({
      agent: makeAgentStub(),
      AdapterFactory: () => new FakeAdapter({ shouldFail: true }),
      onError,
    });
    expect(r.token).toBeNull();
    expect(r.bridge).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('throws when agent is missing', async () => {
    await expect(setupPush({})).rejects.toThrow(/agent is required/);
  });
});

describe('@onderling/react-native/push requestPushPermission', () => {
  it('passes through {granted: true}', async () => {
    const r = await requestPushPermission({
      NotificationsModule: { requestPermissionsAsync: async () => ({ granted: true, status: 'granted' }) },
    });
    expect(r.granted).toBe(true);
    expect(r.status).toBe('granted');
  });
  it('passes through {granted: false}', async () => {
    const r = await requestPushPermission({
      NotificationsModule: { requestPermissionsAsync: async () => ({ granted: false, status: 'denied' }) },
    });
    expect(r.granted).toBe(false);
    expect(r.status).toBe('denied');
  });
});
