/**
 * botReminders — what a household bot must say NOW: the reminder occurrences that are due (`reminderOccurrences`, the
 * engine: item × the rules that apply × each person), grouped per person into ONE message.
 *
 * A reminder is not a stored job: a cancelled or moved appointment needs no bookkeeping, a restart loses nothing, a box
 * that was off says a thing once or not at all. What was said is a done-mark per occurrence on the device log (the
 * thread rows' older `said` slots are still read until those items are done). Without layers, the rules are the
 * household's rhythm: the morning (everything of the day), the evening before (an appointment early the next morning),
 * and `lead` minutes before anything with a time. Nothing in a person's quiet hours (theirs, else the household's); an
 * observer, a revoked person and one who switched reminders off get none. Several of one item's rules due at once are
 * one line, the nearest kind of notice.
 */
import { wallClockInTz } from '@onderling/notifier';
import { parseReminderRule } from '@onderling/item-types';
import { reminderOccurrences, householdRules, EVENING_BEFORE_UNTIL, REMINDER_MOMENTS, remindedFor } from './reminderOccurrences.js';
import { HOUSEHOLD_RULES_DEFAULT } from './botSettings.js';

// The moments and who an appointment is for are the engine's; read here, and by the bot's older readers, from it.
export { EVENING_BEFORE_UNTIL, REMINDER_MOMENTS, remindedFor };

/**
 * What the bot's model is told about its reminders — exactly what the tick does, so it neither denies them ("I cannot
 * set reminders") nor invents others ("an hour before and five minutes before", seen on the real bot 2026-10-02).
 * LLM-facing; the moments are the tick's own constants.
 */
export function reminderPromptLines() {
  return [
    `REMINDERS — you (this bot) send them yourself, and only these: everything of the day — chores due today AND today's appointments — is said that morning at ${REMINDER_MOMENTS.morning}; an appointment early the next morning (before ${EVENING_BEFORE_UNTIL}) is also reminded the evening before at ${REMINDER_MOMENTS.evening}; anything with a time is reminded again shortly before it starts (the household's lead time, set by the admin in /huishouden; not when it was made just before), an appointment goes to everyone in the household unless it names people (then those, its maker and who comes); a chore to whoever holds it; a Sunday overview at 18:00 for whoever switched it on (/overzicht aan). You send nothing in a person's quiet hours: their own (/stil 23:00-08:00) or else the household's (the admin's /huishouden shows them). Asked whether you send reminders: say yes, and when.`,
    'Each person sets their own reminders (the assistant-reminders tool; /herinneringen): on or off, or WHEN for everything — rules in words: "60" (minutes before), "ochtend" (the morning), "avond" (the evening before), "7:30" (a time on its day), "ook …" to add to the usual ones instead of replacing them, "huis" to follow the household again. For ONE appointment or chore, their own: the remindMe tool (item = words of its title, rules in the same words). For everyone an item is for: the reminders argument of addEvent or editEntry. For EVERYONE in the household at a time, with words of their own ("herinner iedereen om 19:45: eten"): remindMe with who: everyone, item = what to say, rules = the time ("19:45", "over 10 minuten"). Only those kinds exist — never promise another (no "every hour", nothing that repeats); say plainly what you set.',
    'When an appointment is made, moved or cancelled, or a chore is given to someone, you tell the others it concerns yourself, at once (never the one who did it; in their quiet hours it waits for their next message) — so do not promise to pass it on, and do not say they will not hear of it.',
  ];
}

/**
 * When the bot reminds, in ONE line for a person (the welcome and `/help` say the same): the household's rules as they
 * stand, each with the moment the tick really uses — the morning moment (everything of that day), the evening before
 * (only an appointment before `EVENING_BEFORE_UNTIL` the next morning), the minutes before anything with a time, a fixed
 * time on the day — and that `/herinneringen` changes it for them. Read from the rules and the tick's constants, never
 * typed beside them.
 * @param {{rules?: string[], t: (key: string, vars?: object) => string}} a
 * @returns {string}
 */
export function reminderRuleLine({ rules = HOUSEHOLD_RULES_DEFAULT, t }) {
  const parts = [];
  for (const r of rules ?? []) {
    const p = parseReminderRule(r);
    if (!p) continue;
    if (p.kind === 'morning') parts.push(t('circle.bot.reminder_rule_morning', { time: REMINDER_MOMENTS.morning }));
    else if (p.kind === 'evening-before') parts.push(t('circle.bot.reminder_rule_evening', { time: REMINDER_MOMENTS.evening, until: EVENING_BEFORE_UNTIL }));
    else if (p.kind === 'before') parts.push(t('circle.bot.reminder_rule_before', { n: p.minutes }));
    else if (p.kind === 'at') parts.push(t('circle.bot.reminder_rule_at', { time: p.time }));
  }
  return parts.length ? t('circle.bot.reminder_rule', { rules: parts.join(', ') }) : t('circle.bot.reminder_rule_none');
}

/** Quiet hours, on the household's clock: nothing is said inside them. */
export const QUIET_HOURS = '21:00-08:00';

const minutesOf = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };

/**
 * What was said of one item to one person: every slot it was said for (a list), or one slot (as the thread rows kept it
 * before). One slot per item was the bug: the morning message and the short notice for the same appointment each
 * overwrote the other's mark, and the two went out in turn every minute until it started (live 2026-10-07).
 */
export const saidSlots = (v) => (Array.isArray(v) ? v : (typeof v === 'string' && v ? [v] : []));

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
 * @param {Array<{id:string, role?:string, revoked?:boolean, remindersOff?:boolean, quiet?:string|null}>} [a.people]  `quiet`: the person's own quiet hours (else the household's)
 * @param {Record<string, Record<string, string|string[]>>} [a.said]  per person: item id → the slots it was said for
 * @param {number} [a.now]
 * @param {string} a.tz  the household's zone
 * @param {string} [a.quiet]
 * @param {number} [a.lead]  minutes before an appointment for the short-notice reminder; 0 (the default here) = none
 * @param {Set<string>} [a.done]  occurrence ids already said (the done-marks on the device log)
 * @param {(item: object, personId: string) => Array<string|{rule: string, layer: string}>|null} [a.rulesFor]  the layers; absent = the household's rhythm
 * @returns {Array<{personId: string, slot: string, items: Array<{id:string, kind:'chore'|'event', text:string, at:string, slot:string}>}>}
 */
export function dueReminders({ chores = [], events = [], people = [], said = {}, done = new Set(), now = Date.now(), tz, quiet = QUIET_HOURS, lead = 0, rulesFor = null } = {}) {
  const w = wallClockInTz(now, tz);
  const eveningOpen = w.hour * 60 + w.minute >= Number(REMINDER_MOMENTS.evening.slice(0, 2)) * 60 + Number(REMINDER_MOMENTS.evening.slice(3));
  const slotNow = `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}:${eveningOpen ? 'evening' : 'morning'}`;
  const byId = new Map(people.map((p) => [p.id, p]));
  // quiet hours are each recipient's: their own (`/stil`), else the household's — one person's quiet holds back no one else
  const reachable = (id) => { const p = byId.get(id); return Boolean(p && !p.revoked && !p.remindersOff && p.role !== 'observer' && !inQuiet(w, p.quiet || quiet)); };
  const occurrences = reminderOccurrences({ chores, events, people, now, tz, rulesFor: rulesFor ?? (() => householdRules(lead)) });
  // several of one item's rules due at once for one person are ONE line — the nearest kind of notice wins — and all of
  // them are marked as said, so none comes back on the next pass
  const RANK = { before: 0, at: 1, 'evening-before': 2, morning: 3 };
  const rankOf = (o) => RANK[o.rule.split(':')[0]] ?? 9;
  const out = new Map();   // personId → Map(itemId → item)
  for (const o of [...occurrences].sort((a, b) => rankOf(a) - rankOf(b))) {
    if (o.state !== 'due' || !reachable(o.personId)) continue;
    // said before: a done-mark under the occurrence's id, or (thread rows written before the marks) the item's slot
    if (done.has(o.id) || saidSlots(said?.[o.personId]?.[o.itemId]).includes(o.slot)) continue;
    const mine = out.get(o.personId) ?? new Map();
    const have = mine.get(o.itemId);
    if (have) { have.occurrences.push(o.id); have.slots.push(o.slot); continue; }
    mine.set(o.itemId, { id: o.itemId, kind: o.kind, text: o.text, at: o.anchor, slot: o.slot, rule: o.rule, ...(o.soon ? { soon: true } : {}), occurrences: [o.id], slots: [o.slot] });
    out.set(o.personId, mine);
  }
  return [...out].map(([personId, items]) => ({ personId, slot: slotNow, items: [...items.values()] }));
}
