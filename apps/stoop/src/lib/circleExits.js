/**
 * circleExits — who has LEFT or been REMOVED from ONE circle (B4).
 *
 * ── The bug this closes ─────────────────────────────────────────────────────────────────────────
 * Until 2026-08-02 removing a member did two things, and neither of them was "remove them from this
 * circle":
 *
 *   1. it wrote a `group-removal` audit item — which **nothing read**. The roster is a projection of
 *      the `membership-redemption` trail (`deriveRoster`), and that projection had no notion of an
 *      exit, so the removed member stayed on the circle's roster, stayed in the fan-out, and stayed
 *      in the boundary-authentication snapshot. The admin saw them disappear only because of (2);
 *   2. it deleted the member from `MemberMap` — which is **global**. One `MemberMap` per device
 *      holds every member of every circle with no circle on the row, so tidying circle A dropped
 *      that person's display identity (and, for a legacy circle with no trail, their membership) in
 *      every circle you share with them.
 *
 * So the effect was exactly inverted: global where it should have been local, and inert where it
 * should have bitten. This module is the local, biting half.
 *
 * ── The rule ───────────────────────────────────────────────────────────────────────────────────
 * An exit is a durable, circle-scoped item — `group-removal` (an admin removed them) or
 * `group-leave` (they left) — carrying `source.groupId`. A member is OUT of that circle when their
 * latest exit is LATER than their latest join. Comparing the two timestamps rather than testing for
 * "an exit exists" is what makes a **re-join** work: an admin removes someone, they redeem a fresh
 * invite, their new `redeemedAt` is later than the removal and they are a member again. A rule that
 * only asked "was there ever a removal?" would make removal permanent and unappealable, which is a
 * different (and much worse) product.
 *
 * ── Scope, honestly ────────────────────────────────────────────────────────────────────────────
 * This decides membership **on the device that holds the item**. `group-removal` is written on the
 * admin's device and `group-leave` on the leaver's; both are ordinary `visibility: 'household'`
 * items, so they travel wherever that circle's items travel — but nothing here *pushes* an exit to
 * the other members. What removal does reach, immediately and on the device that matters, is the
 * ADMIN's own roster, fan-out and boundary-authentication snapshot: the removed member stops being
 * addressed and stops being ALLOWED TO SPEAK to the person who removed them. Propagating an
 * eviction to every member's device is a separate mechanism (it needs a signed, replayable
 * statement, not an item the recipient must trust the sender about) and is not built here.
 */

/** Item types that record an exit from a circle. */
export const CIRCLE_EXIT_TYPES = Object.freeze(['group-removal', 'group-leave']);

/**
 * The webid an exit item is ABOUT, and when it happened.
 *
 * `group-removal` names its target explicitly (`memberWebid`); `group-leave` is always about its own
 * author (`leftBy`). A removal recorded by stableId alone names nobody resolvable here — the skill
 * resolves the webid before writing, so a row without one is a pre-2026-08-02 item and is skipped
 * rather than guessed at.
 *
 * @param {object} item
 * @returns {{webid: string, at: number}|null}
 */
export function exitFromItem(item) {
  const src = (item && item.source) ?? {};
  if (item?.type === 'group-removal') {
    const webid = typeof src.memberWebid === 'string' && src.memberWebid ? src.memberWebid : null;
    if (!webid) return null;
    const at = typeof src.removedAt === 'number' ? src.removedAt : 0;
    return { webid, at };
  }
  if (item?.type === 'group-leave') {
    const webid = typeof src.leftBy === 'string' && src.leftBy ? src.leftBy : null;
    if (!webid) return null;
    const at = typeof src.leftAt === 'number' ? src.leftAt : 0;
    return { webid, at };
  }
  return null;
}

/**
 * Collapse a circle's exit items into `webid → latest exit timestamp`.
 *
 * @param {object} a
 * @param {Array<object>} [a.items]   `group-removal` + `group-leave` items (any groups)
 * @param {string} a.groupId          only items for THIS circle are considered
 * @returns {Map<string, number>}
 */
export function collectCircleExits({ items = [], groupId } = {}) {
  const exits = new Map();
  if (!groupId) return exits;
  for (const it of Array.isArray(items) ? items : []) {
    if (it?.source?.groupId !== groupId) continue;
    const e = exitFromItem(it);
    if (!e) continue;
    const prev = exits.get(e.webid);
    if (prev === undefined || e.at > prev) exits.set(e.webid, e.at);
  }
  return exits;
}

/**
 * Read a circle's exits straight from an ItemStore. The one read every caller shares, so the roster
 * projection, the fan-out roster and the legacy fallback cannot come to disagree about who is in.
 *
 * @param {object} a
 * @param {{listOpen: Function}} a.store
 * @param {string} a.groupId
 * @returns {Promise<Map<string, number>>}
 */
export async function readCircleExits({ store, groupId } = {}) {
  if (!store || typeof store.listOpen !== 'function' || !groupId) return new Map();
  const items = [];
  for (const type of CIRCLE_EXIT_TYPES) {
    try { items.push(...(await store.listOpen({ type })) ?? []); }
    catch { /* a missing type is an empty set, not a failure */ }
  }
  return collectCircleExits({ items, groupId });
}

/**
 * Is this member currently OUT of the circle?
 *
 * @param {Map<string, number>} exits    from `collectCircleExits`
 * @param {string} webid
 * @param {number} [joinedAt]            their latest join (`redeemedAt`); 0/absent for a founder
 * @returns {boolean}
 */
export function isExited(exits, webid, joinedAt = 0) {
  if (!(exits instanceof Map) || typeof webid !== 'string' || !webid) return false;
  const exitAt = exits.get(webid);
  if (exitAt === undefined) return false;
  return exitAt >= (typeof joinedAt === 'number' ? joinedAt : 0);
}

export default collectCircleExits;
