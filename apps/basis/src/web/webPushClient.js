/**
 * webPushClient — S5 web-push subscription orchestration (web platform).
 *
 * The CLIENT half of pinboard's Web Push tier: register the service worker, ask
 * permission, fetch the VAPID public key (`pinboard.getVapidPublicKey`), subscribe
 * via the browser `PushManager`, and forward the `PushSubscription` to
 * `pinboard.subscribeWebPush`. The SERVER half (VAPID-signed delivery via
 * `WebPushSender`) lives in a Node-hosted pinboard — in the browser-only bundle
 * `@onderling/relay` is shimmed so `getVapidPublicKey` is null + delivery is a
 * no-op; the subscription is still registered against the in-process registry.
 *
 * The browser primitives (`navigator`, `Notification`) are injected so the
 * orchestration is unit-testable with fakes — we verify the RESULT (the exact
 * pushManager.subscribe options + the subscription forwarded to pinboard), not just
 * that a button fired.
 */

/** VAPID keys are base64url; PushManager wants a Uint8Array application server key. */
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** Whether this environment can do Web Push at all. A missing PushManager later
 *  surfaces as a caught 'subscribe-failed' rather than a separate global probe
 *  (keeps the check injectable + honest about what we actually exercise). */
export function webPushSupported({ nav = globalThis.navigator, notification = globalThis.Notification } = {}) {
  return !!(nav && nav.serviceWorker && notification);
}

/**
 * Current state: { supported, permission, subscribed }. Reads the live
 * PushManager subscription so a freshly-loaded screen reflects reality.
 */
export async function getWebPushState({ nav = globalThis.navigator, notification = globalThis.Notification } = {}) {
  if (!webPushSupported({ nav, notification })) return { supported: false, permission: 'unsupported', subscribed: false };
  let subscribed = false;
  try {
    const reg = await nav.serviceWorker.ready;
    subscribed = !!(await reg.pushManager.getSubscription());
  } catch { subscribed = false; }
  return { supported: true, permission: notification.permission, subscribed };
}

/**
 * Turn notifications ON: register SW → request permission → subscribe → tell pinboard.
 * Returns {ok, reason?}. `swUrl` defaults to the root-scoped '/sw.js'.
 */
export async function enableWebPush({
  callSkill,
  swUrl = '/sw.js',
  nav = globalThis.navigator,
  notification = globalThis.Notification,
} = {}) {
  if (!webPushSupported({ nav, notification })) return { ok: false, reason: 'unsupported' };
  const permission = await notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  await nav.serviceWorker.register(swUrl).catch(() => {});
  const reg = await nav.serviceWorker.ready;

  const vapid = await callSkill('pinboard', 'getVapidPublicKey', {});
  const publicKey = vapid?.publicKey;
  if (!publicKey) return { ok: false, reason: 'push-disabled' };   // server has no VAPID keys (e.g. browser-only bundle)

  let sub;
  try {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  } catch (err) { return { ok: false, reason: 'subscribe-failed', error: err?.message ?? String(err) }; }

  const res = await callSkill('pinboard', 'subscribeWebPush', { subscription: sub.toJSON ? sub.toJSON() : sub });
  if (res?.error) return { ok: false, reason: 'register-failed', error: res.error };
  return { ok: true };
}

/** Turn notifications OFF: drop the browser subscription + deregister it at pinboard. */
export async function disableWebPush({ callSkill, nav = globalThis.navigator } = {}) {
  let endpoint = null;
  try {
    const reg = await nav.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { endpoint = sub.endpoint; await sub.unsubscribe().catch(() => {}); }
  } catch { /* nothing to drop */ }
  await callSkill('pinboard', 'unsubscribeWebPush', endpoint ? { endpoint } : {}).catch(() => {});
  return { ok: true };
}

/**
 * Show a LOCAL notification (no server push) via the active service-worker registration. Used by the
 * verify-summary nudge (self-poll/self-notify). Resolves false when notifications aren't granted/available.
 */
export async function showLocalNotification({ title, body, tag, data, nav = globalThis.navigator, notification = globalThis.Notification } = {}) {
  try {
    if (!notification || notification.permission !== 'granted' || !nav?.serviceWorker) return false;
    const reg = await nav.serviceWorker.ready;
    await reg.showNotification(title || 'Feedback', { body: body || '', tag, data });
    return true;
  } catch { return false; }
}
