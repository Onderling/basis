/**
 * plannedForMe — Gepland in the app: what is coming for ME in the next days, wherever it lives. A LOCAL projection on
 * the person's own device (Frits 2026-10-07: the household bot is optional, so this is never the bot's answer):
 *   • the appointments of every circle I am in (`acrossCircles`, each circle's own list) and my own (no circle — my
 *     own store);
 *   • the chores I hold that carry a date (the task presenter's "mine", due inside the window — or overdue today).
 * In time order, each line saying where it comes from. One circle that does not answer empties nothing. It reads; it
 * stores nothing and asks no one. Reminders are not here: who reminds (a bot, a companion) is theirs to say.
 */
import { whenWords } from './whenWords.js';
import { acrossCircles } from './acrossCircles.js';
import { ITEM_MANIFESTS } from './userScreenBlocks.js';

const DAY = 86_400_000;
const ms = (v) => { const n = typeof v === 'number' ? v : Date.parse(v ?? ''); return Number.isFinite(n) ? n : NaN; };

/** The circles I am in, as `{id, name}` (the list answers ids or rows). */
export async function myCircles(callSkill) {
  const r = await callSkill('stoop', 'listMyCircles', {}).catch(() => null);
  return (r?.circles ?? []).map((c) => (typeof c === 'string' ? { id: c, name: '' } : { id: c?.groupId ?? c?.id, name: c?.name ?? c?.groupName ?? '' })).filter((c) => typeof c.id === 'string' && c.id);
}

/**
 * @param {object} a
 * @param {(app: string, op: string, args: object) => Promise<any>} a.callSkill   the shell's call (as the person)
 * @param {string|null} a.me   who "mine" means (the person's id as their chores name them)
 * @param {number} [a.horizonDays]
 * @param {number} [a.now]
 * @param {number} [a.limit]
 * @returns {Promise<{ok: true, items: Array<{kind: 'event'|'chore', id: string, title: string, when: number, circleId: string|null, circleName: string}>}>}
 */
export async function plannedForMe({ callSkill, me, horizonDays = 7, now = Date.now(), limit = 30 }) {
  const until = now + horizonDays * DAY;
  const startOfToday = (() => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const circles = await myCircles(callSkill);
  const items = [];

  const events = circles.length ? await acrossCircles({
    circles, noun: 'calendar-event', manifests: ITEM_MANIFESTS, scope: 'all', limit: 500,
    callSkill: (app, op, args) => callSkill(app, op, { ...args, days: horizonDays }),
  }) : { ok: true, items: [] };
  const own = await callSkill('calendar', 'listEvents', { days: horizonDays }).catch(() => null);
  for (const e of [...(events.ok ? events.items : []), ...(Array.isArray(own?.items) ? own.items.map((x) => ({ ...x, circleId: null, circleName: '' })) : [])]) {
    const when = ms(e.startsAt);
    if (!(when >= now && when <= until)) continue;
    items.push({ kind: 'event', id: String(e.id), title: String(e.title ?? e.text ?? e.label ?? ''), when, circleId: e.circleId ?? null, circleName: e.circleName ?? '' });
  }

  if (circles.length) {
    const chores = await acrossCircles({ circles, noun: 'task', manifests: ITEM_MANIFESTS, scope: 'mine', me, limit: 500, callSkill });
    for (const c of chores.ok ? chores.items : []) {
      const when = ms(c.dueAt);
      if (!(when >= startOfToday && when <= until) || c.completedAt) continue;
      items.push({ kind: 'chore', id: String(c.id), title: String(c.text ?? c.title ?? c.label ?? ''), when, circleId: c.circleId ?? null, circleName: c.circleName ?? '' });
    }
  }

  items.sort((a, b) => a.when - b.when || a.title.localeCompare(b.title));
  return { ok: true, items: items.slice(0, Math.max(0, limit)) };
}

/**
 * Gepland's lines in the person's words — built here once, painted by every shell: an appointment with its day and
 * time, a chore with its day (and time when it has one), and where it comes from when that is a circle.
 * @param {Array<{kind: string, title: string, when: number, circleName?: string}>} items
 * @param {{t: Function, tz?: string, lang?: string}} o
 */
export function plannedLines(items, { t, tz, lang = 'nl' }) {
  const locale = lang === 'en' ? 'en-GB' : 'nl-NL';
  return (items ?? []).map((i) => {
    // an appointment always with its time; a chore with its time when it has one
    const when = whenWords(i.when, { locale, tz, dayOnly: i.kind === 'event' ? false : 'auto' });
    const line = t(i.kind === 'chore' ? 'circle.profile.planned_chore' : 'circle.profile.planned_event', { when, title: i.title });
    return i.circleName ? `${line}${t('circle.profile.planned_where', { circle: i.circleName })}` : line;
  });
}
