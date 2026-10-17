/**
 * nativePush — S6.6 mobile-native push orchestration (RN, expo).
 *
 * The mobile counterpart to web's src/web/webPushClient.js. Instead of a service
 * worker + VAPID PushSubscription, it registers an Expo push token
 * (`ExponentPushToken[…]`) with pinboard's `subscribeExpoPush`; the Node-hosted
 * pinboard delivers via ExpoPushSender. The expo modules (expo-notifications,
 * expo-device) are LAZY-required + injectable so this orchestration is
 * unit-testable without the native dep — mirrors attachmentPicker.js.
 *
 * NB: requires `expo-notifications` + `expo-device` to be installed and a dev
 * build on a PHYSICAL device (Expo push tokens aren't issued in a simulator).
 */

/* eslint-disable global-require */
function loadDeps({ notifications, device } = {}) {
  return {
    Notifications: notifications || require('expo-notifications'),
    Device: device || require('expo-device'),
  };
}
/* eslint-enable global-require */

/** Read current permission state without prompting. { supported, granted }. */
export async function getNativePushState(deps = {}) {
  let Notifications, Device;
  try { ({ Notifications, Device } = loadDeps(deps)); } catch { return { supported: false, granted: false }; }
  const supported = Device?.isDevice !== false;   // simulators can't receive push
  try {
    const perm = await Notifications.getPermissionsAsync();
    return { supported, granted: perm?.granted === true };
  } catch { return { supported, granted: false }; }
}

/**
 * Turn notifications ON: ensure a real device → request permission → get the
 * Expo push token → register it with pinboard. Returns {ok, reason?, token?}.
 *
 * @param {object} args
 * @param {Function} args.callSkill            (app, op, args) => Promise
 * @param {string}  [args.projectId]           Expo projectId (EAS); some setups need it
 * @param {object}  [args.notifications]       injected expo-notifications (testing)
 * @param {object}  [args.device]              injected expo-device (testing)
 */
export async function enableNativePush({ callSkill, projectId, notifications, device } = {}) {
  let Notifications, Device;
  try { ({ Notifications, Device } = loadDeps({ notifications, device })); }
  catch { return { ok: false, reason: 'unsupported' }; }

  if (Device?.isDevice === false) return { ok: false, reason: 'simulator' };

  const perm = await Notifications.requestPermissionsAsync();
  if (perm?.granted !== true) return { ok: false, reason: 'denied' };

  let token;
  try {
    const res = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    token = res?.data;
  } catch (err) { return { ok: false, reason: 'token-failed', error: err?.message ?? String(err) }; }
  if (!token) return { ok: false, reason: 'token-failed' };

  const r = await callSkill('pinboard', 'subscribeExpoPush', { token });
  if (r?.error) return { ok: false, reason: 'register-failed', error: r.error };
  return { ok: true, token };
}

/** Turn notifications OFF: deregister this device's token (or all of mine). */
export async function disableNativePush({ callSkill, token } = {}) {
  await callSkill('pinboard', 'unsubscribeExpoPush', token ? { token } : {}).catch(() => {});
  return { ok: true };
}

// `presentLocalNotification` (the verify-summary nudge's local notification) was
// folded into the shared `@onderling/react-native/push` module + `PushAdapter.presentLocal()`
// (RN ports-and-adapters, invariant #3 — logic lives once). Import it from
// `@onderling/react-native/push`, not from here.
