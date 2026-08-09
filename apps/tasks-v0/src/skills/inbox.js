/**
 * inbox skills — Tasks V1 Phase 8.
 *
 * Reads + clears the per-user inbox written by `InAppInboxBridge`
 * (Phase 6). The inbox lives at `mem://user/inbox/<id>.json` (cross-
 * app, not Tasks-specific) so any app can surface notifications
 * authored by any other app under the same user.
 *
 * Skills:
 *   - `listMyInbox({since?, limit?})` — list notifications, newest
 *     first. `since` filters by epoch-ms `addedAt`; `limit` caps
 *     the response.
 *   - `inboxBadgeCount()` — count of inbox items added in the last
 *     24h (used by the nav badge across pages).
 *   - `clearInboxItem({id})` — delete one inbox notification.
 *   - `clearInbox({olderThanMs?})` — bulk-delete; optional age cutoff.
 *
 * The dataSource comes from the resolved CircleState — it's the
 * process-level CachingDataSource shared across circles (the inbox is
 * cross-app, per-USER, so the circleId only matters for resolving
 * which CircleState's dataSource to use; in practice they all share).
 */

import { defineSkill } from '@onderling/core';

import { argsFromParts } from '../bundleResolver.js';
// DESIGN gap #2 (2026-05-27) — `_sync` reply envelope for staleness hints.
import { simulateSync, decorateWithLastSync } from './_syncEnvelope.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

const DEFAULT_INBOX_CONTAINER = 'mem://user/inbox/';
// Parameter register (#36) — inbox badge count window (scope:device, kind:internal).
const BADGE_WINDOW_MS = param({ key: 'tasksV0.badgeWindowMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 24 * 60 * 60 * 1000 });

async function _listAll(dataSource, container) {
  const keys = await dataSource.list(container);
  const out = [];
  for (const k of keys) {
    const raw = await dataSource.read(k);
    if (!raw) continue;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      out.push({ ...parsed, _path: k });
    } catch { /* skip malformed */ }
  }
  return out;
}

/**
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 * @param {string} [args.container]
 */
export function buildInboxSkills({ bundleResolver, container = DEFAULT_INBOX_CONTAINER } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildInboxSkills: bundleResolver(parts, ctx) required');
  }
  const root = container.endsWith('/') ? container : container + '/';

  return [
    defineSkill('listMyInbox', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      const since = Number.isFinite(a.since) ? a.since : 0;
      const limit = Number.isFinite(a.limit) ? Math.max(1, Math.min(500, a.limit)) : 100;
      const all = await _listAll(circle.dataSource, root);
      const filtered = all
        .filter((i) => (i.addedAt ?? 0) >= since)
        .sort((x, y) => (y.addedAt ?? 0) - (x.addedAt ?? 0))
        .slice(0, limit);
      return { items: decorateWithLastSync(filtered), _sync: simulateSync() };
    }, {
      description: 'List inbox notifications, newest first.',
    }),

    defineSkill('inboxBadgeCount', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const all = await _listAll(circle.dataSource, root);
      const cutoff = Date.now() - BADGE_WINDOW_MS;
      const recent = all.filter((i) => (i.addedAt ?? 0) >= cutoff);
      return { count: recent.length, totalCount: all.length };
    }, {
      description: 'Return inbox count for the nav badge (last 24h + total).',
    }),

    defineSkill('clearInboxItem', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      if (typeof a.id !== 'string' || !a.id) return { error: 'id required' };
      try {
        await circle.dataSource.delete(`${root}${a.id}.json`);
        return { ok: true, id: a.id };
      } catch (err) {
        return { error: `delete failed: ${err?.message ?? err}` };
      }
    }, {
      description: 'Delete one inbox notification by id.',
    }),

    defineSkill('clearInbox', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      const olderThanMs = Number.isFinite(a.olderThanMs) ? a.olderThanMs : 0;
      const cutoff = olderThanMs > 0 ? Date.now() - olderThanMs : Number.POSITIVE_INFINITY;
      const all = await _listAll(circle.dataSource, root);
      const toDelete = all.filter((i) => olderThanMs === 0 || (i.addedAt ?? 0) <= cutoff);
      let deleted = 0;
      for (const i of toDelete) {
        try {
          await circle.dataSource.delete(i._path);
          deleted++;
        } catch { /* skip */ }
      }
      return { deleted };
    }, {
      description: 'Bulk-clear inbox notifications, optionally older than N ms.',
    }),
  ];
}

export { DEFAULT_INBOX_CONTAINER };
