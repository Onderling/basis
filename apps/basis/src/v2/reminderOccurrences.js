/**
 * reminderOccurrences — reminders as DERIVED occurrences: item × the rules that apply × each person it is for → one
 * occurrence each. Nothing is stored; a moved appointment moves its reminders, a cancelled one has none. An
 * occurrence's id is `<item>:<rule>:<day>:<person>`: two people's reminders of one appointment, and two reminders of
 * one person, never share a mark.
 *
 * The rules are the dictionary's closed vocabulary (`morning` · `evening-before` · `before:<min>` · `at:<HH:MM>`),
 * anchored on the type's moment (an appointment's start, a chore's due). Which rules apply to whom is the caller's
 * `rulesFor(item, personId)` — the layers; a rule given as a bare string is the HOUSEHOLD's. Two things differ by
 * layer, and only these: the household's `evening-before` is for an appointment early the next morning (before
 * `assistant.eveningBeforeUntil`), never a chore — a person's or an item's own is unconditional; and a chore due on a
 * DAY (no time) takes `morning` and `evening-before` only — it has no time to be before.
 *
 * Today's rhythm is `householdRules(lead)`: the morning, the evening before (early appointments), and `before:<lead>`.
 */
import { wallClockInTz, utcInstantForWallClock } from '@onderling/notifier';
import { parseReminderRule } from '@onderling/item-types';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** The evening before is only for an appointment starting before this, the next morning (an earlier one than the 08:00 message). */
export const EVENING_BEFORE_UNTIL = param({ key: 'assistant.eveningBeforeUntil', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: '10:00' });

/** The two moments of a day, on the household's clock. */
export const REMINDER_MOMENTS = Object.freeze({ morning: '08:00', evening: '19:00' });
/**
 * Who an appointment reminds. The household's agenda is SHARED (Frits 2026-10-06, a member's feedback: "gezamenlijke
 * afspraken … dat iedereen er een melding van krijgt"): everyone in it — unless the appointment NAMES people
 * (`attendees`), then those, its maker, and whoever said they come. Never someone who said they do not.
 * @param {{createdBy?: string, attendees?: string[], rsvp?: Record<string, string>}} e
 * @param {Array<{id: string}>} people
 * @returns {string[]}
 */
export function remindedFor(e, people = []) {
  const rsvp = e?.rsvp ?? {};
  const named = Array.isArray(e?.attendees) ? e.attendees.filter((a) => typeof a === 'string' && a) : [];
  const coming = Object.entries(rsvp).filter(([, r]) => r === 'accepted' || r === 'tentative').map(([who]) => who);
  const base = named.length ? named : people.map((p) => p?.id).filter(Boolean);
  return [...new Set([...base, e?.createdBy, ...coming].filter(Boolean))].filter((who) => rsvp[who] !== 'declined');
}


const DAY = 86_400_000;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (w) => `${w.year}-${pad(w.month)}-${pad(w.day)}`;
const hhmm = (w) => `${pad(w.hour)}:${pad(w.minute)}`;
const ms = (v) => (v == null ? NaN : new Date(v).getTime());

/** The household layer's default rules: today's rhythm, with the household's lead (0 = no short notice). */
export function householdRules(lead = 0) {
  const n = Math.max(0, Math.floor(Number(lead) || 0));
  return ['morning', 'evening-before', ...(n > 0 ? [`before:${n}`] : [])];
}

/** The layers, far to near. */
export const REMINDER_LAYERS = Object.freeze({ household: 'household', person: 'person', item: 'item', 'person-item': 'person-item' });
const MODES = new Set(['replace', 'add']);

/**
 * The rules that apply to one person for one item, from the four layers far to near: the household's, the person's
 * own default, the item's own (the household's statement about it), the person's own for that item. Each layer
 * `{ mode: 'replace'|'add', rules }` replaces what came before or adds to it; a rule two layers share is named by the
 * nearer one (which decides, e.g., whether `evening-before` carries the household's early-morning condition).
 * @param {{household?: string[], personDefault?: object|null, item?: object|null, personItem?: object|null}} layers
 * @returns {Array<{rule: string, layer: string}>}
 */
export function layeredRules({ household = [], personDefault = null, item = null, personItem = null } = {}) {
  let list = new Map();
  const put = (rules, layer) => { for (const r of rules ?? []) if (parseReminderRule(r)) { list.delete(r); list.set(r, layer); } };
  put(household, 'household');
  for (const [layer, l] of [['person', personDefault], ['item', item], ['person-item', personItem]]) {
    if (!l || !MODES.has(l.mode) || !Array.isArray(l.rules)) continue;
    if (l.mode === 'replace') list = new Map();
    put(l.rules, layer);
  }
  // keep the household's order for what it named; what a nearer layer added comes after
  const order = (household ?? []).filter((r) => list.has(r));
  const rest = [...list.keys()].filter((r) => !order.includes(r));
  return [...order, ...rest].map((rule) => ({ rule, layer: list.get(rule) }));
}

/** A local wall-clock time on a local day, as an instant. */
const atLocal = (day, time, tz) => { const [hour, minute] = time.split(':').map(Number); return utcInstantForWallClock({ ...day, hour, minute, tz }); };
const dayOf = (w) => ({ year: w.year, month: w.month, day: w.day });
const shiftDay = (day, n) => { const d = new Date(Date.UTC(day.year, day.month - 1, day.day) + n * DAY); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }; };

/**
 * One rule on one item: its moment, how long it may still be said, and the day its id names — or null when the rule
 * does not apply to this item.
 */
function momentOf(parsed, layer, item, tz, eveningBeforeUntil) {
  const anchor = item.anchor;
  const aw = wallClockInTz(anchor, tz);
  const day = dayOf(aw);
  // a day without a time — a chore due on a day, an all-day appointment — is local midnight: the morning is its moment
  const dayOnly = aw.hour === 0 && aw.minute === 0;
  const endOfDay = atLocal(shiftDay(day, 1), '00:00', tz);
  const made = ms(item.createdAt);
  switch (parsed.kind) {
    case 'morning': {
      const at = atLocal(day, REMINDER_MOMENTS.morning, tz);
      if (item.kind === 'event' && !dayOnly) {
        // one made after the morning's moment is not that morning's news (its reminder is shortly before)
        if (Number.isFinite(made) && made >= at) return null;
        return { at, windowEnd: anchor, day: ymd(aw), slot: `${ymd(aw)}:morning` };
      }
      return { at, windowEnd: endOfDay, day: ymd(aw), slot: `${ymd(aw)}:morning` };
    }
    case 'evening-before': {
      // the household's is for an appointment early the next morning — not a chore, not a whole day (its morning says it)
      if (layer === 'household' && (item.kind !== 'event' || dayOnly || hhmm(aw) >= eveningBeforeUntil)) return null;
      const eve = shiftDay(day, -1);
      const at = atLocal(eve, REMINDER_MOMENTS.evening, tz);
      return { at, windowEnd: Math.min(anchor, atLocal(day, '00:00', tz)), day: ymd(eve), slot: `${ymd(eve)}:evening` };
    }
    case 'before': {
      if (dayOnly) return null;
      const lead = parsed.minutes * 60_000;
      // made less than the lead before its time: they just made it, nothing to remind them of yet
      if (Number.isFinite(made) && anchor - made < lead) return null;
      return { at: anchor - lead, windowEnd: anchor, day: ymd(aw), slot: `${ymd(aw)}:soon`, soon: true };
    }
    case 'at': {
      if (dayOnly) return null;
      const at = atLocal(day, parsed.time, tz);
      if (at >= anchor) return null;
      return { at, windowEnd: anchor, day: ymd(aw), slot: `${ymd(aw)}:at-${parsed.time.replace(':', '')}` };
    }
    default: return null;
  }
}

/**
 * @param {object} a
 * @param {object[]} [a.chores]   tasks with a `dueAt`
 * @param {object[]} [a.events]   appointments with a `startsAt`
 * @param {Array<{id: string}>} [a.people]  the household (an appointment that names no one is for everyone)
 * @param {number} a.now
 * @param {string} a.tz
 * @param {(item: object, personId: string) => Array<string|{rule: string, layer: string}>} [a.rulesFor]  the layers' answer
 * @param {number} [a.horizon]   how far ahead to list (planned); 0 = only what is due now
 * @param {string} [a.eveningBeforeUntil]
 */
export function reminderOccurrences({ chores = [], events = [], people = [], now, tz, rulesFor = () => householdRules(0), horizon = 0, eveningBeforeUntil = EVENING_BEFORE_UNTIL } = {}) {
  const items = [
    ...events.filter((e) => e && e.state !== 'cancelled' && !e.completedAt && Number.isFinite(ms(e.startsAt)))
      .map((e) => ({ id: e.id, kind: 'event', text: e.title ?? '', anchor: ms(e.startsAt), anchorIso: e.startsAt, createdAt: e.createdAt, to: remindedFor(e, people), source: e })),
    ...chores.filter((c) => c && !c.completedAt && Number.isFinite(ms(c.dueAt)))
      .map((c) => ({ id: c.id, kind: 'chore', text: c.text ?? c.title ?? '', anchor: ms(c.dueAt), anchorIso: c.dueAt, createdAt: c.createdAt, to: [...new Set([...(Array.isArray(c.assignees) ? c.assignees : []), c.assignee].filter(Boolean))], source: c })),
  ];
  const out = [];
  for (const item of items) {
    for (const personId of item.to) {
      for (const r of rulesFor(item.source, personId) ?? []) {
        const rule = typeof r === 'string' ? r : r?.rule;
        const layer = typeof r === 'string' ? 'household' : (r?.layer ?? 'household');
        const parsed = parseReminderRule(rule);
        if (!parsed) continue;
        const m = momentOf(parsed, layer, item, tz, eveningBeforeUntil);
        if (!m) continue;
        const state = m.at > now ? 'planned' : (now < m.windowEnd ? 'due' : 'skipped');
        if (state === 'skipped' || (state === 'planned' && m.at > now + horizon)) continue;
        out.push({
          id: `${item.id}:${parsed.rule}:${m.day}:${personId}`, itemId: item.id, kind: item.kind, rule: parsed.rule, layer,
          at: m.at, windowEnd: m.windowEnd, state, personId, text: item.text, anchor: item.anchorIso, slot: m.slot, ...(m.soon ? { soon: true } : {}),
        });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}
