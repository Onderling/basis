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
import { revealedMemberLabel } from './circleViewAs.js';

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
    ?? p.circleId
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
 * circle-scoped Stream projection (right 8C). Tap
 * a circle on the launcher and you land on its content surface: the
 * cross-circle `buildCircleStream` rows narrowed to a single circle,
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
 * differed — and two of them were the same word in two languages (`buildCircleStream` / `buildCircleStream`;
 * *circle* IS circle), so a reader could not tell which selected a SCOPE and which selected CONTENT.
 *
 *   • **scope**   — `circleId`: one circle, a LIST of them, or null for all
 *   • **content** — `lane` (human vs system) and/or `kinds` (specific entry types)
 *
 * A combine-and-filter surface is then just a control that sets these two, not a new query path. Screens
 * (`userScreens.js`) already express exactly this shape — `circleFilter` is scope, `blocks` is content — so
 * accepting a circle LIST here is what lets `userScreenBlocks` stop looping per circle and merging by hand.
 *
 * @param {object}   [opts]
 * @param {object[]} [opts.events]    LoggedEvent[] (newest-first)
 * @param {object[]} [opts.circles]   normalized circles, for the tag
 * @param {?string|string[]} [opts.circleId]  null = every circle
 * @param {?string}  [opts.kindFilter]  one of CIRCLE_STREAM_KIND_FILTERS, or null
 * @param {?string[]} [opts.kinds]      explicit entry kinds to keep (null = any)
 * @param {?string}  [opts.lane]        'human' keeps conversation only; null = both lanes
 * @returns {ReturnType<typeof buildCircleStream>}
 */
export function projectEntries({
  events = [], circles = [], circleId = null, kindFilter = null, kinds = null, lane = null, actor = null,
  excludeActors = null,
} = {}) {
  const rows = buildCircleStream({ events, circles });

  // scope
  let out = rows;
  if (circleId != null) {
    const wanted = Array.isArray(circleId) ? new Set(circleId) : new Set([circleId]);
    out = out.filter((r) => wanted.has(r.circleId));
  }
  // The agent-trail lens (one-log step E): the SAME log, narrowed to one actor — an agent's activity
  // card is `projectEntries({ actor })`, not a second store. Exact match on the entry's stamped actor.
  if (actor != null) out = out.filter((r) => r.actor === actor);
  // The PERSON-mute view filter (the chat-lane sitting's rule: a muted member's messages LAND on the
  // log — refusing them at ingest would silently discard history — and are hidden HERE, at the one
  // projection every chat surface reads; unmute restores everything). `excludeActors` is the resolved
  // set of muted actor refs (see `mutedActorSet`). An unresolvable/absent actor is never hidden.
  if (excludeActors && (excludeActors.size ?? excludeActors.length)) {
    const hide = excludeActors instanceof Set ? excludeActors : new Set(excludeActors);
    out = out.filter((r) => !(typeof r.actor === 'string' && hide.has(r.actor)));
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

/**
 * Resolve the stoop mute-set's KEYS (stableId, or a webid fallback — `_resolveMuteKey`'s contract) into
 * the ACTOR REFS the log entries carry, against the circle roster. A stableId with no roster row passes
 * through unchanged (it simply matches nothing — deny-nothing, hide-only-what-resolves). Pure; both
 * shells build their `excludeActors` through this so the mapping cannot drift per platform.
 *
 * @param {string[]} mutedKeys   `listMutedPeers().peers`
 * @param {Array<{webid?:string, stableId?:string}>|null} members  the circle roster
 * @returns {Set<string>}
 */
export function mutedActorSet(mutedKeys, members) {
  const out = new Set();
  for (const k of Array.isArray(mutedKeys) ? mutedKeys : []) {
    if (typeof k !== 'string' || !k) continue;
    const m = (Array.isArray(members) ? members : []).find((mm) => mm?.stableId === k);
    out.add(m?.webid ?? (k.startsWith('webid:') ? k.slice(6) : k));
  }
  return out;
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
 * table), which would drop tasks and circle rows out of GESPREK — a product call, deliberately NOT taken
 * here. When it is, this wrapper is the only place that changes.
 */
export function chatRows(opts = {}) {
  const { members = null, viewerId = null, policy = 'pairwise', ...rest } = opts;
  const rows = projectEntries({ ...rest, lane: 'human' });
  // Conservation: a caller that passes no roster gets exactly the pre-existing rows.
  if (!Array.isArray(members)) return rows;
  return stampSenderLabels(rows, { members, viewerId, policy });
}

/**
 * Stamp each row with the sender label a shell may actually RENDER — the projection half of the
 * disclosure exit (G-A1). Until this, every surface carried its own `pickSender` reading names OFF THE
 * PAYLOAD (`senderDisplay` / `authorName` / `displayName`) — i.e. whatever the sender claimed on the
 * wire, which fails the enforceability test twice over: an unrevealed member's real name could ride in,
 * and a forged one could too. The roster is the authority; resolve locally, through the reveal ladder.
 *
 *   - `senderSelf`      — the row is the viewer's own (shells suppress the label on own bubbles).
 *   - `senderLabel`     — the reveal-gated label (`revealedMemberLabel(...).primary`), or null.
 *   - `senderLabelKey`  — locale key when there is no label to show: an actor not on the roster
 *     (departed, or never resolved) gets `circle.chat.unknown_sender`, because a BLANK reads as "mine"
 *     and a raw id reads as noise. `t()` lives in the shells (invariant 8); this module stays pure.
 *
 * Matching: `row.actor` is the resolved webid where resolution succeeded, or the raw transport address
 * where it did not — so the index also carries `circleAddress`. That is a local lookup of a locally-held
 * roster row, NOT trusting the wire (the address was proven at join, G12).
 *
 * @param {object[]} rows      StreamRow[] (any projector's output)
 * @param {{members: object[], viewerId?: ?string, policy?: 'open'|'pairwise'}} a
 * @returns {object[]} the same rows, sender-stamped
 */
export function stampSenderLabels(rows, { members = [], viewerId = null, policy = 'pairwise' } = {}) {
  const byKey = new Map();
  for (const m of members) {
    if (!m || typeof m !== 'object') continue;
    for (const k of [m.id, m.webid, m.circleAddress]) if (k != null) byKey.set(k, m);
  }
  return (rows || []).map((row) => {
    const actor = row?.actor ?? null;
    const self = viewerId != null && actor === viewerId;
    if (self) return { ...row, senderSelf: true, senderLabel: null, senderLabelKey: null };
    const member = actor != null ? byKey.get(actor) : null;
    if (!member) {
      return { ...row, senderSelf: false, senderLabel: null, senderLabelKey: 'circle.chat.unknown_sender' };
    }
    return {
      ...row,
      senderSelf: false,
      senderLabel: revealedMemberLabel(member, { viewerId, policy }).primary,
      senderLabelKey: null,
    };
  });
}

/**
 * One actor, every circle — the AGENT TRAIL (one-log step E, the box the agent-management surface was
 * stuck on). Answers "what did this agent do?" as a projection over the one log — the entries' `via`
 * (`grant:<id>` | `mandate:<task>` | `owner`) says what authority each action used, which is what keeps
 * "what did that revoked delegation reach?" answerable after the grant is gone. Owner activity is NOT
 * shown by default anywhere — a bot-audit surface must not become self-surveillance (product call #2's
 * lean, recorded in the plan); the caller chooses whose trail to open.
 */
export function agentTrailRows({ actor, ...opts } = {}) {
  if (actor == null) return [];   // no actor = no trail — never fall open into the whole firehose
  return projectEntries({ ...opts, actor });
}

/* The Dutch aliases that used to live here (`buildKringStream`/`buildKringChat`) are gone. They existed
 * so an earlier rename could be gradual; the standing rule is no backwards compatibility, and keeping a
 * second name for one function is how a codebase ends up with two words for the same thing — which is
 * exactly what this sweep is removing. `circleRows` and `chatRows` are the names; `buildCircleStream`
 * above is the cross-circle builder they wrap.
 *
 * `buildCircleChat` stays: unlike the stream one it never collided with anything — it simply IS the
 * English name for `chatRows`, and it has importers.
 */

/** The single-circle chat rows. (`chatRows` is the newer spelling; both name one function.) */
export const buildCircleChat = chatRows;

/** Kind keys the filter strip exposes, in render order. */
export const CIRCLE_STREAM_KIND_FILTERS = ['all', 'vraag', 'aanbod', 'leen'];
