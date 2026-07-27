/**
 * basis v2 — cross-circle Stream projection (shared).
 *
 * The per-circle chat is the default; the Stream is the opposite lens —
 * ONE timeline interleaving every circle's inbound events by time, with a
 * circle-tag kept per row.  It's an unfiltered projection over the
 * existing EventLog (the firehose the /logs page already records), so this
 * module is pure: the host passes `events` (newest-first, e.g.
 * `eventLog.query({ excludeMuted: true })`) + the `circles` list, and gets
 * back tagged rows ready to render.  Web + mobile share this; the
 * renderers are thin.
 */

import { taskRowProvenance } from './streamActions.js';
import { isSilentEntry } from '../eventLog.js';

/**
 * Circle id for a logged event.  C15: entries MAY now carry a first-class
 * top-level `circleId` (stamped by e.g. `EventLog.appendSilentEntry`), which
 * we read DIRECTLY. Older entries — and paths that don't set it yet — fall
 * back to the best-effort payload dig (the usual audience fields; circleId ≡
 * groupId — see [[circleid-crewid-alias]]) then the itemRef. Returns null when
 * the event isn't circle-scoped (it still shows in the Stream, just untagged).
 */
export function eventCircleId(event) {
  if (event && typeof event === 'object' && event.circleId != null) return event.circleId;
  const p = event && typeof event.payload === 'object' && event.payload ? event.payload : {};
  return (
    p.circleId
    ?? p.groupId
    ?? p.buurtId
    ?? p.audience
    ?? event?.itemRef?.circleId
    ?? null
  );
}

/**
 * Project a logged-event list into circle-tagged Stream rows, newest
 * first.  Pure — no fetching, no filtering by circle (that's the point).
 *
 * @param {object}   [opts]
 * @param {object[]} [opts.events=[]]   LoggedEvent[] (newest-first)
 * @param {object[]} [opts.circles=[]]  normalized circles ({ id, name, ... })
 * @returns {{ id, ts, app, type, actor, circleId, circleName, event }[]}
 */
export function buildCircleStream({ events = [], circles = [] } = {}) {
  const byId = new Map((circles || []).map((c) => [c.id, c]));
  return (events || [])
    .filter((e) => e && typeof e === 'object')
    .map((e) => {
      const circleId = eventCircleId(e);
      const circle = circleId != null ? byId.get(circleId) : null;
      // First-class task provenance (taskId + addedBy) for task/chore/reminder
      // rows, so the owner-only entrust check downstream is DETERMINISTIC (not a
      // best-effort payload dig). Null for non-task rows → the fields are absent
      // and the row renders exactly as before (backwards-compatible).
      const prov = taskRowProvenance(e);
      return {
        id:         e.id,
        ts:         typeof e.ts === 'number' ? e.ts : 0,
        app:        e.app ?? null,
        type:       e.type ?? null,
        actor:      e.actor ?? null,
        circleId:   circleId ?? null,
        circleName: circle?.name ?? null,
        ...(prov ? { taskId: prov.taskId, addedBy: prov.addedBy } : {}),
        event:      e,
      };
    })
    .sort((a, b) => b.ts - a.ts);
}

/**
 * kring-scoped Stream projection (right 8C). Tap
 * a kring on the launcher and you land on its content surface: the
 * cross-kring `buildCircleStream` rows narrowed to a single circle,
 * optionally filtered by a row "kind" (vraag / aanbod / leen / chore /
 * reminder — same enum the chips on render).
 *
 * `kindFilter = null` (or 'all') = no kind filter.  Unknown kinds pass
 * through unfiltered; the helper is forward-compatible with new chips.
 *
 * @param {object}   [opts]
 * @param {object[]} [opts.events=[]]
 * @param {object[]} [opts.circles=[]]
 * @param {?string}  [opts.circleId=null]   active circle (null = unscoped)
 * @param {?string}  [opts.kindFilter=null] one of KIND_CHIPS keys, or null
 * @returns {ReturnType<typeof buildCircleStream>}
 */
/**
 * THE projector — every circle surface is this function with different arguments.
 *
 * Two axes, and naming them is half the point. Before this there were three functions whose names hid what
 * differed — and two of them were the same word in two languages (`buildCircleStream` / `buildKringStream`;
 * *kring* IS circle), so a reader could not tell which selected a SCOPE and which selected CONTENT.
 *
 *   • **scope**   — `circleId`: one circle, a LIST of them, or null for all
 *   • **content** — `lane` (human vs system) and/or `kinds` (specific entry types)
 *
 * A combine-and-filter surface is then just a control that sets these two, not a new query path. Screens
 * (`userScreens.js`) already express exactly this shape — `kringFilter` is scope, `blocks` is content — so
 * accepting a circle LIST here is what lets `userScreenBlocks` stop looping per circle and merging by hand.
 *
 * @param {object}   [opts]
 * @param {object[]} [opts.events]    LoggedEvent[] (newest-first)
 * @param {object[]} [opts.circles]   normalized circles, for the tag
 * @param {?string|string[]} [opts.circleId]  null = every circle
 * @param {?string}  [opts.kindFilter]  one of KRING_STREAM_KIND_FILTERS, or null
 * @param {?string[]} [opts.kinds]      explicit entry kinds to keep (null = any)
 * @param {?string}  [opts.lane]        'human' keeps conversation only; null = both lanes
 * @returns {ReturnType<typeof buildCircleStream>}
 */
export function projectEntries({
  events = [], circles = [], circleId = null, kindFilter = null, kinds = null, lane = null,
} = {}) {
  const rows = buildCircleStream({ events, circles });

  // scope
  let out = rows;
  if (circleId != null) {
    const wanted = Array.isArray(circleId) ? new Set(circleId) : new Set([circleId]);
    out = out.filter((r) => wanted.has(r.circleId));
  }

  // content — lane first (the cheap structural cut), then kinds
  if (lane === 'human') out = out.filter((r) => !isSilentEntry(r.event));
  if (Array.isArray(kinds)) {
    const keep = new Set(kinds);
    out = out.filter((r) => keep.has(r.event?.type));
  }
  if (kindFilter && kindFilter !== 'all') {
    const wanted = String(kindFilter).toLowerCase();
    out = out.filter((r) => {
      const p = r.event?.payload && typeof r.event.payload === 'object' ? r.event.payload : {};
      return [p.kind, r.event?.type, r.type, r.event?.kind]
        .some((c) => typeof c === 'string' && c.toLowerCase() === wanted);
    });
  }
  return out;
}

/* ── Named wrappers ──────────────────────────────────────────────────────────
 * Thin, and named for WHAT THEY SELECT rather than for a synonym of "circle". They exist so a call site
 * reads clearly; all three are `projectEntries` with different arguments.
 */

/** Every circle, every kind — the cross-circle firehose. */
export function allCircleRows(opts = {}) {
  return projectEntries({ ...opts, circleId: null });
}

/** One circle (or several), any lane — the circle timeline. */
export function circleRows(opts = {}) {
  return projectEntries(opts);
}

/**
 * One circle, conversation only — the chat surface.
 *
 * Today "conversation" means *not the silent system lane*, which is exactly the pre-existing behaviour.
 * C15's tail is to narrow this further to the conversation KINDS (`conversationKinds()` from the shared
 * table), which would drop tasks and buurt rows out of GESPREK — a product call, deliberately NOT taken
 * here. When it is, this wrapper is the only place that changes.
 */
export function chatRows(opts = {}) {
  return projectEntries({ ...opts, lane: 'human' });
}

/* ── Back-compat aliases ─────────────────────────────────────────────────────
 * The old names, kept so this stays a rename rather than a migration. `buildKringStream`/`buildCircleChat`
 * are re-pointed at the wrappers; call sites move over as they are touched.
 */

/** @deprecated use `circleRows` — the name says which axis it selects. */
export const buildKringStream = circleRows;

/** @deprecated use `chatRows`. */
export const buildCircleChat = chatRows;

/** Kind keys the filter strip exposes, in render order. */
export const KRING_STREAM_KIND_FILTERS = ['all', 'vraag', 'aanbod', 'leen'];
