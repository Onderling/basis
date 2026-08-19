/**
 * basis v2 — Folio "My things" private view.
 *
 * This view reframes the user's private Folio as the private circle: a
 * notes-list of items the user owns that aren't shared anywhere.  This
 * substrate is the pure projector — given the raw Folio list and the
 * user's webid, return the rows the notes-list view should render.
 *
 * An item is "mine + private" when:
 *  - `owner` (or `ownerId` / `authorId`) matches my webid (or owner is
 *    absent — legacy items default to mine), AND
 *  - it carries no circle hint (no circleId/circleId/groupId/audience).
 *
 * The companion to this view is [[folioSharedFilters]], which
 * powers the "Shared by me / Shared with me" toggles on the same screen.
 */

import { itemCircleId } from './circleScope.js';
import { normalizeFolioFile } from './circleFolio.js';

/** The owner webid an item is attributed to, or null if it carries none. */
export function itemOwner(item = {}) {
  if (!item || typeof item !== 'object') return null;
  return item.owner ?? item.ownerId ?? item.authorId ?? null;
}

/**
 * Is `item` "mine + private"?  `myId` is the active user's webid; a
 * null/undefined `myId` falls back to "anything without an owner" so
 * the predicate still works in single-user dev mode.
 */
export function isMyPrivateItem(item, myId) {
  if (!item || typeof item !== 'object') return false;
  if (itemCircleId(item) != null) return false;
  const owner = itemOwner(item);
  if (owner == null) return true;
  if (myId == null) return owner == null;
  return owner === myId;
}

/**
 * Project a Folio item list to the "My things" notes-list rows, newest
 * first.  Filters via {@link isMyPrivateItem} and normalises through
 * {@link normalizeFolioFile} so the row shape matches the existing
 * circle-files renderer.
 *
 * @param {object}   [opts]
 * @param {object[]} [opts.files=[]]   raw Folio items
 * @param {?string}  [opts.myId=null]  active user's webid
 * @returns {{ id, name, kind, size, updatedAt }[]}
 */
export function buildMyThings({ files = [], myId = null } = {}) {
  const list = Array.isArray(files) ? files : [];
  return list
    .filter((f) => isMyPrivateItem(f, myId))
    .map(normalizeFolioFile)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Convenience wrapper around a `listFiles` op result (same shape
 * tolerance as `circleFilesFromListFiles`).
 */
export function myThingsFromListFiles(result, myId = null) {
  const files = result && typeof result === 'object'
    ? (Array.isArray(result.items) ? result.items
      : Array.isArray(result.files) ? result.files
        : Array.isArray(result) ? result : [])
    : [];
  return buildMyThings({ files, myId });
}
