/**
 * S5 — web-push subscription orchestration. @vitest-environment happy-dom
 *
 * Verifies the RESULT of the client half (not just that a button fired): enable
 * registers the SW, requests permission, fetches the VAPID key, calls
 * pushManager.subscribe with the right application server key, and forwards the
 * subscription JSON to pinboard.subscribeWebPush; disable drops + deregisters it.
 * Browser primitives are injected as fakes.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  urlBase64ToUint8Array, webPushSupported, getWebPushState, enableWebPush, disableWebPush,
} from '../src/web/webPushClient.js';

// A valid base64url VAPID public key (65 bytes uncompressed P-256, as pinboard emits).
const VAPID = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8';

function fakeNav({ subscription = null } = {}) {
  const subscribe = vi.fn(async () => ({
    endpoint: 'https://push.example/abc',
    toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'x', auth: 'y' } }),
    unsubscribe: vi.fn(async () => true),
  }));
  const getSubscription = vi.fn(async () => subscription);
  const reg = { pushManager: { subscribe, getSubscription } };
  return {
    serviceWorker: { register: vi.fn(async () => reg), ready: Promise.resolve(reg) },
    _reg: reg,
  };
}
const fakeNotification = (permission = 'default') => ({
  permission,
  requestPermission: vi.fn(async () => 'granted'),
});

describe('urlBase64ToUint8Array', () => {
  it('decodes a base64url VAPID key to the expected 65-byte array', () => {
    const out = urlBase64ToUint8Array(VAPID);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBeGreaterThanOrEqual(64);
    expect(out[0]).toBe(0x04); // uncompressed-point prefix
  });
});

describe('webPushSupported', () => {
  it('is false without a Notification API', () => {
    expect(webPushSupported({ nav: { serviceWorker: {} }, notification: undefined })).toBe(false);
  });
});

describe('enableWebPush', () => {
  it('subscribes with the VAPID key + forwards the subscription to pinboard', async () => {
    const nav = fakeNav();
    const notification = fakeNotification();
    const callSkill = vi.fn(async (app, op) => {
      if (op === 'getVapidPublicKey') return { publicKey: VAPID };
      if (op === 'subscribeWebPush') return { ok: true };
      return {};
    });

    const res = await enableWebPush({ callSkill, nav, notification });
    expect(res).toEqual({ ok: true });

    expect(notification.requestPermission).toHaveBeenCalled();
    expect(nav.serviceWorker.register).toHaveBeenCalledWith('/sw.js');

    // subscribe got userVisibleOnly + the decoded key
    const subOpts = nav._reg.pushManager.subscribe.mock.calls[0][0];
    expect(subOpts.userVisibleOnly).toBe(true);
    expect(subOpts.applicationServerKey).toBeInstanceOf(Uint8Array);

    // the subscription JSON reached pinboard
    expect(callSkill).toHaveBeenCalledWith('pinboard', 'subscribeWebPush', {
      subscription: { endpoint: 'https://push.example/abc', keys: { p256dh: 'x', auth: 'y' } },
    });
  });

  it('stops at the permission gate when the user denies', async () => {
    const nav = fakeNav();
    const notification = { permission: 'default', requestPermission: vi.fn(async () => 'denied') };
    const callSkill = vi.fn(async () => ({}));
    const res = await enableWebPush({ callSkill, nav, notification });
    expect(res).toEqual({ ok: false, reason: 'denied' });
    expect(callSkill).not.toHaveBeenCalled();
  });

  it('reports push-disabled when the server has no VAPID key (browser-only bundle)', async () => {
    const nav = fakeNav();
    const notification = fakeNotification();
    const callSkill = vi.fn(async (app, op) => (op === 'getVapidPublicKey' ? { publicKey: null } : {}));
    const res = await enableWebPush({ callSkill, nav, notification });
    expect(res).toEqual({ ok: false, reason: 'push-disabled' });
    expect(nav._reg.pushManager.subscribe).not.toHaveBeenCalled();
  });
});

describe('disableWebPush', () => {
  it('unsubscribes the browser sub + deregisters the endpoint at pinboard', async () => {
    const existing = { endpoint: 'https://push.example/abc', unsubscribe: vi.fn(async () => true) };
    const nav = fakeNav({ subscription: existing });
    const callSkill = vi.fn(async () => ({ ok: true }));
    const res = await disableWebPush({ callSkill, nav });
    expect(res).toEqual({ ok: true });
    expect(existing.unsubscribe).toHaveBeenCalled();
    expect(callSkill).toHaveBeenCalledWith('pinboard', 'unsubscribeWebPush', { endpoint: 'https://push.example/abc' });
  });
});

describe('getWebPushState', () => {
  it('reflects a live subscription', async () => {
    const nav = fakeNav({ subscription: { endpoint: 'x' } });
    const state = await getWebPushState({ nav, notification: fakeNotification('granted') });
    expect(state).toMatchObject({ supported: true, permission: 'granted', subscribed: true });
  });
});
