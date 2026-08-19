/**
 * basis v2 — per-circle action-frequency counter (D1 / §5A).
 *
 * The v2 PDF's "Veel-gebruikt" row surfaces the actions THIS user uses
 * most IN THAT circle.  This substrate is the counter behind it: a small
 * `Map<circleId, Map<actionKey, count>>` that `bump()`s when an action
 * fires and answers `top(circleId, n)` for the renderer.
 *
 * `actionKey` is a circle feature key (`chat`, `noticeboard`, `tasks`,
 * `lists`, `calendar`, `notes`, `houseRules`, `memberDirectory`) — the
 * same vocabulary the bottom tabs + `enabledFeatures(policy)` use, so
 * the quickActions block can intersect frequency with what's enabled.
 *
 * Pure + portable: zero DOM, zero RN, zero storage.  Persistence is the
 * host's job — pass an `onChange(snapshot)` callback and the host writes
 * the snapshot to localStorage (web) / AsyncStorage (mobile) on its own
 * cadence; hydrate a fresh store from a prior snapshot via the `initial`
 * arg.  This mirrors `deliveryState.js`: in-memory truth, host persists.
 */

/**
 * @typedef {Object} ActionFrequencyStore
 * @property {(circleId: string, actionKey: string, weight?: number) => void} bump
 *   Increment the count for `(circleId, actionKey)` by `weight` (default 1).
 *   No-ops on invalid input.  Fires `onChange(snapshot())` when it mutates.
 * @property {(circleId: string) => Record<string, number>} counts
 *   The `{actionKey: count}` map for a circle (empty object if none).
 * @property {(circleId: string, n?: number) => string[]} top
 *   The `n` highest-count action keys for a circle, count desc, ties
 *   broken alphabetically for determinism.  Returns `[]` when no counts.
 * @property {() => Record<string, Record<string, number>>} snapshot
 *   A plain serializable copy of the whole store (for persistence).
 * @property {(fn: (snap: Record<string, Record<string, number>>) => void) => () => void} subscribe
 *   Register a change listener; returns an unsubscribe handle.
 */

/**
 * @param {Record<string, Record<string, number>>} [initial]
 *   A snapshot to hydrate from (e.g. read back from storage at boot).
 * @param {{ onChange?: (snap: Record<string, Record<string, number>>) => void }} [opts]
 * @returns {ActionFrequencyStore}
 */
export function createActionFrequencyStore(initial = {}, { onChange } = {}) {
  /** @type {Map<string, Map<string, number>>} */
  const map = new Map();

  // Hydrate from the initial snapshot, ignoring malformed entries.
  if (initial && typeof initial === 'object') {
    for (const [circleId, counts] of Object.entries(initial)) {
      if (!circleId || !counts || typeof counts !== 'object') continue;
      const inner = new Map();
      for (const [k, v] of Object.entries(counts)) {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) inner.set(k, v | 0);
      }
      if (inner.size) map.set(circleId, inner);
    }
  }

  /** @type {Set<(snap: object) => void>} */
  const subs = new Set();

  function snapshot() {
    /** @type {Record<string, Record<string, number>>} */
    const out = {};
    for (const [circleId, inner] of map.entries()) {
      out[circleId] = Object.fromEntries(inner.entries());
    }
    return out;
  }

  function notify() {
    const snap = snapshot();
    if (typeof onChange === 'function') {
      try { onChange(snap); } catch { /* host persistence failure must not break bump */ }
    }
    for (const fn of subs) {
      try { fn(snap); } catch { /* swallow one bad listener */ }
    }
  }

  return {
    bump(circleId, actionKey, weight = 1) {
      if (typeof circleId !== 'string' || circleId === '') return;
      if (typeof actionKey !== 'string' || actionKey === '') return;
      const w = typeof weight === 'number' && Number.isFinite(weight) ? Math.trunc(weight) : 1;
      if (w <= 0) return;
      let inner = map.get(circleId);
      if (!inner) { inner = new Map(); map.set(circleId, inner); }
      inner.set(actionKey, (inner.get(actionKey) ?? 0) + w);
      notify();
    },
    counts(circleId) {
      const inner = map.get(circleId);
      return inner ? Object.fromEntries(inner.entries()) : {};
    },
    top(circleId, n = 4) {
      const inner = map.get(circleId);
      if (!inner || inner.size === 0) return [];
      const limit = typeof n === 'number' && n > 0 ? Math.trunc(n) : 4;
      return [...inner.entries()]
        // count desc, then key asc for a stable, deterministic order.
        .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .slice(0, limit)
        .map(([k]) => k);
    },
    snapshot,
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
