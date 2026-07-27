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
export function buildKringStream({
  events = [], circles = [], circleId = null, kindFilter = null,
} = {}) {
  const rows = buildCircleStream({ events, circles });
  const scoped = circleId == null ? rows : rows.filter((r) => r.circleId === circleId);
  if (!kindFilter || kindFilter === 'all') return scoped;
  const wanted = String(kindFilter).toLowerCase();
  return scoped.filter((r) => {
    const p = r.event?.payload && typeof r.event.payload === 'object' ? r.event.payload : {};
    const cands = [p.kind, r.event?.type, r.type, r.event?.kind];
    return cands.some((c) => typeof c === 'string' && c.toLowerCase() === wanted);
  });
}

/**
 * Per-circle CHAT projection (C15). The chat is a projection of the ONE
 * canonical log — but chat stays a chat: it IGNORES the log's silent system
 * lane (`isSilentEntry`). The cross-circle Stream tab (`buildCircleStream` /
 * `buildKringStream`) is the firehose and still shows silent entries; only the
 * chat excludes them. Same scoping args as `buildKringStream` (per-circle when
 * `circleId` is set).
 *
 * The silent lane is LIVE (stale note corrected 2026-07-27 — it used to say nothing
 * appended one). Four paths do: governance events and §8 reports
 * (`governanceAppWiring`), the roster "pull-me" signal (`rosterUpdated`), and
 * every one of those arriving from a peer (`kringLogReceiver`). So this filter is
 * load-bearing now, not a placeholder: without it a vote, a report and a roster
 * ping would all appear as chat messages.
 *
 * C15 TAIL: narrowing the chat further to project ONLY `type:'chat-message'`
 * (today the GESPREK surface renders a "chat-style MIXED stream" — task/buurt
 * rows included) is part of the wider peer-router → one-stream migration, NOT
 * done here; excluding the silent lane is the additive, behaviour-preserving
 * slice.
 *
 * @param {object}   [opts]  same shape as `buildKringStream`
 * @returns {ReturnType<typeof buildKringStream>}
 */
export function buildCircleChat(opts = {}) {
  return buildKringStream(opts).filter((r) => !isSilentEntry(r.event));
}

/** Kind keys the filter strip exposes, in render order. */
export const KRING_STREAM_KIND_FILTERS = ['all', 'vraag', 'aanbod', 'leen'];
