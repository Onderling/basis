/**
 * Calendar write-side — Tasks.
 *
 * Builds an `.ics` string for a member of a circle that calendar
 * applications (Google Calendar, Apple Calendar, Proton, …) can
 * subscribe to. One VEVENT per task that has either:
 *   - `dueAt`         → all-day or timed event at the deadline
 *   - `scheduledAt`   → timed event when the planner accepted a slot
 *                       (hooks this in; emits dueAt-only)
 *
 * Wire convention:
 *   - `UID = task.id` so calendar clients update existing events
 *     when the .ics is re-imported.
 *   - `SUMMARY = task.text` (truncated to 80 chars for the title).
 *   - `DESCRIPTION = task.notes ?? ''` — notes if present.
 *   - `DTSTART = dueAt` (UTC).
 *   - `DTEND   = dueAt + 30min` (placeholder duration; `estimateMinutes`
 *     widens it when present).
 *   - `STATUS:COMPLETED` for completed tasks (clients grey them out).
 *   - `LAST-MODIFIED = max(updatedAt, completedAt, addedAt)`.
 *
 * Removed-task cancellations are emitted via a parallel call to
 * `buildCancellationIcs(removedIds)` so calendar clients drop the UIDs.
 *
 * Pure function: no I/O. Composed by `wireCalendarEmission.js`, which
 * owns the debouncing + write-through to the local-store cache.
 */

import ICAL from 'ical.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/params';

// Parameter register (#36) — default event duration. A genuine user preference (agent-scoped, follows the
// user); kind:user. Declared for the census; not yet wired to a settable home.
const DEFAULT_DURATION_MIN = param({ key: 'calendarEmission.defaultDurationMin', scope: PARAM_SCOPE.AGENT, kind: PARAM_KIND.USER, default: 30 });

/**
 * @param {object} args
 * @param {string} args.circleId
 * @param {string} args.circleName
 * @param {string} args.member            — webid of the calendar's owner
 * @param {Array<object>} args.tasks      — all open + closed tasks (we
 *   filter inside this function so the caller doesn't have to know the
 *   "what counts as a calendar event" rule)
 * @param {number} [args.now=Date.now()]
 * @returns {string}                       iCal-formatted string
 */
export function buildIcsFor({ circleId, circleName, member, tasks, now = Date.now() }) {
  if (typeof circleId !== 'string' || !circleId) {
    throw new TypeError('buildIcsFor: circleId required');
  }
  if (!Array.isArray(tasks)) {
    throw new TypeError('buildIcsFor: tasks[] required');
  }

  const cal = new ICAL.Component(['vcalendar', [], []]);
  cal.updatePropertyWithValue('prodid', `-//Tasks V2//${circleId}//EN`);
  cal.updatePropertyWithValue('version', '2.0');
  cal.updatePropertyWithValue('method', 'PUBLISH');
  cal.updatePropertyWithValue('x-wr-calname', `Tasks: ${circleName ?? circleId}`);

  for (const t of tasks) {
    if (!_isCalendarRelevant(t, member)) continue;
    cal.addSubcomponent(_buildVevent(t, now));
  }

  return cal.toString();
}

/**
 * v0.7.11 — `buildIcsForEvents` — same lib (ical.js) + same wire
 * shape, but takes `calendar-event`-shape items (per
 * @onderling/item-types/CALENDAR_EVENT_SCHEMA) directly rather than
 * tasks.  Used by @onderling-app/calendar.
 *
 * @param {object} args
 * @param {Array<object>} args.events
 * @param {string}        [args.calendarName='Calendar']
 * @param {string}        [args.prodId='-//onderling-app/calendar//EN']
 * @param {number}        [args.now=Date.now()]
 * @returns {string}
 */
export function buildIcsForEvents({
  events,
  calendarName = 'Calendar',
  prodId       = '-//onderling-app/calendar//EN',
  now          = Date.now(),
} = {}) {
  if (!Array.isArray(events)) {
    throw new TypeError('buildIcsForEvents: events[] required');
  }
  const cal = new ICAL.Component(['vcalendar', [], []]);
  cal.updatePropertyWithValue('prodid', prodId);
  cal.updatePropertyWithValue('version', '2.0');
  cal.updatePropertyWithValue('method', 'PUBLISH');
  cal.updatePropertyWithValue('x-wr-calname', calendarName);

  for (const e of events) {
    if (!e || typeof e.id !== 'string' || typeof e.startsAt !== 'string') continue;
    cal.addSubcomponent(_buildEventVevent(e, now));
  }
  return cal.toString();
}

function _buildEventVevent(e, now) {
  const ve = new ICAL.Component('vevent');
  ve.updatePropertyWithValue('uid', e.id);
  ve.updatePropertyWithValue('summary', String(e.title ?? e.id).slice(0, 80));
  ve.updatePropertyWithValue('description', e.body ?? '');
  if (e.location) ve.updatePropertyWithValue('location', e.location);
  ve.updatePropertyWithValue('dtstart', ICAL.Time.fromString(_toIcalDateTime(e.startsAt)));
  const end = e.endsAt
    ? _toIcalDateTime(e.endsAt)
    : _toIcalDateTime(new Date(new Date(e.startsAt).getTime() + 3_600_000).toISOString());
  ve.updatePropertyWithValue('dtend', ICAL.Time.fromString(end));
  ve.updatePropertyWithValue('dtstamp', ICAL.Time.fromString(_toIcalDateTime(new Date(now).toISOString())));
  if (e.state === 'cancelled') ve.updatePropertyWithValue('status', 'CANCELLED');
  if (e.organiser) ve.updatePropertyWithValue('organizer', `mailto:${e.organiser}`);
  const rsvp = e.rsvp ?? {};
  for (const webid of (e.attendees ?? [])) {
    const p = ve.addPropertyWithValue('attendee', `mailto:${webid}`);
    p.setParameter('partstat',
        rsvp[webid] === 'accepted'  ? 'ACCEPTED'
      : rsvp[webid] === 'declined'  ? 'DECLINED'
      : rsvp[webid] === 'tentative' ? 'TENTATIVE'
      : 'NEEDS-ACTION');
  }
  return ve;
}

function _toIcalDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
    + `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}

/**
 * Build a `METHOD:CANCEL` calendar containing only `UID`s — calendar
 * clients drop those events.
 *
 * @param {Array<{id: string}>} removed
 * @param {object} [args]
 * @param {string} [args.circleId='unknown']
 * @returns {string}
 */
export function buildCancellationIcs(removed, { circleId = 'unknown' } = {}) {
  if (!Array.isArray(removed) || removed.length === 0) return '';
  const cal = new ICAL.Component(['vcalendar', [], []]);
  cal.updatePropertyWithValue('prodid', `-//Tasks V2//${circleId}//EN`);
  cal.updatePropertyWithValue('version', '2.0');
  cal.updatePropertyWithValue('method', 'CANCEL');
  for (const r of removed) {
    if (typeof r?.id !== 'string') continue;
    const ev = new ICAL.Component('vevent');
    ev.updatePropertyWithValue('uid',     r.id);
    ev.updatePropertyWithValue('status',  'CANCELLED');
    ev.updatePropertyWithValue('summary', '(removed)');
    ev.updatePropertyWithValue('dtstart', ICAL.Time.fromJSDate(new Date(0), true));
    cal.addSubcomponent(ev);
  }
  return cal.toString();
}

/**
 * Compare two task lists and return the UIDs that disappeared. Used
 * by the wire helper to emit cancellations.
 */
export function diffRemoved(prev, next) {
  if (!Array.isArray(prev) || prev.length === 0) return [];
  const nextIds = new Set((next ?? []).map((t) => t?.id));
  return prev.filter((t) => t?.id && !nextIds.has(t.id)).map((t) => ({ id: t.id }));
}

// ── Internals ────────────────────────────────────────────────────────────────

function _isCalendarRelevant(t, member) {
  if (!t || typeof t !== 'object') return false;
  // No inbox item goes on a calendar — it is a decision waiting on a person, not an appointment.
  // This used to name one kind (`subtask-request`) as a bare type, which stopped matching when the
  // negotiation moved to `{type: 'inbox-item', kind}`; the noun is the right level to exclude at,
  // and it needs nothing from the type package.
  if (t.type === 'inbox-item') return false;
  if (typeof t.dueAt !== 'number' && typeof t.scheduledAt !== 'number') return false;
  // Only emit for tasks the member is involved with: assigned, mastered,
  // OR awaiting their approval. Other tasks would create noise in their
  // calendar.
  if (typeof member !== 'string' || !member) return true;     // unfiltered
  const masterOf  = (t.master ?? t.addedBy) === member;
  const assignedTo = t.assignee === member;
  const approverOf = t.approval === 'creator' && (t.master ?? t.addedBy) === member;
  return masterOf || assignedTo || approverOf;
}

function _buildVevent(t, now) {
  const ev = new ICAL.Component('vevent');
  ev.updatePropertyWithValue('uid', t.id);

  const title = String(t.text ?? '(no title)').slice(0, 80);
  ev.updatePropertyWithValue('summary', title);
  if (t.notes) ev.updatePropertyWithValue('description', String(t.notes));

  const startMs = t.scheduledAt ?? t.dueAt;
  const endMs   = startMs + ((t.estimateMinutes ?? DEFAULT_DURATION_MIN) * 60 * 1000);
  ev.updatePropertyWithValue('dtstart', ICAL.Time.fromJSDate(new Date(startMs), true));
  ev.updatePropertyWithValue('dtend',   ICAL.Time.fromJSDate(new Date(endMs),   true));

  const lastMod = Math.max(t.updatedAt ?? 0, t.completedAt ?? 0, t.addedAt ?? 0, 0) || now;
  ev.updatePropertyWithValue('last-modified', ICAL.Time.fromJSDate(new Date(lastMod), true));
  ev.updatePropertyWithValue('dtstamp',       ICAL.Time.fromJSDate(new Date(now), true));

  if (t.completedAt) ev.updatePropertyWithValue('status', 'COMPLETED');
  else               ev.updatePropertyWithValue('status', 'CONFIRMED');

  return ev;
}
