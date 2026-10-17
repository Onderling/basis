/**
 * chat skills — Tasks V1 Phase 14 (mirrors Pinboard's chat surface).
 *
 * Phase 41.18.4 (2026-05-10) — added so the mobile appeal-thread
 * screen has a concrete read/send surface. The substrate side is
 * already wired in Circle.js (chat-p2p `wireChat({...})` writes
 * `chat-message` items into the per-circle item-store + the
 * controller is exposed at `circle.chatController`).
 *
 * Skills:
 *   - `sendChatMessage({toWebid, threadId, body})` — peer-to-peer
 *     chat over the existing chatController. At least one
 *     recipient identifier is required; for the appeal thread the
 *     caller passes the master's webid.
 *   - `getChatThread({threadId})` — return all chat-message items
 *     for `threadId`, oldest-first.
 *   - `listChatThreads()` — distinct threadIds the caller is a
 *     participant in, with the most-recent message + counterparty.
 *
 * The thread-id convention for appeals is `appeal:<taskId>` (set
 * by `appealTask` itself).
 */

import { defineSkill } from '@onderling/core';

import { argsFromParts } from '../bundleResolver.js';

const CHAT_TYPE = 'chat-message';

/**
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 */
export function buildChatSkills({ bundleResolver } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildChatSkills: bundleResolver(parts, ctx) required');
  }

  return [
    defineSkill('sendChatMessage', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      if (typeof a.threadId !== 'string' || !a.threadId) {
        return { error: 'threadId required' };
      }
      if (typeof a.body !== 'string' || a.body.trim().length === 0) {
        return { error: 'body required' };
      }
      const ctrl = circle.chatController;
      if (!ctrl?.send) {
        return { error: 'chat-not-wired' };
      }
      // Recipient: prefer toWebid (used by appealTask + most callers),
      // fall back to toStableId / toPubKey for symmetry with Pinboard's
      // surface.
      const r = await ctrl.send({
        toWebid:    a.toWebid    ?? null,
        toStableId: a.toStableId ?? null,
        toPubKey:   a.toPubKey   ?? null,
        threadId:   a.threadId,
        body:       a.body,
      });
      if (!r || r.ok === false) {
        return { error: r?.reason ?? 'send-failed' };
      }
      return { ok: true, itemId: r.itemId ?? null };
    }, {
      description: 'Send a 1-on-1 chat message to a peer (used by the appeal flow).',
      visibility:  'authenticated',
    }),

    defineSkill('getChatThread', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      if (typeof a.threadId !== 'string' || !a.threadId) {
        return { error: 'threadId required' };
      }
      const all = await circle.itemStore.listOpen({ type: CHAT_TYPE });
      const messages = all
        .filter((i) => i?.source?.threadId === a.threadId)
        .sort((p, q) =>
          (p.source?.sentAt ?? p.addedAt ?? 0) -
          (q.source?.sentAt ?? q.addedAt ?? 0));
      return { messages };
    }, {
      description: 'Return all chat-messages for a thread, oldest-first.',
      visibility:  'authenticated',
    }),

    defineSkill('listChatThreads', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const all = await circle.itemStore.listOpen({ type: CHAT_TYPE });
      /** @type {Map<string, object>} */
      const byThread = new Map();
      for (const m of all) {
        const tid = m?.source?.threadId;
        if (!tid) continue;
        const cur = byThread.get(tid);
        const ts  = m.source?.sentAt ?? m.addedAt ?? 0;
        if (!cur || ts > cur.lastSentAt) {
          byThread.set(tid, {
            threadId:    tid,
            lastBody:    m.text,
            lastSentAt:  ts,
            lastFrom:    m.source?.fromWebid ?? m.addedBy,
            counterparty: m.source?.fromWebid === from
              ? (m.source?.toWebid ?? null)
              : (m.source?.fromWebid ?? null),
          });
        }
      }
      return {
        threads: [...byThread.values()].sort((p, q) => q.lastSentAt - p.lastSentAt),
      };
    }, {
      description: 'List my chat threads, most-recently-active first.',
      visibility:  'authenticated',
    }),
  ];
}

export { CHAT_TYPE };
