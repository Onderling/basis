/**
 * basis — thread filter DSL.
 *
 * Each thread (per design choice D) has an explicit filter that
 * decides which inbound events (notifier output, item-changed events,
 * skill-reply async completions) get routed to it.
 *
 * Filter shape (v0.2):
 *
 *   {
 *     apps?:       string[],    // ['household']            ['*']      ['*']
 *     eventTypes?: string[],    // ['notification','reminder']
 *     actors?:     string[],    // webids of actors whose events to include
 *   }
 *
 * Semantics:
 *   - Each key is independent — combined with AND (event must satisfy
 *     every specified key).
 *   - Within a key, values are OR-combined (event matches if it equals
 *     ANY of the listed values).
 *   - Key absent / undefined / empty-array → wildcard for that dimension.
 *   - The special token '*' inside any array also acts as a wildcard
 *     for that dimension (convenience).
 *
 * Phase v0.2 per `/Project Files/basis/coding-plan.md`.
 */

/**
 * @typedef {object} ThreadFilter
 * @property {string[]} [apps]
 * @property {string[]} [eventTypes]
 * @property {string[]} [actors]
 * @property {string[]} [circleId] matches `event.payload.groupId` (circle-scoped threads)
 * @property {boolean} [dm] informational flag — true when this is a 1:1 DM thread
 */

/**
 * @typedef {object} Event
 * @property {string}              id
 * @property {number}              ts
 * @property {string}              app
 * @property {string}              type
 * @property {string}              [actor]
 * @property {{app: string, type: string, id: string}} [itemRef]
 * @property {*}                   [payload]
 */

/**
 * Returns true iff the event matches the filter.
 *
 * Two filter shapes are accepted (backward-compatible per OQ-2.A
 * user resolution 2026-05-23):
 *
 *   1. Flat key:value (v0.2 shape) — `{ apps?, eventTypes?, actors? }`.
 *      Keys are AND-combined; arrays within each key are OR-combined.
 *
 *   2. Expression tree (v0.6 OQ-2.A) — explicit Boolean composition:
 *      `{ and: [<filter>, <filter>, ...] }`
 *      `{ or:  [<filter>, <filter>, ...] }`
 *      `{ not: <filter> }`
 *      Leaves are either flat-shape filters OR the wildcard {}.
 *
 *   Mixed example:
 *     {
 *       and: [
 *         { apps: ['household', 'tasks-v0'] },     // app:household OR app:tasks-v0
 *         { or: [
 *             { actors: ['webid:anne'] },
 *             { eventTypes: ['reminder'] },
 *         ]},
 *         { not: { eventTypes: ['notification'] } },
 *       ],
 *     }
 *
 * @param {Event}        event
 * @param {ThreadFilter} [filter]   absent / null → wildcard everything
 * @returns {boolean}
 */
export function matchesFilter(event, filter) {
  if (!event || typeof event !== 'object') return false;
  if (!filter || typeof filter !== 'object') return true;
  if (Array.isArray(filter)) return false;   // defensive: arrays aren't filters

  // Expression-tree branches (OQ-2.A resolution).  An object with
  // an `and` / `or` / `not` key is treated as a Boolean composition;
  // we walk recursively.  Keys can co-exist with flat-shape keys —
  // the implicit AND between tree keys and flat keys preserves the
  // "every specified condition" semantic.
  if ('and' in filter) {
    if (!Array.isArray(filter.and)) return false;
    for (const sub of filter.and) {
      if (!matchesFilter(event, sub)) return false;
    }
  }
  if ('or' in filter) {
    if (!Array.isArray(filter.or) || filter.or.length === 0) {
      // empty `or: []` matches nothing (consistent with logic — OR
      // over an empty set is false).
      return false;
    }
    let anyMatched = false;
    for (const sub of filter.or) {
      if (matchesFilter(event, sub)) { anyMatched = true; break; }
    }
    if (!anyMatched) return false;
  }
  if ('not' in filter) {
    if (matchesFilter(event, filter.not)) return false;
  }

  // Flat-shape leaves (still applied; they AND with the tree above).
  if (!matchesKey(event.app,    filter.apps))       return false;
  if (!matchesKey(event.type,   filter.eventTypes)) return false;
  if (!matchesKey(event.actor,  filter.actors))     return false;
  // circle scoping reads groupId off the event payload.
  // publishEventRef calls from handleCirclePost + local post echo
  // surface `payload.groupId`.
  if (!matchesKey(event.payload?.groupId, filter.circleId)) return false;
  return true;
}

/**
 * Per-key match.  Returns:
 *   - true when `allowed` is absent / null / [] / contains '*'
 *   - true when `allowed` includes `value`
 *   - false otherwise
 *
 * @param {string|undefined} value
 * @param {string[]|undefined} allowed
 * @returns {boolean}
 */
function matchesKey(value, allowed) {
  if (!Array.isArray(allowed) || allowed.length === 0) return true;
  if (allowed.includes('*'))   return true;
  // Defensive: empty actor/value should NOT match a non-wildcard list.
  if (value === undefined || value === null || value === '') return false;
  return allowed.includes(value);
}

/* ─── normalisation + introspection helpers ───────────────────────── */

/**
 * Normalise a user-supplied filter into a canonical shape suitable for
 * storage / serialisation: arrays sorted + de-duped; empty arrays
 * dropped.  Idempotent.
 *
 * @param {ThreadFilter} [filter]
 * @returns {ThreadFilter}
 */
export function normaliseFilter(filter) {
  if (!filter || typeof filter !== 'object') return {};
  const out = {};
  for (const key of ['apps', 'eventTypes', 'actors', 'circleId']) {
    const arr = filter[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const dedup = [...new Set(arr.map((v) => String(v)))].sort();
    out[key] = dedup;
  }
  // preserve the informational `dm` flag. It's a boolean,
  // not an array, so it doesn't go through the dedup loop.
  if (filter.dm === true) out.dm = true;
  return out;
}

/**
 * Returns true iff the filter is a wildcard (matches every event).
 * A filter is wildcard when every key is absent, empty, or contains '*'.
 *
 * @param {ThreadFilter} [filter]
 * @returns {boolean}
 */
export function isWildcardFilter(filter) {
  if (!filter || typeof filter !== 'object') return true;
  // Expression-tree filters are NEVER wildcards (they have explicit
  // composition; even {and: []} doesn't match everything).
  if ('and' in filter || 'or' in filter || 'not' in filter) return false;
  for (const key of ['apps', 'eventTypes', 'actors', 'circleId']) {
    const arr = filter[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    if (arr.includes('*')) continue;
    return false;
  }
  // `dm: true` narrows the thread scope, so it's not wildcard.
  if (filter.dm === true) return false;
  return true;
}

/**
 * Human-readable summary of a filter ('app:household, type:notification').
 * Useful for UI labels in the thread-list sidebar.
 *
 * @param {ThreadFilter} [filter]
 * @returns {string}
 */
export function describeFilter(filter) {
  if (isWildcardFilter(filter)) return '*';
  if (!filter || typeof filter !== 'object') return '*';

  // Expression-tree branches — describe recursively with operator
  // notation.  Keeps the sidebar label compact even for complex
  // filters.
  if (filter.and || filter.or || filter.not) {
    const treeParts = [];
    if (Array.isArray(filter.and) && filter.and.length > 0) {
      treeParts.push(`(${filter.and.map(describeFilter).join(' AND ')})`);
    }
    if (Array.isArray(filter.or)  && filter.or.length > 0) {
      treeParts.push(`(${filter.or.map(describeFilter).join(' OR ')})`);
    }
    if (filter.not) {
      treeParts.push(`NOT ${describeFilter(filter.not)}`);
    }
    // Flat keys also present? Append them AND-style.
    const flatParts = [];
    if (filter.apps?.length)       flatParts.push(`app:${filter.apps.join('|')}`);
    if (filter.eventTypes?.length) flatParts.push(`type:${filter.eventTypes.join('|')}`);
    if (filter.actors?.length)     flatParts.push(`actor:${filter.actors.join('|')}`);
    if (filter.circleId?.length)    flatParts.push(`circle:${filter.circleId.join('|')}`);
    return [...treeParts, ...flatParts].join(' AND ');
  }

  const parts = [];
  if (filter.apps?.length)       parts.push(`app:${filter.apps.join('|')}`);
  if (filter.eventTypes?.length) parts.push(`type:${filter.eventTypes.join('|')}`);
  if (filter.actors?.length)     parts.push(`actor:${filter.actors.join('|')}`);
  if (filter.circleId?.length)    parts.push(`circle:${filter.circleId.join('|')}`);
  return parts.join(', ');
}
