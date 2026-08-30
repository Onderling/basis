/**
 * ONE carry for noticeboard posts — the circle's store and its task lane (option B, Frits 2026-08-30).
 *
 * A post is written by stoop into its own index (claims, reveals, offering-match live there). Until now it
 * reached the other members by a SECOND sync implementation — a `circle-post` envelope fanned to the roster
 * — which is exactly what produced W1-shaped bugs. Now the author's post is ALSO put into the circle's
 * store, and the store's own mirror carries it: a signed snapshot on the task lane, fanned, catch-up served,
 * verified against the roster on landing. On the receiving device the landed snapshot is bridged into
 * stoop's index through the same `ingestRemotePost` door the envelope used, so stoop's verbs (respond,
 * claim, report) keep working. Two stores remain (the index is derived); there is one carry.
 */
import { isNoticeboardPostType } from '@onderling/item-types';
import { noticeboardFanPayload } from './noticeboardFan.js';

/** The circle store's registry requires the canonical base fields + a `body`; stoop writes `text`. */
export function toCircleStorePost(item, { from, now = () => new Date().toISOString() } = {}) {
  const createdAt = typeof item.createdAt === 'string' ? item.createdAt
    : (typeof item.addedAt === 'number' ? new Date(item.addedAt).toISOString() : now());
  return {
    ...item,
    body:      typeof item.body === 'string' && item.body ? item.body : (item.text ?? ''),
    createdAt,
    createdBy: typeof item.createdBy === 'string' && item.createdBy ? item.createdBy : from,
    source:    { ...(item.source ?? {}), from: item.source?.from ?? from },
  };
}

/** A landed circle-store row that is a post from SOMEONE ELSE — the only rows the bridge forwards. */
export function isLandedNoticeboardPost(item, { self = null } = {}) {
  if (!item || typeof item !== 'object' || typeof item.id !== 'string') return false;
  if (!isNoticeboardPostType(item)) return false;   // a task or a note in the same store is not a post
  const author = item.source?.from ?? item.createdBy ?? null;
  return !(self && author === self);
}

/**
 * The receiving side: feed a landed post to the shell's `handleCirclePost` (ingest into stoop's index,
 * driver match → notification) exactly as the envelope used to — same handler, different door.
 */
export function landedNoticeboardHandler({ handleCirclePost, self = null } = {}) {
  if (typeof handleCirclePost !== 'function') throw new Error('landedNoticeboardHandler: handleCirclePost required');
  return async function onLanded(circleId, item) {
    if (!isLandedNoticeboardPost(item, { self })) return;
    const from = item.source?.from ?? item.createdBy;
    const payload = noticeboardFanPayload(item, { from, groupId: circleId });
    return handleCirclePost(from, { groupId: circleId, fromPubKey: from, payload });
  };
}
