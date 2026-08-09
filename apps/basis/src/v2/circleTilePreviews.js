/**
 * basis v2 — kring tile activity previews.
 *
 * Today's launcher tiles show member count only.  Activity previews put an
 * activity-style subtitle on each tile ("Mira: brood gehaald ✓",
 * "3 new questions on the board") + an unread-count badge.  This module
 * is the pure projection over the existing EventLog ('s Stream
 * already reads the same firehose); web + mobile render thin views over
 * the resulting per-circle map.
 *
 * Output shape per circleId:
 *   { subtitle: string|null, ts: number, unread: number }
 *
 *   subtitle = "<actor>: <text>" when the most-recent event carries both
 *              (e.g. a post / chat-message payload), or null when no
 *              event matched a renderable shape (host falls back to the
 *              member-count meta).
 *   ts       = ms-epoch of the most-recent matched event (0 when none).
 *   unread   = number of events for this circle whose `ts > seenAt[id]`
 *              (default 0 → "everything counts as unread the first time").
 *
 * Note the host owns the seenAt store — on the launcher we never touch
 * it; opening a circle bumps it to Date.now() (`bumpSeenAt(id)`).  Pure
 * helpers stay testable with a Map-backed snapshot.
 */
import { eventCircleId } from './circleStream.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — tile subtitle render cap (scope:device, kind:internal). `param()` returns 60.
const MAX_SUBTITLE_LEN = param({ key: 'circleTile.maxSubtitleLen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60 });

/**
 * Project an event list + seenAt snapshot into per-circle tile previews.
 *
 * @param {object}   [opts]
 * @param {object[]} [opts.events=[]]   LoggedEvent[] (any order; we sort)
 * @param {object[]} [opts.circles=[]]  normalised circles ({ id, ... })
 * @param {Object<string,number>} [opts.seenAt={}]  { [circleId]: epochMs }
 * @returns {Object<string, {subtitle: string|null, ts: number, unread: number}>}
 */
export function buildTilePreviews({ events = [], circles = [], seenAt = {} } = {}) {
  const known = new Set((circles || []).map((c) => c?.id).filter(Boolean));
  const out = {};
  // Seed entries for every known circle so the host can drive layout
  // off a stable keyset even when a circle has zero events.
  for (const id of known) out[id] = { subtitle: null, ts: 0, unread: 0 };

  const sorted = [...(events || [])]
    .filter((e) => e && typeof e === 'object')
    .sort((a, b) => (b?.ts ?? 0) - (a?.ts ?? 0));

  for (const event of sorted) {
    const cid = eventCircleId(event);
    if (!cid || !known.has(cid)) continue;
    const entry = out[cid];

    // First touch sets subtitle + ts (sorted newest-first).
    if (entry.subtitle === null && entry.ts === 0) {
      const sub = renderSubtitle(event);
      if (sub) entry.subtitle = sub;
      entry.ts = typeof event.ts === 'number' ? event.ts : 0;
    }
    // Unread: count every event newer than the host-supplied seenAt.
    const seen = typeof seenAt[cid] === 'number' ? seenAt[cid] : 0;
    if ((event.ts ?? 0) > seen) entry.unread += 1;
  }

  return out;
}

/**
 * Best-effort subtitle from a logged event.  Returns null when nothing
 * renderable is in the payload (host falls back to member-count meta).
 */
export function renderSubtitle(event) {
  if (!event || typeof event !== 'object') return null;
  const p = (event.payload && typeof event.payload === 'object') ? event.payload : {};
  const text = pickText(p);
  if (!text) return null;
  const actor = pickActor(event, p);
  const trimmed = truncate(text);
  return actor ? `${actor}: ${trimmed}` : trimmed;
}

function pickText(payload) {
  const candidates = [payload.text, payload.body, payload.message, payload.title, payload.label];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

function pickActor(event, payload) {
  const candidates = [payload.actor, payload.author, payload.from, payload.sender, event.actor];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

function truncate(s) {
  return s.length > MAX_SUBTITLE_LEN ? `${s.slice(0, MAX_SUBTITLE_LEN - 1).trimEnd()}…` : s;
}

/**
 * Convenience: bump a seenAt map entry to `now` (or Date.now()).  Pure;
 * returns a new object so the caller can re-render off a fresh
 * reference.  Host persists the result (localStorage / AsyncStorage).
 */
export function bumpSeenAt(seenAt, circleId, now = Date.now()) {
  if (!circleId) return seenAt || {};
  return { ...(seenAt || {}), [circleId]: now };
}
