/**
 * basis — `_sync` reply-envelope convention (v0.6).
 *
 * Apps' skill replies CAN attach an optional `_sync` field that
 * describes the connectivity / staleness state of the reply.  The
 * chat shell renders this as a sub-line under the text bubble (or
 * an inline annotation on list items via `_lastSync`).
 *
 * Per-style rendering rules (per OQ-1.A user resolution + journeys
 * doc design choice E):
 *
 *   - 'central'        → no sync hint shown (the server is the single
 *                         source of truth; status is implicit)
 *   - 'decentralized'  → "synced to N of M peers" + unreachable list
 *   - 'pod-less'       → "polled K peers · last seen Mh ago"
 *
 * Per-row `_lastSync` on list items renders as a small badge
 * ('2h ago' / 'stale').
 *
 * Phase v0.6 sub-slices 6.1 + 6.2.
 */

import { translatorOr } from './locales/translatorOr.js';

/**
 * @typedef {object} SyncHints
 * @property {'central' | 'decentralized' | 'pod-less'} style
 * @property {string[]}            [peers]        — webids confirmed
 * @property {string[]}            [pending]      — webids not yet confirmed
 * @property {string[]}            [unreachable]  — webids unreachable
 * @property {Object<string, number>} [lastSeen]  — pod-less: webid → epoch ms
 */

/**
 * Format a sync-hint envelope as a short text suffix suitable for
 * display under a text/list/record bubble.  Returns an empty string
 * for 'central' style or when hints are absent — the caller decides
 * whether to render anything (omits the DOM element entirely when
 * empty).
 *
 * @param {SyncHints | null | undefined} sync
 * @param {(key: string, params?: object) => string} [t]   localiser; falls back to English
 * @param {() => number}                              [now=Date.now]
 * @returns {string}
 */
export function formatSyncHints(sync, t, now = Date.now) {
  if (!sync || typeof sync !== 'object') return '';
  const tr = translatorOr(t, 'syncHints.js');

  if (sync.style === 'central') {
    // No sync hint — the convention is "client knows when offline".
    return '';
  }

  if (sync.style === 'decentralized') {
    const peers       = (sync.peers       ?? []).length;
    const pending     = (sync.pending     ?? []).length;
    const unreachable = (sync.unreachable ?? []).length;
    const total       = peers + pending + unreachable;
    // OQ-6.A user resolution (2026-05-23): when the decentralized op
    // crosses 0 peers (everyone offline / not yet known), surface the
    // "saved locally; awaiting peer sync" hint instead of returning
    // empty.  A [Retry] affordance can ride on this in v0.6+ when a
    // real retry path exists; for now the message is informational.
    if (total === 0) return tr('sync.saved_locally');

    const parts = [];
    parts.push(tr('sync.synced_to', { ok: peers, total }));
    if (pending > 0) {
      parts.push(tr('sync.pending', { count: pending }));
    }
    if (unreachable > 0) {
      parts.push(tr('sync.unreachable', {
        count: unreachable,
        list:  (sync.unreachable ?? []).join(', '),
      }));
    }
    return parts.join(' · ');
  }

  if (sync.style === 'pod-less') {
    const lastSeen = sync.lastSeen ?? {};
    const peers    = Object.keys(lastSeen);
    if (peers.length === 0) return tr('sync.podless_empty');
    // Compute the OLDEST last-seen timestamp — that's the staleness
    // ceiling.  Display "K peers · last seen Xh ago".
    const oldest = Math.min(...peers.map((p) => lastSeen[p]));
    return tr('sync.podless', {
      count:  peers.length,
      ago:    relativeAgo(oldest, now()),
    });
  }

  return '';
}

/**
 * Render a per-row staleness badge for list items carrying `_lastSync`.
 * Returns either a string like '2h ago' or empty string when absent.
 *
 * @param {number | undefined} lastSync   epoch ms
 * @param {(key: string, params?: object) => string} [t]
 * @param {() => number}                  [now=Date.now]
 * @returns {string}
 */
export function formatLastSync(lastSync, t, now = Date.now) {
  if (typeof lastSync !== 'number' || !Number.isFinite(lastSync)) return '';
  const tr = translatorOr(t, 'syncHints.js');
  const ago = relativeAgo(lastSync, now());
  return tr('sync.row_ago', { ago });
}

/* ─── helpers ──────────────────────────────────────────── */

/**
 * Render a delta as a short "Xs / Xm / Xh / Xd ago" string.
 *
 * @param {number} thenMs
 * @param {number} nowMs
 * @returns {string}
 */
export function relativeAgo(thenMs, nowMs) {
  const delta = Math.max(0, nowMs - thenMs);
  if (delta < 60_000)        return `${Math.floor(delta / 1_000)}s`;
  if (delta < 3_600_000)     return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000)    return `${Math.floor(delta / 3_600_000)}h`;
  return `${Math.floor(delta / 86_400_000)}d`;
}
