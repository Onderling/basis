/**
 * S6.6 (mobile) — native push orchestration. Injects fake expo-notifications /
 * expo-device so the register flow is testable without the native dep. Asserts
 * the RESULT: a granted permission yields an Expo token forwarded to
 * pinboard.subscribeExpoPush; denied/simulator paths short-circuit.
 */
import { describe, it, expect, vi } from 'vitest';
import Module from 'module';
import { enableNativePush, disableNativePush, getNativePushState } from '../src/v2/nativePush.js';
// presentLocalNotification was folded into the shared push module (RN ports-and-adapters,
// invariant #3). Same behaviour, now imported from @onderling/react-native/push.
import { presentLocalNotification } from '@onderling/react-native/push';

/**
 * Force the "native module absent" condition. expo-notifications / expo-device
 * are real installed deps, so in the vitest node env `require(…)` resolves them
 * and the module-absent fallback can't be reached by simply omitting deps. This
 * makes the module loader throw MODULE_NOT_FOUND for those specifiers — exactly
 * what Node's require does on a device/build where the native dep isn't present.
 * Runs `fn`, always restores the loader.
 */
async function withNativeModulesAbsent(fn) {
  const orig = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'expo-notifications' || request === 'expo-device') {
      throw Object.assign(new Error(`Cannot find module '${request}'`), { code: 'MODULE_NOT_FOUND' });
    }
    return orig.call(this, request, ...rest);
  };
  try { return await fn(); } finally { Module._load = orig; }
}

const TOKEN = 'ExponentPushToken[xyz]';
const fakeDevice = (isDevice = true) => ({ isDevice });
const fakeNotifications = ({ granted = true } = {}) => ({
  getPermissionsAsync: vi.fn(async () => ({ granted })),
  requestPermissionsAsync: vi.fn(async () => ({ granted })),
  getExpoPushTokenAsync: vi.fn(async () => ({ data: TOKEN })),
});

describe('enableNativePush', () => {
  it('requests permission, gets the Expo token, registers it with pinboard', async () => {
    const notifications = fakeNotifications();
    const callSkill = vi.fn(async () => ({ ok: true }));
    const res = await enableNativePush({ callSkill, notifications, device: fakeDevice() });
    expect(res).toEqual({ ok: true, token: TOKEN });
    expect(notifications.requestPermissionsAsync).toHaveBeenCalled();
    expect(callSkill).toHaveBeenCalledWith('pinboard', 'subscribeExpoPush', { token: TOKEN });
  });

  it('short-circuits on a simulator (no real device)', async () => {
    const callSkill = vi.fn();
    const res = await enableNativePush({ callSkill, notifications: fakeNotifications(), device: fakeDevice(false) });
    expect(res).toEqual({ ok: false, reason: 'simulator' });
    expect(callSkill).not.toHaveBeenCalled();
  });

  it('stops at the permission gate when denied', async () => {
    const callSkill = vi.fn();
    const res = await enableNativePush({ callSkill, notifications: fakeNotifications({ granted: false }), device: fakeDevice() });
    expect(res).toEqual({ ok: false, reason: 'denied' });
    expect(callSkill).not.toHaveBeenCalled();
  });

  it('reports register-failed when pinboard rejects the token', async () => {
    const callSkill = vi.fn(async () => ({ error: 'nope' }));
    const res = await enableNativePush({ callSkill, notifications: fakeNotifications(), device: fakeDevice() });
    expect(res).toMatchObject({ ok: false, reason: 'register-failed' });
  });
});

describe('disableNativePush', () => {
  it('deregisters the token at pinboard', async () => {
    const callSkill = vi.fn(async () => ({ ok: true }));
    expect(await disableNativePush({ callSkill, token: TOKEN })).toEqual({ ok: true });
    expect(callSkill).toHaveBeenCalledWith('pinboard', 'unsubscribeExpoPush', { token: TOKEN });
  });
});

describe('getNativePushState', () => {
  it('reflects granted permission on a real device', async () => {
    const state = await getNativePushState({ notifications: fakeNotifications({ granted: true }), device: fakeDevice() });
    expect(state).toEqual({ supported: true, granted: true });
  });
  it('reports unsupported when the native module is absent', async () => {
    // No injected deps + module loader throws MODULE_NOT_FOUND → require throws → unsupported.
    const state = await withNativeModulesAbsent(() => getNativePushState());
    expect(state.supported).toBe(false);
  });
});

describe('presentLocalNotification (verify-summary nudge — mobile parity)', () => {
  it('schedules an immediate local notification when permission is granted', async () => {
    const scheduled = [];
    const notifications = {
      getPermissionsAsync: vi.fn(async () => ({ granted: true })),
      scheduleNotificationAsync: vi.fn(async (n) => { scheduled.push(n); }),
    };
    const ok = await presentLocalNotification({ title: 'Feedback', body: 'verify', data: { round: 1 }, notifications });
    expect(ok).toBe(true);
    expect(scheduled[0].content.title).toBe('Feedback');
    expect(scheduled[0].content.body).toBe('verify');
    expect(scheduled[0].trigger).toBe(null);   // present now
  });

  it('no-ops (false) when permission is not granted', async () => {
    const notifications = {
      getPermissionsAsync: vi.fn(async () => ({ granted: false })),
      scheduleNotificationAsync: vi.fn(async () => { throw new Error('must not schedule'); }),
    };
    expect(await presentLocalNotification({ title: 'x', notifications })).toBe(false);
    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});
