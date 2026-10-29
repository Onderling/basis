/**
 * Noticeboard posts live in their circle's store: pinboard writes a post there and reads it there, and the store's
 * own lane carries it to the members (a signed snapshot, fanned, caught up, verified against the roster on landing).
 * There is no second copy and no bridge back into a pinboard index. What a landing still needs on the receiving
 * device is the announcement: the notification and the on-device driver match, once per post (`fresh`), never again
 * for an update of it (a claim, an edit).
 */
import { isNoticeboardPostType } from '@onderling/item-types';
import { noticeboardFanPayload } from './noticeboardFan.js';

/** A landed circle-store row that is a post from SOMEONE ELSE — the only rows the bridge forwards. */
export function isLandedNoticeboardPost(item, { self = null } = {}) {
  if (!item || typeof item !== 'object' || typeof item.id !== 'string') return false;
  if (!isNoticeboardPostType(item)) return false;   // a task or a note in the same store is not a post
  const author = item.source?.from ?? item.createdBy ?? null;
  return !(self && author === self);
}

/**
 * The receiving side: a post from someone else that arrived for the first time goes to the shell's
 * `handleCirclePost` — the notification and the driver match. The post is already in the circle's store.
 */
export function landedNoticeboardHandler({ handleCirclePost, self = null } = {}) {
  if (typeof handleCirclePost !== 'function') throw new Error('landedNoticeboardHandler: handleCirclePost required');
  return async function onLanded(circleId, item, { fresh = true } = {}) {
    if (!fresh) return;   // an update of a post this device already holds: announced when it first came
    if (!isLandedNoticeboardPost(item, { self })) return;
    const from = item.source?.from ?? item.createdBy;
    const payload = noticeboardFanPayload(item, { from, groupId: circleId });
    return handleCirclePost(from, { groupId: circleId, fromPubKey: from, payload });
  };
}
