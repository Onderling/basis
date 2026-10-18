/**
 * tasks-v0 — `_sync` reply-envelope helpers.  Closes DESIGN gap #2
 * (2026-05-27) by giving every list-op reply the `_sync` shape the
 * basis renderer (`apps/basis/src/syncHints.js`) already
 * consumes for staleness hints.
 *
 * Mirrors `apps/folio/src/browser.js:73`'s `simulateSync` + the
 * decorate-with-lastSync pattern pinboard adopted in the same pass.
 * Plain JS, no deps; safe for both browser + node runtimes.
 *
 * Phase 1 scope: list ops emit `_sync` on the reply envelope, AND
 * each item carries `_lastSync` (ms timestamp) so per-row staleness
 * pills render.  Mutating ops (addTask / claim / submit / review /
 * editTask / appeal / revoke / remove) are out of scope for this
 * slice — local mutations don't need staleness signalling on the
 * reply they JUST produced.  Follow-up: emit on the post-mutation
 * lookup reply when the chat-shell consumer cares.
 */

/**
 * Returns the `_sync` reply-envelope shape consumed by the
 * basis renderer.  Local-stub shape (no real pod-sync yet) —
 * mirrors folio's `simulateSync`.
 *
 * @returns {{plannedPaths: string[], durationMs: number, bytesPushed: number, bytesPulled: number, conflictCount: number, queueDepth: number}}
 */
export function simulateSync() {
  return {
    plannedPaths:  [],
    durationMs:    0,
    bytesPushed:   0,
    bytesPulled:   0,
    conflictCount: 0,
    queueDepth:    0,
  };
}

/**
 * Decorate every entry in `items` with a `_lastSync` timestamp (ms
 * since epoch).  When an item already carries `_lastSync`, leave it
 * alone (the substrate may have set a real one); otherwise stamp
 * `now`.  Returns a new array; non-mutating.
 *
 * @template T
 * @param {T[]} items
 * @param {number} [now]
 * @returns {T[]}
 */
export function decorateWithLastSync(items, now = Date.now()) {
  if (!Array.isArray(items)) return items;
  return items.map((it) => (
    it && typeof it === 'object' && it._lastSync == null
      ? { ...it, _lastSync: now }
      : it
  ));
}
