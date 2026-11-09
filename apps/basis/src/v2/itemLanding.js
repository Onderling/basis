/**
 * An item LANDING on this device: a circle store row someone else wrote, arriving here for the first time.
 *
 * The item store keeps no landing time (a row carries when it was authored, not when this device first held it), and
 * a post that arrives late, by catch-up after a day offline, is still news. So the device log records the landing:
 * one silent entry per fresh item, written where every landing passes (the items rail's applied hook: the live fan,
 * the catch-up at connect, a sibling's carry). It is a REFERENCE, never a copy: the circle, the item's id, its kind
 * and its author. No text and no wire envelope: the item's words stay in the store, and the news projection joins the
 * entry to the store for a label.
 *
 * Read by the one news projection (`circleTilePreviews.js`): the circle tile's count and subtitle, and Today's
 * circles with news.
 */
import { makeSilentEntry } from '../eventLog.js';
import { isNoticeboardPostType, noticeboardIntentOf } from '@onderling/item-types';
import { itemKindChip } from './embedChips.js';

/** The entry kind (system lane in the entry-kinds dictionary). */
export const ITEM_LANDED = 'item-landed';

/**
 * Who wrote a store row: the carried author, else its creator, else the statement's author (`authorRef`, the address
 * that said the snapshot). A local stamp ('me', which a writer's own device puts on its row) names nobody here.
 */
export function itemAuthor(item, authorRef = null) {
  const named = (x) => (typeof x === 'string' && x && x !== 'me' ? x : null);
  return named(item?.source?.from) ?? named(item?.createdBy) ?? named(authorRef);
}

/**
 * The kind a landed row is news as, in the item-kind vocabulary (`itemKindChip`): a noticeboard post by its intent
 * (ask · offer · lend), anything else by its type. A row outside the vocabulary (rules, a membership code, a system
 * document) is no news: null.
 */
export function landingKindOf(item) {
  if (!item || typeof item !== 'object') return null;
  const kind = isNoticeboardPostType(item) ? noticeboardIntentOf(item) : item.type;
  return itemKindChip(kind) ? kind : null;
}

/**
 * The landing entry for a fresh row, or null when it is no news: an update of a row this device already held, a row
 * outside the vocabulary, a row without an author, or one this device's own self in that circle wrote.
 *
 * @param {object} a
 * @param {string} a.circleId
 * @param {object} a.item        the store row as it landed
 * @param {boolean} [a.fresh]    first time this device holds it (the rail's landing flag)
 * @param {string|null} [a.self] the self this device speaks as in that circle
 * @param {string|null} [a.authorRef] the address that said the snapshot (the rail's statement author)
 * @param {number} [a.now]
 */
export function landingEntryFor({ circleId, item, fresh = true, self = null, authorRef = null, now = Date.now() } = {}) {
  if (!fresh || typeof circleId !== 'string' || !circleId || typeof item?.id !== 'string') return null;
  const kind = landingKindOf(item);
  const author = itemAuthor(item, authorRef);
  if (!kind || typeof author !== 'string' || !author || (self && author === self)) return null;
  return makeSilentEntry({
    id: landingIdOf(circleId, item.id), circleId, kind: ITEM_LANDED, actor: author, ts: now,
    payload: { circleId, itemId: item.id, kind },
  });
}

/** One landing per item per circle: the entry's id, so a second landing of the same row is never news twice. */
export const landingIdOf = (circleId, itemId) => `landed:${circleId}:${itemId}`;

/**
 * The item a landing names was removed from the store: the entry stays (it is this device's record of an arrival) but
 * is marked, and the news projection passes it by.
 */
export const markLandingRemoved = (entry) => ({ ...entry, payload: { ...(entry?.payload ?? {}), removed: true } });

/** Is this log entry an item landing whose item the store still holds? */
export const isItemLanding = (event) => event?.type === ITEM_LANDED && typeof event?.payload?.itemId === 'string' && event.payload.removed !== true;
