/**
 * botReminderTick — the one timer a hosting box runs for reminders.
 *
 * Each pass: the household's switch (`assistant.reminders`) — off, nothing; the items and the people; the projection
 * (`dueReminders`) says what is due for whom; each person gets ONE message on their own door (`sendToPerson`), the
 * first they ever get ending with how to stop; what was said is marked on their thread row (the only reminder state),
 * and marks for things that are done or past are dropped in the same pass. It runs once at start, then every few
 * minutes. Only a box that hosts a bot composes it — a person's node writes first to nobody.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';
import { wallClockInTz } from '@onderling/notifier';
import { dueReminders } from './botReminders.js';

/** How often the box asks what is due. Reminders are for the evening and the morning; minutes are close enough. */
export const REMINDER_TICK_MS = param({ key: 'assistant.reminderTickMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 5 * 60_000 });

const pad = (n) => String(n).padStart(2, '0');

/**
 * @param {object} a
 * @param {() => Promise<{chores: object[], events: object[]}>} a.sources  the household circle's chores and appointments
 * @param {{list: () => Promise<object[]>}} a.users  the bot's people (contact rows: id, role, hidden)
 * @param {object} a.threads  the thread rows (`botThreads`)
 * @param {{sendToPerson: Function}} a.reach  `doorReach`
 * @param {(key: string, vars?: object) => string} a.t
 * @param {string} a.tz  the household's zone
 * @param {() => {reminders?: string, quiet?: string}} a.settings  the household's switch and quiet hours
 * @param {() => number} [a.now]
 * @param {number} [a.every]
 * @param {{setInterval: Function, clearInterval: Function}} [a.timers]
 */
export function createReminderTick({ sources, users, threads, reach, t, tz, settings, now = Date.now, every = REMINDER_TICK_MS, timers = globalThis }) {
  let handle = null;
  let running = null;
  const timeOf = (iso) => { const w = wallClockInTz(new Date(iso).getTime(), tz); return `${pad(w.hour)}:${pad(w.minute)}`; };
  const lineOf = (item) => (item.kind === 'event'
    ? t('circle.bot.reminder_event', { title: item.text, time: timeOf(item.at) })
    : t('circle.bot.reminder_chore', { text: item.text }));

  async function passOnce() {
    const s = typeof settings === 'function' ? (settings() ?? {}) : {};
    if (s.reminders === 'off') return { sent: 0 };
    const { chores = [], events = [] } = (await sources()) ?? {};
    const rows = (await users.list()) ?? [];
    const people = rows.map((r) => ({ id: r.id, role: r.role ?? null, revoked: Boolean(r.hidden), remindersOff: !threads.remindersOn(r.id) }));
    const said = Object.fromEntries(rows.map((r) => [r.id, threads.saidOf(r.id)]));
    const at = now();
    const due = dueReminders({ chores, events, people, said, now: at, tz, ...(s.quiet ? { quiet: s.quiet } : {}) });
    let sent = 0;
    for (const { personId, items } of due) {
      const first = !threads.remindedOnce(personId);
      const text = [...items.map(lineOf), ...(first ? [t('circle.bot.reminder_first')] : [])].join('\n');
      const buttons = items.filter((i) => i.kind === 'chore').map((i) => ({ id: `completeTask:${i.id}`, label: t('circle.bot.reminder_done') }));
      const r = await reach.sendToPerson(personId, { text, buttons });
      if (!r?.ok) continue;
      sent += 1;
      const mine = threads.saidOf(personId);
      for (const i of items) mine[i.id] = i.slot;
      threads.setSaid(personId, mine);
      if (first) threads.markReminded(personId);
    }
    // marks for what is done or past are dropped: only what can still be due keeps its mark
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
    /** Once now, then every `every` ms. */
    start() {
      if (handle) return;
      this.pass().catch(() => {});
      handle = timers.setInterval(() => { this.pass().catch(() => {}); }, Math.max(60_000, Number(every) || REMINDER_TICK_MS));
    },
    stop() { if (handle) timers.clearInterval(handle); handle = null; },
  };
}
