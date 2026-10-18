/**
 * WebPushSender — Pinboard Phase 21 (2026-05-06).
 *
 * Concrete `relay.PushSender` for VAPID-signed Web Push.  Lazy-loads
 * the `web-push` npm package so apps that don't enable push don't
 * pay the import cost.  Returns `{ok}` per the `PushSender` contract
 * (never throws — push is fire-and-forget).
 *
 * **Substrate candidate (rule of two — first consumer):** when a
 * second app needs Web Push, lift this into `@onderling/relay/push/`
 * alongside `ExpoPushSender`.  Tracked in
 * `Project Files/Substrates/substrate-candidates.md`.
 */

import { PushSender } from '@onderling/relay';

let _moduleFactory = null;

async function defaultModuleFactory() {
  return import('web-push');
}

/** Test-only seam: replace the `web-push` import with a stub. */
export function _setWebPushModuleFactory(factory) {
  _moduleFactory = factory;
}

async function getModule() {
  return (_moduleFactory ?? defaultModuleFactory)();
}

/**
 * @param {object} keys
 * @param {string} keys.publicKey   VAPID public key (URL-safe base64)
 * @param {string} keys.privateKey  VAPID private key
 * @param {string} keys.subject     mailto: or https: URI identifying the sender
 */
export class WebPushSender extends PushSender {
  #publicKey;
  #privateKey;
  #subject;

  constructor({ publicKey, privateKey, subject }) {
    super();
    if (!publicKey || !privateKey || !subject) {
      throw new TypeError('WebPushSender: publicKey, privateKey, subject required');
    }
    this.#publicKey  = publicKey;
    this.#privateKey = privateKey;
    this.#subject    = subject;
  }

  get publicKey() { return this.#publicKey; }

  /**
   * Send a Web Push notification.
   *
   * @param {string|object} subscription   PushSubscription JSON (or its
   *                                       endpoint string when the caller
   *                                       has a thin token).  We pass it
   *                                       through to web-push as-is.
   * @param {object} payload               JSON payload the SW will receive
   * @param {object} [_opts]
   */
  async send(subscription, payload, _opts) {
    let sub;
    try {
      sub = typeof subscription === 'string' ? JSON.parse(subscription) : subscription;
    } catch (err) {
      return { ok: false, error: `WebPushSender: bad subscription JSON: ${err.message}` };
    }
    if (!sub?.endpoint) return { ok: false, error: 'WebPushSender: subscription.endpoint missing' };

    let mod;
    try {
      mod = await getModule();
    } catch (err) {
      return { ok: false, error: `WebPushSender: web-push module not available: ${err.message}` };
    }
    const wp = mod.default ?? mod;
    try {
      wp.setVapidDetails(this.#subject, this.#publicKey, this.#privateKey);
      await wp.sendNotification(sub, JSON.stringify(payload));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `WebPushSender: ${err?.message ?? String(err)}` };
    }
  }
}
