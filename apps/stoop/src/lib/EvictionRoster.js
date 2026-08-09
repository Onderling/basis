/**
 * EvictionRoster — Stoop Phase 35.1 (2026-05-06).
 *
 * Tracks which webids are "evicted" — i.e. their last
 * `kind: 'membership-redemption'` item is past its `expiresAt + GRACE_MS`
 * window.  Posts from evicted members are dropped silently in the
 * `substrateMirror` and `wireChat.broadcast-post` paths, so the UI no
 * longer surfaces stale members' content.
 *
 * Phase 25.7 already exposed `getMyMembershipStatus` — that's the
 * informational surface.  Phase 35 is the *enforcement* surface:
 * other people's stale memberships disappear from your board too.
 *
 * Source of truth: every `kind: 'membership-redemption'` item carries
 * `source.redeemedBy` (webid) + `source.expiresAt`.  The roster
 * reduces these to `Map<webid, expiresAt>` keeping the LATEST
 * expiresAt per webid.  A member is evicted when:
 *
 *   now > expiresAt + GRACE_MS   AND   no later redemption exists.
 *
 * Cold-boot: the constructor walks the itemStore once.  Live:
 * `attach({ itemStore })` listens for `item-added` events and updates
 * the map for any new redemption.  The roster is read-only outside
 * — consumers call `isEvicted(webid)` only.
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — eviction grace window past membership expiry (scope:device, kind:internal).
const GRACE_MS = param({ key: 'stoop.evictionGraceMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 24 * 60 * 60 * 1000 });   // 24h, matches Phase 25.4

export class EvictionRoster {
  /** @type {Map<string, number>} webid → latest expiresAt */
  #latest = new Map();
  /** @type {() => void} | null */
  #detach = null;

  /** Returns true when the webid has a redemption past expiresAt + grace. */
  isEvicted(webid, { now = Date.now() } = {}) {
    if (typeof webid !== 'string' || !webid) return false;
    const expiresAt = this.#latest.get(webid);
    if (typeof expiresAt !== 'number') return false;     // never redeemed → not evicted (just unknown)
    return now > expiresAt + GRACE_MS;
  }

  /** Latest expiresAt for a webid, or null. */
  expiresAt(webid) {
    if (typeof webid !== 'string') return null;
    return this.#latest.get(webid) ?? null;
  }

  /** Returns the list of evicted webids with their stale expiresAt. */
  listEvicted({ now = Date.now() } = {}) {
    const out = [];
    for (const [webid, exp] of this.#latest) {
      if (now > exp + GRACE_MS) out.push({ webid, expiresAt: exp });
    }
    return out;
  }

  /** Snapshot for diagnostics / tests. */
  snapshot() {
    return Array.from(this.#latest, ([webid, expiresAt]) => ({ webid, expiresAt }));
  }

  /**
   * Apply a `membership-redemption` item.  Overwrites the stored
   * expiresAt for that webid IF the new one is later (or no prior
   * value exists).  Older or invalid redemptions are ignored.
   */
  applyRedemption(item) {
    if (!item || item.type !== 'membership-redemption') return false;
    const webid = item.source?.redeemedBy;
    const expiresAt = item.source?.expiresAt;
    if (typeof webid !== 'string' || !webid) return false;
    if (typeof expiresAt !== 'number' || expiresAt <= 0) return false;
    const prior = this.#latest.get(webid);
    if (typeof prior === 'number' && prior >= expiresAt) return false;
    this.#latest.set(webid, expiresAt);
    return true;
  }

  /**
   * Cold-boot from the itemStore: walk every redemption (open + closed)
   * and seed the map.  Async because itemStore.listOpen is async.
   */
  async hydrateFrom(itemStore) {
    if (!itemStore?.listOpen) return;
    const items = await itemStore.listOpen({ type: 'membership-redemption' });
    for (const it of items ?? []) this.applyRedemption(it);
  }

  /**
   * Subscribe to itemStore `item-added` events and apply any
   * redemption that lands.  Returns a detach function (also stored
   * internally so the next `attach` doesn't leak listeners).
   */
  attach({ itemStore }) {
    if (!itemStore?.on) return () => {};
    if (this.#detach) this.#detach();
    const handler = (item) => {
      if (item?.type === 'membership-redemption') this.applyRedemption(item);
    };
    itemStore.on('item-added', handler);
    this.#detach = () => {
      try { itemStore.off?.('item-added', handler); } catch { /* ignore */ }
    };
    return this.#detach;
  }
}

export const EVICTION_GRACE_MS = GRACE_MS;
