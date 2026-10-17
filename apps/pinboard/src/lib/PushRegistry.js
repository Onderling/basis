/**
 * PushRegistry — Pinboard Phase 21 (2026-05-06).
 *
 * In-process map of WebID → array of PushSubscription objects.  Used
 * by the `subscribeWebPush` / `unsubscribeWebPush` skills + the
 * notifier's `PushChannel` to look up where to deliver wake-ups.
 *
 * stores subscriptions in memory only; durable persistence is
 * V2 work (will likely live in the bundle's MemberMap as a
 * stableId-keyed `pushSubscriptions[]` array, mirrored to the pod
 * at the user's request).
 */

export class PushRegistry {
  /** @type {Map<string, Array<object>>} */
  #byWebid = new Map();
  /** @type {((reg: PushRegistry) => void) | null} */
  #onChange = null;

  /**
   * Phase 29.3: optional `onChange` callback fired after every
   * mutation.  `PushRegistryCache.attach` installs one to write
   * the snapshot through the bundle's CachingDataSource.
   */
  setOnChange(fn) { this.#onChange = typeof fn === 'function' ? fn : null; }

  #fireChange() {
    if (!this.#onChange) return;
    try { this.#onChange(this); } catch { /* persistence is best-effort */ }
  }

  /**
   * Add a subscription under `webid`.  Idempotent on `endpoint` —
   * if the same endpoint is already registered, replace the entry
   * (so a refreshed expiration date / encrypted-key set takes
   * effect without growing the list).
   *
   * @returns {{added: boolean, total: number}}
   */
  add(webid, subscription) {
    if (typeof webid !== 'string' || !webid) throw new TypeError('PushRegistry.add: webid required');
    if (!subscription?.endpoint) throw new TypeError('PushRegistry.add: subscription.endpoint required');
    const list = this.#byWebid.get(webid) ?? [];
    const idx  = list.findIndex(s => s.endpoint === subscription.endpoint);
    if (idx >= 0) {
      list[idx] = subscription;
      this.#byWebid.set(webid, list);
      this.#fireChange();
      return { added: false, total: list.length };
    }
    list.push(subscription);
    this.#byWebid.set(webid, list);
    this.#fireChange();
    return { added: true, total: list.length };
  }

  /**
   * Drop a subscription by endpoint.  Returns `{removed, total}`.
   * If `endpoint` is omitted, drops every subscription for `webid`.
   */
  remove(webid, endpoint) {
    const list = this.#byWebid.get(webid);
    if (!list) return { removed: 0, total: 0 };
    if (!endpoint) {
      this.#byWebid.delete(webid);
      this.#fireChange();
      return { removed: list.length, total: 0 };
    }
    const before = list.length;
    const filtered = list.filter(s => s.endpoint !== endpoint);
    if (filtered.length === 0) this.#byWebid.delete(webid);
    else this.#byWebid.set(webid, filtered);
    if (before !== filtered.length) this.#fireChange();
    return { removed: before - filtered.length, total: filtered.length };
  }

  /** All subscriptions for `webid`, or [] when none. */
  list(webid) {
    return this.#byWebid.get(webid)?.slice() ?? [];
  }

  /** Total count across all webids. */
  count() {
    let n = 0;
    for (const v of this.#byWebid.values()) n += v.length;
    return n;
  }

  /**
   * Snapshot the entire registry as a plain object (`{[webid]: [...]}`)
   * — used by `PushRegistryCache` to write to disk / pod.
   */
  snapshot() {
    const out = {};
    for (const [w, subs] of this.#byWebid) out[w] = subs.slice();
    return out;
  }

  /** Bulk-load from a snapshot (replaces existing state). */
  loadSnapshot(snap) {
    this.#byWebid.clear();
    if (snap && typeof snap === 'object') {
      for (const [w, subs] of Object.entries(snap)) {
        if (typeof w === 'string' && Array.isArray(subs)) {
          this.#byWebid.set(w, subs.slice());
        }
      }
    }
  }
}
