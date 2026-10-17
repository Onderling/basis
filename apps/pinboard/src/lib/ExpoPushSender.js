/**
 * ExpoPushSender — Pinboard S6.6 (mobile-native push).
 *
 * Concrete `relay.PushSender` for Expo push tokens (`ExponentPushToken[…]`),
 * the mobile-native counterpart to `WebPushSender`'s VAPID Web Push. Delivers
 * via Expo's push service (https://exp.host/--/api/v2/push/send) — a plain
 * HTTPS POST, no native dep on the server. `fetch` is injectable so it's
 * unit-testable without a network. Returns `{ok}` per the PushSender contract
 * (never throws — push is fire-and-forget).
 *
 * The WebPushSender doc anticipated this sender; both will lift into
 * `@onderling/relay/push/` when a second app needs push (rule of two).
 */

import { PushSender } from '@onderling/relay';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Pull the Expo token out of whatever subscription shape we were handed. */
export function expoTokenOf(subscription) {
  if (typeof subscription === 'string') return subscription;
  if (!subscription || typeof subscription !== 'object') return null;
  if (typeof subscription.token === 'string') return subscription.token;
  const ep = subscription.endpoint;
  if (typeof ep === 'string') return ep.startsWith('expo:') ? ep.slice(5) : ep;
  return null;
}

/** Whether a subscription is an Expo-push one (vs a Web Push subscription). */
export function isExpoSubscription(subscription) {
  if (subscription?.kind === 'expo') return true;
  const t = expoTokenOf(subscription);
  return typeof t === 'string' && /^Expo(nent)?PushToken\[/.test(t);
}

export class ExpoPushSender extends PushSender {
  #fetch;
  #accessToken;

  /**
   * @param {object} [opts]
   * @param {Function} [opts.fetch]        injected fetch (default global)
   * @param {string}  [opts.accessToken]   optional Expo access token (enhanced security)
   */
  constructor({ fetch: f, accessToken } = {}) {
    super();
    this.#fetch = f ?? globalThis.fetch;
    this.#accessToken = accessToken ?? null;
  }

  /**
   * Send a push to an Expo token.
   *
   * @param {string|object} subscription  Expo token, or a registry record
   *                                      ({token} / {endpoint:'expo:<token>'})
   * @param {object} payload              { title, body, data? }
   */
  async send(subscription, payload) {
    const token = expoTokenOf(subscription);
    if (!token) return { ok: false, error: 'ExpoPushSender: no token' };
    if (typeof this.#fetch !== 'function') return { ok: false, error: 'ExpoPushSender: no fetch' };

    const message = {
      to: token,
      title: payload?.title ?? 'Onderling',
      body: payload?.body ?? '',
      sound: 'default',
      ...(payload?.data ? { data: payload.data } : {}),
    };
    const headers = { 'content-type': 'application/json', accept: 'application/json' };
    if (this.#accessToken) headers.authorization = `Bearer ${this.#accessToken}`;

    try {
      const res = await this.#fetch(EXPO_PUSH_URL, { method: 'POST', headers, body: JSON.stringify(message) });
      const json = await res.json().catch(() => null);
      // Expo returns { data: { status: 'ok'|'error', message?, details? } } (or an array for batches).
      const ticket = Array.isArray(json?.data) ? json.data[0] : json?.data;
      if (ticket?.status === 'ok') return { ok: true, id: ticket.id };
      return { ok: false, error: ticket?.message ?? `Expo push failed (${res.status})` };
    } catch (err) {
      return { ok: false, error: `ExpoPushSender: ${err?.message ?? String(err)}` };
    }
  }
}
