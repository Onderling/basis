/**
 * setupPush — bring up push notifications for the local agent.
 *
 * Lifted from apps/pinboard-mobile/src/lib/push.js 2026-05-09 (Phase
 * 41.0 L6; Tasks-mobile is the second consumer). Thin wrapper over
 * `MobilePushBridge` from `@onderling/react-native/transport`.
 *
 * Owns:
 *   - Permission gate — `requestPushPermission()` asks the OS once,
 *     resolves with `{granted, status}`.
 *   - Bring-up — `setupPush({agent, projectId, ...})` instantiates
 *     the bridge, registers for the device push token, surfaces it
 *     via `onToken`.
 *   - Tear-down — the returned `teardown` callback unregisters cleanly
 *     on sign-out.
 */

import { MobilePushBridge }
  from '../transport/MobilePushBridge.js';

/**
 * Lazy default — apps that never call setupPush shouldn't pay the
 * import cost. Tests inject `AdapterFactory` to skip this.
 */
async function _defaultAdapterFactory() {
  const mod = await import('../transport/pushAdapters/ExpoNotificationsAdapter.js');
  return new mod.ExpoNotificationsAdapter();
}

/**
 * @param {object} args
 * @param {object} args.agent
 * @param {string} [args.projectId]
 * @param {(token: string, platform: 'ios'|'android'|'web') => void} [args.onToken]
 * @param {(err: unknown) => void} [args.onError]
 * @param {() => object | Promise<object>} [args.AdapterFactory]
 * @returns {Promise<{
 *   bridge:   object | null,
 *   token:    string | null,
 *   platform: 'ios' | 'android' | 'web' | null,
 *   teardown: () => Promise<void>,
 * }>}
 */
export async function setupPush({
  agent,
  projectId,
  onToken,
  onError,
  AdapterFactory,
} = {}) {
  if (!agent) throw new Error('setupPush: agent is required');

  const factory = AdapterFactory ?? _defaultAdapterFactory;
  const adapter = await factory();
  const bridge  = new MobilePushBridge({ agent, adapter });

  let token    = null;
  let platform = null;
  try {
    const reg = await bridge.register({ projectId });
    token    = reg.token    ?? null;
    platform = reg.platform ?? null;
    if (token && onToken) onToken(token, platform);
  } catch (err) {
    if (onError) onError(err);
    return {
      bridge: null,
      token: null,
      platform: null,
      teardown: async () => {},
    };
  }

  return {
    bridge,
    token,
    platform,
    teardown: async () => {
      try { await bridge.unregister(); }
      catch (err) { if (onError) onError(err); }
    },
  };
}

/**
 * Ask the OS for notification permission. Idempotent.
 *
 * @param {object} [args]
 * @param {object} [args.NotificationsModule]   inject for tests; defaults
 *   to `await import('expo-notifications')`.
 * @returns {Promise<{ granted: boolean, status: string }>}
 */
export async function requestPushPermission({ NotificationsModule } = {}) {
  const Notifications = NotificationsModule ?? await _loadExpoNotifications();
  const r = await Notifications.requestPermissionsAsync();
  return {
    granted: r?.granted === true || r?.status === 'granted',
    status:  r?.status ?? (r?.granted ? 'granted' : 'denied'),
  };
}

async function _loadExpoNotifications() {
  const mod = await import('expo-notifications');
  return mod;
}

export const _internal = { _loadExpoNotifications, _defaultAdapterFactory };
