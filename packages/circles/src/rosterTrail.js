/**
 * The roster's TRAIL — the item type whose rows a circle's membership is projected from — and the one
 * rule about how those rows travel.
 *
 * A roster row is not an ordinary item. Its addresses enter the projection only PROVEN (each pair carries
 * a proof that verifies at the fold — `deriveRoster`'s deny-by-default gate), it is patched in place by
 * the announce receive path, and it reaches other devices by carriers that keep that trust: the join
 * statements on the membership lane, the announces, the roster seed between a person's own devices.
 *
 * The task lane also carries a circle store's rows — as signed SNAPSHOTS, causally merged, last version
 * wins. Until 2026-09-13 that included these rows, and two devices of one person each hold "the person's
 * row" with a different primary address (a device never records its own; it records its siblings' by
 * announce). The phone's snapshot of the row therefore landed on the box a moment after the box had
 * patched the phone's proven address onto its copy, and replaced it — the phone's version names the box,
 * not itself — so everything the phone signed was refused on the box as unbindable, one enrol in ten.
 * Two carriers with different merge rules for one row is the defect; this predicate is the fix: the
 * task lane neither serves nor applies a roster row. The roster converges by its own carriers.
 */

/** The trail's item type. The storage-era label was the same word under `kind`; both are read. */
const ROSTER_TRAIL_TYPE = 'membership-redemption';

/** @param {object} item  @returns {boolean} whether a store row is a roster-trail row */
export function isRosterTrailItem(item) {
  return !!item && (item.type === ROSTER_TRAIL_TYPE || item.kind === ROSTER_TRAIL_TYPE);
}
