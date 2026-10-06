/**
 * botReminderTick — the one timer a hosting box runs for reminders.
 *
 * Each pass: the household's switch (`assistant.reminders`) — off, nothing; the items and the people; the projection
 * (`dueReminders`) says what is due for whom; each person gets ONE message on their own door (`sendToPerson`), the
 * first they ever get ending with how to stop; what was said is a done-mark per occurrence on the device log (the
 * older slots on thread rows are still read, and dropped once their item is done or past). It runs once at start, then every few
 * minutes — as a job on the host's one clock (`hostTick`), which owns the timer. Only a box that hosts a bot composes it —
 * a person's node writes first to nobody.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';
import { wallClockInTz } from '@onderling/notifier';
import { dueReminders } from './botReminders.js';
import { doneMarksOn } from './intentionRunner.js';
import { EventLog } from '../eventLog.js';

/** How often the box asks what is due. Reminders are for the evening and the morning; minutes are close enough. */
// every minute: a reminder 5 minutes before an appointment lands 5–4 minutes before, not anywhere in the last five
export const REMINDER_TICK_MS = param({ key: 'assistant.reminderTickMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60_000 });

const pad = (n) => String(n).padStart(2, '0');

/**
 * @param {object} a
 * @param {() => Promise<{chores: object[], events: object[]}>} a.sources  the household circle's chores and appointments
 * @param {{list: () => Promise<object[]>}} a.users  the bot's people (contact rows: id, role, hidden)
 * @param {object} a.threads  the thread rows (`botThreads`)
 * @param {{sendToPerson: Function}} a.reach  `doorReach`
 * @param {(key: string, vars?: object) => string} a.t
 * @param {string} a.tz  the household's zone
 * @param {() => {reminders?: string, quiet?: string, lead?: number}} a.settings  the household's switch, quiet hours and the
 *   minutes before an appointment for the short-notice reminder
 * @param {() => number} [a.now]
 * @param {number} [a.every]  its period on the host's clock
 * @param {(e: {personId: string, items: number, ok: boolean, reason: string|null, at?: string, what?: Array<{kind: string, id: string, slot: string, rule?: string}>}) => void} [a.onSent]  each send, for the walk log
 * @param {{append: Function, query: Function}} [a.log]  the device log: what was said is a done-mark per occurrence there
 */
export function createReminderTick({ sources, users, threads, reach, t, tz, settings, now = Date.now, every = REMINDER_TICK_MS, onSent = null, log = null }) {
  let running = null;
  // what was said: a done-mark per occurrence on the device log (an in-memory one when none is handed in)
  const marks = doneMarksOn(log ?? new EventLog({ initial: [], muted: [] }), now);
  const timeOf = (iso) => { const w = wallClockInTz(new Date(iso).getTime(), tz); return `${pad(w.hour)}:${pad(w.minute)}`; };
  // in each person's own language when they fixed one (`/taal`), else the bot's
  const tFor = (personId) => { const lang = threads?.langOf?.(personId) ?? null; return lang ? (k, p) => t(k, p, lang) : t; };
  const lineOf = (item, tp = t) => (item.kind === 'event'
    ? tp(item.soon ? 'circle.bot.reminder_event_soon' : 'circle.bot.reminder_event', { title: item.text, time: timeOf(item.at) })
    : tp(item.soon ? 'circle.bot.reminder_chore_soon' : 'circle.bot.reminder_chore', { text: item.text, time: timeOf(item.at) }));

  async function passOnce() {
    const s = typeof settings === 'function' ? (settings() ?? {}) : {};
    const rows = (await users.list()) ?? [];
    const at = now();
    if (s.reminders === 'off') return { sent: 0 };
    const { chores = [], events = [] } = (await sources()) ?? {};
    const people = rows.map((r) => ({ id: r.id, role: r.role ?? null, revoked: Boolean(r.hidden), remindersOff: !threads.remindersOn(r.id), quiet: threads.quietOf?.(r.id) ?? null }));
    const said = Object.fromEntries(rows.map((r) => [r.id, threads.saidOf(r.id)]));
    const due = dueReminders({ chores, events, people, said, done: marks.ids(), now: at, tz, ...(s.quiet ? { quiet: s.quiet } : {}), ...(s.lead !== undefined ? { lead: s.lead } : {}) });
    let sent = 0;
    for (const { personId, items } of due) {
      const first = !threads.remindedOnce(personId);
      // a door that carries no buttons (the bot's inbox: a contact turn is text) says in words how to tick it off
      const chore = items.find((i) => i.kind === 'chore');
      const textOnly = rows.find((r) => r.id === personId)?.channel === 'web';
      const tp = tFor(personId);
      const text = [...items.map((i) => lineOf(i, tp)), ...(textOnly && chore ? [tp('circle.bot.reminder_done_words', { text: chore.text })] : []), ...(first ? [tp('circle.bot.reminder_first')] : [])].join('\n');
      const buttons = items.filter((i) => i.kind === 'chore').map((i) => ({ id: `completeTask:${i.id}`, label: tp('circle.bot.reminder_done') }));
      const r = await reach.sendToPerson(personId, { text, buttons });
      // when, which item, which kind: a reminder that did not come must be traceable from the log alone
      try { onSent?.({ personId, items: items.length, ok: Boolean(r?.ok), reason: r?.reason ?? null, at: new Date(now()).toISOString(), what: items.map((i) => ({ kind: i.kind, id: i.id, slot: i.slot, rule: i.rule })) }); } catch { /* a listener never stops the tick */ }
      if (!r?.ok) continue;
      sent += 1;
      // every occurrence it said, each its own mark: the morning and the short notice are two, and neither undoes the other
      for (const i of items) for (const id of i.occurrences ?? []) marks.mark(id, { item: i.id, rule: i.rule });
      if (first) threads.markReminded(personId);
    }
    // the thread rows' older slots for what is done or past are dropped: only what can still be due keeps one
    const open = new Set([
      ...chores.filter((c) => c && !c.completedAt).map((c) => c.id),
      ...events.filter((e) => e && e.state !== 'cancelled' && !e.completedAt && new Date(e.startsAt).getTime() > at).map((e) => e.id),
    ]);
    for (const r of rows) {
      const mine = threads.saidOf(r.id);
      const kept = Object.fromEntries(Object.entries(mine).filter(([id]) => open.has(id)));
      if (Object.keys(kept).length !== Object.keys(mine).length) threads.setSaid(r.id, kept);
    }
    return { sent };
  }

  return {
    /** One pass (never two at once). */
    pass() {
      running ??= passOnce().finally(() => { running = null; });
      return running;
    },
    /** Its period on the host's clock: never under a minute. */
    every: Math.max(60_000, Number(every) || REMINDER_TICK_MS),
  };
}
