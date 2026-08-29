/**
 * What the circle fans when a noticeboard item is WRITTEN — derived from the item, never from the op.
 *
 * A request, an offer and an announcement are different ops in stoop, and for a long time only the first
 * of them reached anyone: the fan hung off `postRequest` by name, so an announcement was stored locally
 * and went nowhere (the walk's "a noticeboard post reaches nobody but its author"). The data plane's rule
 * is the other way round — "whatever the store holds is what syncs" — so the fan reads the ITEM the
 * store just accepted: a canonical noticeboard type, written here (not received), tagged with a circle.
 * The next post kind rides the same door without anyone listing it.
 */
import { isNoticeboardPost, schema } from '@onderling/item-types';
import { itemCircleId } from './circleScope.js';

/** Should this freshly-stored item go to the circle's other members? */
export function shouldFanNoticeboardItem(item) {
  if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) return false;
  if (item.source?.broadcast === true) return false;        // it ARRIVED here — fanning it again is an echo
  if (!isNoticeboardPost(item)) return false;               // system rows (rules, codes, redemptions, chat)
  return !!schema(item.type);                                // a canonical type — bespoke rows (a report) stay local
}

/**
 * The `circle-post` payload the receiver's `ingestRemotePost` expects, built from the stored item.
 * `requestId` is the item's own id: the receiver dedupes on it and the reply of `postRequest` already
 * hands the same id back to the author, so one post has one id everywhere.
 */
export function noticeboardFanPayload(item, { from, groupId = null } = {}) {
  const src = item.source ?? {};
  const targets = Array.isArray(src.targets) && src.targets.length
    ? src.targets
    : (groupId ? [{ kind: 'group', groupId }] : []);
  return {
    requestId:      item.id,
    text:           item.text ?? '',
    from,
    type:           item.type ?? 'request',
    kind:           item.kind ?? null,
    dueAt:          typeof item.dueAt === 'number' ? item.dueAt : null,
    categoryId:     item.categoryId ?? src.categoryId ?? null,
    skillTags:      Array.isArray(item.skillTags) ? item.skillTags : (Array.isArray(src.skillTags) ? src.skillTags : []),
    requiredSkills: Array.isArray(item.requiredSkills) ? item.requiredSkills : [],
    targets,
    attachments:    Array.isArray(src.attachments) ? src.attachments : (Array.isArray(item.attachments) ? item.attachments : []),
    ...(Array.isArray(src.embeds) && src.embeds.length > 0 ? { embeds: src.embeds } : {}),
  };
}

/** The circle an item names, if any (targets / groupId hints). */
export function noticeboardItemCircle(item) {
  return itemCircleId(item ?? {}) ?? null;
}
