/**
 * basis v2 — circle scoping (shared web + mobile).
 *
 * F1: given an active `circleId`, decide which items belong to it. An
 * item is "in" a circle if any of its circle references match — it
 * carries `circleId` / `circleId` (alias, CIRCLE_ID_IS_CREW_ID_ALIAS) /
 * `groupId`, or an `audience` shorthand like `circle:ID` / `circle:ID`
 * (or the structured `{kind:'circle-ref', id}`). Self-contained — no
 * `@onderling/circles` import — so it stays portable for Metro/RN.
 *
 * A null/empty `circleId` means "no active circle" → unscoped (keep all).
 */

/** The circle id an item is scoped to, or null if it carries none. */
export function itemCircleId(item = {}) {
  if (item.circleId) return item.circleId;
  if (item.circleId) return item.circleId;
  if (item.groupId) return item.groupId;
  // Pinboard persists the per-call circle scope NESTED, not at the top level:
  //  • real posts → source.targets[{ kind:'group', groupId }] (the write path injects it)
  //  • system items (rules / membership) → source.groupId
  // Reading top-level only meant every item looked "unscoped" → the circle filter kept
  // everything → cross-circle leak on the noticeboard. Read the nested hints too.
  const targets = item.source?.targets;
  if (Array.isArray(targets)) {
    const g = targets.find((t) => t && t.kind === 'group' && typeof t.groupId === 'string');
    if (g) return g.groupId;
  }
  if (typeof item.source?.groupId === 'string' && item.source.groupId) return item.source.groupId;
  const a = item.audience;
  if (typeof a === 'string') return circleRefFromShorthand(a);
  if (a && typeof a === 'object' && a.kind === 'circle-ref' && a.id) return a.id;
  return null;
}

function circleRefFromShorthand(str) {
  const i = str.indexOf(':');
  if (i < 0) return null;
  const prefix = str.slice(0, i);
  if (prefix === 'circle') return str.slice(i + 1) || null;
  return null;
}

/**
 * (renderer normalisation) — canonicalise an audience VALUE's
 * circle-ref representation so the two equivalent spellings compare equal:
 *
 *   'circle:X'                    →  { kind: 'circle-ref', id: 'X' }
 *   { kind: 'circle-ref', id }    →  (unchanged)
 *   { kind:'union', of:[…] }      →  a union with each member normalised
 *   anything else                 →  (unchanged, verbatim)
 *
 * The gap it closes on the render path: a view declares its audience as the
 * string short-hand `defaultAudience: 'circle:X'` while an item created
 * through a `@onderling/circles` / saved-view path stores the STRUCTURED
 * `{ kind:'circle-ref', id:'X' }` (or vice versa).  Those are the same
 * audience, but item-store's `audienceMatches` is strict-equal by default
 * (it can't depend on `@onderling/circles` to canonicalise), so without this
 * the structured-audience items silently drop out of a `circle:X` view.
 * `buildScreenModel` runs BOTH the item audience and the view audience
 * through this before matching, so both spellings meet in one canonical form.
 *
 * Recurses into `union.of` so a `circle:X` member nested in a union is
 * canonicalised too (item-store's union-membership rule then matches it).
 * Kept self-contained (no `@onderling/circles` import) for the same Metro/RN-
 * portability reason as the rest of this module, and reusing the one
 * `circle:`-shorthand parser so the spelling lives once.
 *
 * Idempotent: normalising an already-canonical value returns an equal value.
 * Only the circle-ref spelling is canonicalised; every other short-hand
 * ('household', 'private', 'role:*', 'public') and the `set` shape are
 * returned verbatim, so all of `audienceMatches`' other rules are untouched.
 *
 * @param {*} a  an audience value (string short-hand or structured)
 * @returns {*}  the value with any `circle:` short-hand canonicalised
 */
export function normalizeAudienceRef(a) {
  if (typeof a === 'string') {
    const id = circleRefFromShorthand(a);
    return id ? { kind: 'circle-ref', id } : a;
  }
  if (a && typeof a === 'object' && a.kind === 'union' && Array.isArray(a.of)) {
    return { kind: 'union', of: a.of.map(normalizeAudienceRef) };
  }
  return a;
}

/** Is `item` in `circleId`? A null circleId (no active circle) matches everything. */
export function isInCircle(item, circleId) {
  if (!circleId) return true;
  return itemCircleId(item) === circleId;
}

/** Filter `items` to the active circle (returns a copy; tolerates non-arrays). */
export function scopeItems(items, circleId) {
  const list = Array.isArray(items) ? items : [];
  if (!circleId) return list.slice();
  return list.filter((it) => isInCircle(it, circleId));
}
