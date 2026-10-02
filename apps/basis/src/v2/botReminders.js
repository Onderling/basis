/**
 * botReminders — what a household bot must say NOW, as a projection.
 *
 * A reminder is not a stored job. "What must be said now" is a pure read over the items (an appointment's `startsAt`, a
 * chore's `dueAt`), the people and what was already said: a cancelled or moved appointment needs no cancel bookkeeping,
 * a restart loses nothing, and a box that was off says a thing once or not at all. One timer asks this every few
 * minutes (the box's tick); nothing else holds reminder state but `said`.
 *
 * Only things a person put a date on, and only for the people they concern:
 *   - an appointment tomorrow → the evening before (19:00), to the one who added it and to everyone who comes or
 *     comes maybe;
 *   - a chore due today → the morning of that day (08:00), to the one(s) who hold it;
 *   - an appointment soon → `lead` minutes before it starts (the household's `assistant.reminderLeadMin`, 0 = off), to
 *     the same people as the evening one — unless it was made less than the lead before its start (they just made it).
 * Nothing in quiet hours (the morning opens when they end). An observer, a revoked person, and one who switched
 * reminders off get none. Everything due for one person at one moment is ONE entry (one message).
 */
import { wallClockInTz, utcInstantForWallClock } from '@onderling/notifier';

/** The two moments of a day, on the household's clock. */
export const REMINDER_MOMENTS = Object.freeze({ morning: '08:00', evening: '19:00' });
/**
 * What the bot's model is told about its reminders — exactly what the tick does, so it neither denies them ("I cannot
 * set reminders") nor invents others ("an hour before and five minutes before", seen on the real bot 2026-10-02).
 * LLM-facing; the moments are the tick's own constants.
 */
export function reminderPromptLines() {
  return [
    `REMINDERS — you (this bot) send them yourself, and only these: an appointment is reminded the evening before at ${REMINDER_MOMENTS.evening} and again shortly before it starts (the household's lead time, set by the admin in /huishouden; not when it was made just before), to whoever added it and whoever comes; a chore due today is reminded that morning at ${REMINDER_MOMENTS.morning}, to whoever holds it; a Sunday overview at 18:00 for whoever switched it on (/overzicht aan). You send nothing in the household's quiet hours (the admin's /huishouden shows them). Asked whether you send reminders: say yes, and when.`,
    'Each person switches their own reminders on or off (the assistant-reminders tool; /herinneringen aan | uit). You cannot remind at a time a person chooses: say so plainly, never promise one, and offer an appointment (reminded the evening before and shortly before) instead.',
  ];
}

/** Quiet hours, on the household's clock: nothing is said inside them. */
export const QUIET_HOURS = '21:00-08:00';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (w) => `${w.year}-${pad(w.month)}-${pad(w.day)}`;
const minutesOf = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };

/** Is this wall-clock time inside the quiet hours ("21:00-08:00" wraps midnight)? */
export function inQuiet(w, quiet) {
  const [from, to] = String(quiet || '').split('-');
  if (!from || !to) return false;
  const now = w.hour * 60 + w.minute;
  const a = minutesOf(from);
  const b = minutesOf(to);
  return a <= b ? now >= a && now < b : now >= a || now < b;
}

/**
 * @param {object} a
 * @param {Array<{id:string, text?:string, dueAt?:string, completedAt?:any, assignees?:string[], assignee?:string}>} [a.chores]
 * @param {Array<{id:string, title?:string, startsAt?:string, createdBy?:string, rsvp?:object, state?:string, completedAt?:any}>} [a.events]
 * @param {Array<{id:string, role?:string, revoked?:boolean, remindersOff?:boolean}>} [a.people]
 * @param {Record<string, Record<string, string>>} [a.said]  per person: item id → the slot it was said for
 * @param {number} [a.now]
 * @param {string} a.tz  the household's zone
 * @param {string} [a.quiet]
 * @param {number} [a.lead]  minutes before an appointment for the short-notice reminder; 0 (the default here) = none
 * @returns {Array<{personId: string, slot: string, items: Array<{id:string, kind:'chore'|'event', text:string, at:string, slot:string}>}>}
 */
export function dueReminders({ chores = [], events = [], people = [], said = {}, now = Date.now(), tz, quiet = QUIET_HOURS, lead = 0 } = {}) {
  const w = wallClockInTz(now, tz);
  if (inQuiet(w, quiet)) return [];
  const today = ymd(w);
  const atToday = (hhmm) => { const [hour, minute] = hhmm.split(':').map(Number); return utcInstantForWallClock({ year: w.year, month: w.month, day: w.day, hour, minute, tz }); };
  const tomorrow = ymd(wallClockInTz(atToday('12:00') + 86_400_000, tz));
  const eveningOpen = now >= atToday(REMINDER_MOMENTS.evening);
  const morningOpen = now >= atToday(REMINDER_MOMENTS.morning);
  const slotNow = `${today}:${eveningOpen ? 'evening' : 'morning'}`;

  const byId = new Map(people.map((p) => [p.id, p]));
  const reachable = (id) => { const p = byId.get(id); return Boolean(p && !p.revoked && !p.remindersOff && p.role !== 'observer'); };
  const out = new Map();   // personId → items
  const add = (personId, item) => {
    if (!reachable(personId)) return;
    if (said?.[personId]?.[item.id] === item.slot) return;
    const list = out.get(personId) ?? [];
    if (!list.some((i) => i.id === item.id)) list.push(item);
    out.set(personId, list);
  };

  if (eveningOpen) {
    for (const e of events) {
      if (!e || e.state === 'cancelled' || e.completedAt || !e.startsAt) continue;
      const start = new Date(e.startsAt).getTime();
      if (!(start > now) || ymd(wallClockInTz(start, tz)) !== tomorrow) continue;
      const item = { id: e.id, kind: 'event', text: e.title ?? '', at: e.startsAt, slot: `${today}:evening` };
      const coming = Object.entries(e.rsvp ?? {}).filter(([, r]) => r === 'accepted' || r === 'tentative').map(([who]) => who);
      for (const who of new Set([e.createdBy, ...coming].filter(Boolean))) add(who, item);
    }
  }
  // shortly before: due from `start − lead` until the start, once per appointment and day (`<date>:soon`)
  const leadMs = Math.max(0, Number(lead) || 0) * 60_000;
  if (leadMs > 0) {
    for (const e of events) {
      if (!e || e.state === 'cancelled' || e.completedAt || !e.startsAt) continue;
      const start = new Date(e.startsAt).getTime();
      if (!(now >= start - leadMs && now < start)) continue;
      const made = e.createdAt ? new Date(e.createdAt).getTime() : null;
      if (made != null && start - made < leadMs) continue;   // they just made it: nothing to remind them of yet
      const item = { id: e.id, kind: 'event', text: e.title ?? '', at: e.startsAt, slot: `${ymd(wallClockInTz(start, tz))}:soon`, soon: true };
      const coming = Object.entries(e.rsvp ?? {}).filter(([, r]) => r === 'accepted' || r === 'tentative').map(([who]) => who);
      for (const who of new Set([e.createdBy, ...coming].filter(Boolean))) add(who, item);
    }
  }
  if (morningOpen) {
    for (const c of chores) {
      if (!c || c.completedAt || !c.dueAt) continue;
      if (ymd(wallClockInTz(new Date(c.dueAt).getTime(), tz)) !== today) continue;
      const item = { id: c.id, kind: 'chore', text: c.text ?? c.title ?? '', at: c.dueAt, slot: `${today}:morning` };
      const holders = [...(Array.isArray(c.assignees) ? c.assignees : []), c.assignee].filter(Boolean);
      for (const who of new Set(holders)) add(who, item);
    }
  }
  return [...out].map(([personId, items]) => ({ personId, slot: slotNow, items }));
}
