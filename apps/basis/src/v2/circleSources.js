/**
 * basis v2 — circle sources adapter (shared web + mobile).
 *
 * Maps the host's dispatch onto the `loadCircles` fetchers, reusing
 * EXISTING ops only — `getMyCircles` (tasks circles, shape
 * `{circles:[{circleId,name,kind,counts}]}`) and `getCurrentGroup` (the stoop
 * circle record behind `/groups`) — plus an optional `@onderling/circles`
 * store. No new ops are invented; the host injects `callSkill` (web: its
 * dispatch; mobile: hostOps) so the same adapter drives both launchers.
 */

import { HELP_CIRCLE_ID } from './helpCircle.js';

export function circleSourcesFromAgent({ callSkill, circlesStore, helpCircleName } = {}) {
  const call = async (opId, args) => {
    if (typeof callSkill !== 'function') return null;
    return callSkill(opId, args ?? {});
  };
  // `helpCircleName` may be a string or a `() => string` getter (live-language). listMyCircles
  // returns bare ids, so without this the help circle's tile/header falls back to the raw id.
  const resolveHelpName = () =>
    (typeof helpCircleName === 'function' ? helpCircleName() : helpCircleName) || null;

  return {
    fetchTasksCircles: async () => {
      const res = await call('getMyCircles');
      return Array.isArray(res?.circles) ? res.circles : [];
    },
    fetchGroups: async () => {
      // listMyCircles → { circles: [groupId, ...] } — ALL circles the actor is
      // in (incl. one just created via createGroupV2). getCurrentGroup only
      // returned the single active circle, so new circles never surfaced.
      const res = await call('listMyCircles');
      const circles = Array.isArray(res?.circles) ? res.circles : [];
      const helpName = resolveHelpName();
      return circles.map((b) => {
        const raw = (typeof b === 'string') ? { id: b, name: b } : { ...b };
        // The help circle is a system circle whose title is localised chrome; listMyCircles
        // only carries ids, so relabel it here — otherwise its tile/header shows the raw id.
        if (helpName && raw.id === HELP_CIRCLE_ID) raw.name = helpName;
        return raw;
      });
    },
    // NO `fetchCircles` here. It used to read an optional `@onderling/circles` store off the agent — and
    // nothing has EVER assigned `agent.circlesStore`, on any branch, in 4,422 commits. So the branch was
    // permanently `undefined`: the source silently never existed, with no error and no warning. Its test
    // passed a hand-made `{list}` fake, which proved the BRANCH worked while nothing proved the WIRING did
    // (removed 2026-08-03).
    //
    // Not re-wired on purpose. Standing up `createCirclesStore` here would create a SECOND circle registry
    // beside stoop's `getMyCircles`/`listMyCircles`, which is the confusion the planned stoop→circles
    // extraction exists to remove — see `DESIGN-ops-flows-nav` §8c. The list of circles has one home.
  };
}

/** App origins probed when resolving an op to its owning app (both surfaces). */
// 'agents' LAST (2026-07-09) — the read-only "your agents" surface. Personal
// (the user's own agent-registry, not per-circle data), but it must be in the
// composed-app scope for its ops to survive scopeCatalogueToApps and reach the
// slash-suggest / LLM tool list on web. Matches the merge order in
// circleApp.js baseSources + mobile composeManifests.js (manifest-pipeline.md).
export const DEFAULT_CIRCLE_ORIGINS = ['stoop', 'tasks', 'household', 'calendar', 'folio', 'agents'];

// Perf #2 (2026-05-30) — does `catalogue` declare `opId` on `origin`?
// The merged catalogue stores ops under either the bare `opId` (then
// `entry.appOrigin` names the source) OR `'<origin>/<opId>'` for
// disambiguated declarations.  Treat either form as a hit.  Returns
// `true` when no catalogue is supplied so callers without one keep the
// legacy probe-everything behaviour.
function catalogueHasOp(catalogue, origin, opId) {
  if (!catalogue || typeof catalogue !== 'object' || !catalogue.opsById) return true;
  if (catalogue.opsById.get(`${origin}/${opId}`)) return true;
  const bare = catalogue.opsById.get(opId);
  return !!(bare && bare.appOrigin === origin);
}

// Positive-only: does the catalogue POSITIVELY declare `opId` on `origin`? Unlike
// catalogueHasOp it does NOT default-true on a missing catalogue — used to decide
// whether the catalogue "knows" an op anywhere (so the gate only filters ops the
// catalogue actually placed, never agent-skill ops absent from every manifest).
function catalogueDeclaresOp(catalogue, origin, opId) {
  if (!catalogue || typeof catalogue !== 'object' || !catalogue.opsById) return false;
  if (catalogue.opsById.get(`${origin}/${opId}`)) return true;
  const bare = catalogue.opsById.get(opId);
  return !!(bare && bare.appOrigin === origin);
}

/**
 * Wrap a host's 3-arg `callSkill(appOrigin, opId, args)` into the 2-arg
 * `callSkill(opId, args)` the circle helpers expect, by probing each app
 * origin and returning the first non-null result. Web's `agent.callSkill`
 * and mobile's `bundle.callSkill` share this signature, so both reuse it.
 *
 * `catalogue` is optional but recommended: when supplied, the resolver
 * skips origins whose manifests don't declare `opId`, which avoids
 * pointless transport round-trips for aspirational ops (Perf #2,
 * 2026-05-30).  Pass the merged catalogue returned by `mergeManifests`.
 */
export function makeResolvingCallSkill(rawCallSkill, origins = DEFAULT_CIRCLE_ORIGINS, catalogue = null) {
  // `catalogue` may be a live GETTER (so a later rescope — app toggle / policy.apps
  // — is honoured) or a static object. Resolved per call.
  const getCatalogue = typeof catalogue === 'function' ? catalogue : () => catalogue;
  return async (opId, args) => {
    if (typeof rawCallSkill !== 'function') return null;
    // A broken catalogue getter (e.g. one closing over an out-of-scope var) must NOT take
    // down resolution — that silently turned every circle-source call into a throw the
    // caller's safe() swallowed → "No circles yet". Treat a throwing/absent getter as an
    // unknown catalogue (→ try all origins).
    let cat = null;
    try { cat = getCatalogue(); } catch { cat = null; }
    // The catalogue gate (Perf #2) skips an origin the catalogue says doesn't declare
    // the op — but ONLY when the catalogue positively knows the op on SOME origin
    // (an "aspirational op" like getFeed/listNotes declared elsewhere). Essential
    // circle-source ops that are AGENT skills, not manifest ops — `getMyCircles`
    // (tasks), `listMyCircles` (stoop) — appear on NO origin in the catalogue, so the
    // per-origin gate used to skip them everywhere → loadCircles returned nothing →
    // "No circles yet" on every reload. When the op is unknown to the catalogue, try
    // all origins (the gate is a perf hint, not a hard filter).
    const knownSomewhere = origins.some((app) => catalogueDeclaresOp(cat, app, opId));
    for (const app of origins) {
      if (knownSomewhere && !catalogueHasOp(cat, app, opId)) continue;
      try {
        const r = await rawCallSkill(app, opId, args ?? {});
        if (r != null) return r;
      } catch { /* try next origin */ }
    }
    return null;
  };
}
