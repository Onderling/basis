/**
 * announcements — what a change tells OTHERS, at once: a pure read over the household before and after one op.
 *
 *   • a new appointment → everyone it is for (everyone, or the people it names — `remindedFor`);
 *   • an appointment cancelled → the people it was for; moved → the people it is for, with the new time;
 *   • a chore GIVEN to someone (a holder added) → them; a chore's due moved → its holders;
 *   • never the one who did it; an edit of words only, a finished chore, something already past → nobody.
 * Each has its own id, `announce:<item>:<kind>:<moment>:<person>` — one change is said once per person, and a second
 * move (a new moment) is a new announcement. Who is reachable now, and who hears it in the morning, is the sender's.
 */
import { wallClockInTz } from '@onderling/notifier';
import { remindedFor } from './reminderOccurrences.js';
import { doneMarksOn } from './intentionRunner.js';
import { inQuiet } from './botReminders.js';

const ms = (v) => (v == null ? NaN : new Date(v).getTime());
const holdersOf = (c) => [...new Set([...(Array.isArray(c?.assignees) ? c.assignees : []), c?.assignee].filter(Boolean))];
const live = (e) => e && e.state !== 'cancelled' && !e.completedAt;

/**
 * @param {object} a
 * @param {{events: object[], chores: object[]}} a.before
 * @param {{events: object[], chores: object[]}} a.after
 * @param {Array<{id: string}>} a.people
 * @param {string|null} a.maker   who did it (never told)
 * @param {number} a.now
 * @returns {Array<{id: string, personId: string, kind: 'new'|'moved'|'cancelled'|'given', itemId: string, itemKind: 'event'|'chore', text: string, at: string|null}>}
 */
export function announcementsFor({ before, after, people, maker = null, now }) {
  const out = [];
  const tell = (personIds, kind, item, itemKind, at) => {
    for (const personId of new Set(personIds)) {
      if (!personId || personId === maker) continue;
      out.push({ id: `announce:${item.id}:${kind}:${at ?? 'none'}:${personId}`, personId, kind, itemId: item.id, itemKind, text: itemKind === 'event' ? (item.title ?? '') : (item.text ?? item.title ?? ''), at: at ?? null });
    }
  };
  const beforeEvents = new Map((before.events ?? []).filter(Boolean).map((e) => [e.id, e]));
  for (const e of after.events ?? []) {
    if (!e?.id) continue;
    const was = beforeEvents.get(e.id);
    const ahead = ms(e.startsAt) > now;
    if (!was) { if (live(e) && ahead) tell(remindedFor(e, people), 'new', e, 'event', e.startsAt); continue; }
    if (live(was) && e.state === 'cancelled' && ms(was.startsAt) > now) { tell(remindedFor(was, people), 'cancelled', e, 'event', was.startsAt); continue; }
    if (live(was) && live(e) && ahead && ms(was.startsAt) !== ms(e.startsAt)) { tell(remindedFor(e, people), 'moved', e, 'event', e.startsAt); continue; }
    // the people changed: whoever it is newly for hears of it as new
    if (live(e) && ahead) {
      const had = new Set(remindedFor(was, people));
      tell(remindedFor(e, people).filter((p) => !had.has(p)), 'new', e, 'event', e.startsAt);
    }
  }
  const beforeChores = new Map((before.chores ?? []).filter(Boolean).map((c) => [c.id, c]));
  for (const c of after.chores ?? []) {
    if (!c?.id || c.completedAt) continue;
    const was = beforeChores.get(c.id);
    const had = new Set(was ? holdersOf(was) : []);
    tell(holdersOf(c).filter((p) => !had.has(p)), 'given', c, 'chore', c.dueAt ?? null);
    if (was && c.dueAt && ms(was.dueAt) !== ms(c.dueAt) && ms(c.dueAt) > now - 86_400_000) tell(holdersOf(c).filter((p) => had.has(p)), 'moved', c, 'chore', c.dueAt);
  }
  return out;
}

/**
 * One announcement in a person's words: what changed, which item, and when (the day and time on the household's
 * clock, in their language).
 */
export function announcementLine(a, tp, tz, lang = 'nl') {
  const at = a.at ? new Date(a.at) : null;
  const dayOnly = at && a.itemKind === 'chore' && (() => { const w = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at); return w === '00:00'; })();
  const when = at ? new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'nl-NL', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', ...(dayOnly ? {} : { hour: '2-digit', minute: '2-digit' }) }).format(at) : null;
  if (a.kind === 'given') return when ? tp('circle.bot.announce_given_when', { text: a.text, when }) : tp('circle.bot.announce_given', { text: a.text });
  return tp(`circle.bot.announce_${a.kind}`, { title: a.text, when: when ?? '' });
}

/**
 * The announcer: ONE change to an item (as the host's change feed hands it over — the host's own write or a member's
 * that landed) and what it tells others goes out at once to whoever can be reached now — one message each, in their
 * language — and is HELD on the thread row of anyone in their quiet hours (the reminder tick says it in their next
 * message). The one who made the change is the item's last writer. A done-mark per announcement keeps one change said
 * once; a person who switched the bot's messages off, an observer or a revoked person hears nothing. The household's
 * announce rows call it (`announceRows.js`), each for its kinds.
 * @param {object} a
 * @param {{list: () => Promise<object[]>}} a.users
 * @param {object} a.threads
 * @param {{sendToPerson: Function}} a.reach
 * @param {Function} a.t
 * @param {string} a.tz
 * @param {() => string} a.quiet   the household's quiet hours
 * @param {{append: Function, query: Function}} a.log
 * @param {() => number} [a.now]
 * @param {(e: object) => void} [a.onAnnounced]   for the walk log: who · when · item · kind
 */
export function createAnnouncer({ users, threads, reach, t, tz, quiet, log, now = Date.now, onAnnounced = null }) {
  const marks = doneMarksOn(log, now);
  const langOf = (id) => threads?.langOf?.(id) ?? null;
  const tFor = (id) => { const lang = langOf(id); return lang ? (k, p) => t(k, p, lang) : t; };
  const quietFor = (id) => threads?.quietOf?.(id) || quiet?.() || null;
  /** May this person be written to at all, and now? */
  // (a reminder a person set themselves is theirs whatever their switch for the bot's own reminders says: `own`)
  const standing = (row, own = false) => Boolean(row && !row.hidden && row.role !== 'observer' && (own || threads.remindersOn(row.id)));
  const quietNow = (id) => { const q = quietFor(id); return Boolean(q && inQuiet(wallClockInTz(now(), tz), q)); };
  const tell = (e) => { try { onAnnounced?.(e); } catch { /* the walk log never stops a change */ } };

  /** Say a list of announcements (one message per person, held through quiet hours); how many were sent, held, failed. */
  async function deliver(list, { own = false } = {}) {
    const out = { sent: 0, held: 0, failed: 0 };
    if (!list.length) return out;
    const rows = new Map(((await users.list()) ?? []).map((r) => [r.id, r]));
    const done = marks.ids();
    const byPerson = new Map();
    for (const a of list) { if (done.has(a.id)) continue; (byPerson.get(a.personId) ?? byPerson.set(a.personId, []).get(a.personId)).push(a); }
    for (const [personId, items] of byPerson) {
      if (!standing(rows.get(personId), own)) continue;
      if (quietNow(personId)) {
        const held = threads.heldAnnouncementsOf(personId);
        const ids = new Set(held.map((h) => h.id));
        threads.setHeldAnnouncements(personId, [...held, ...items.filter((i) => !ids.has(i.id))]);
        for (const a of items) tell({ personId, kind: a.kind, item: a.itemId, outcome: 'held' });
        out.held += 1;
        continue;
      }
      const tp = tFor(personId);
      const r = await reach.sendToPerson(personId, { text: items.map((a) => announcementLine(a, tp, tz, langOf(personId) ?? 'nl')).join('\n') });
      for (const a of items) tell({ personId, kind: a.kind, item: a.itemId, outcome: r?.ok ? 'sent' : 'failed', ...(r?.ok ? {} : { reason: r?.reason ?? null }) });
      if (r?.ok) for (const a of items) marks.mark(a.id, { item: a.itemId, kind: a.kind });
      out[r?.ok ? 'sent' : 'failed'] += 1;
    }
    return out;
  }

  return {
    /**
     * One change: tell others what it means for them — only the `kinds` asked for (all, when none are named).
     * @param {{circleId?: string, before: object|null, after: object|null}} change
     * @param {{kinds?: string[]|null}} [opts]
     */
    async forChange(change, { kinds = null } = {}) {
      const was = change?.before ?? null;
      const it = change?.after ?? null;
      const type = (it ?? was)?.type;
      const bucket = type === 'calendar-event' ? 'events' : (type === 'task' ? 'chores' : null);
      if (!bucket) return { ok: true, told: 0 };
      const side = (item) => ({ events: [], chores: [], ...(item ? { [bucket]: [item] } : {}) });
      const maker = it?.updatedBy ?? it?.createdBy ?? was?.updatedBy ?? null;
      const people = ((await users.list()) ?? []).map((r) => ({ id: r.id }));
      const list = announcementsFor({ before: side(was), after: side(it), people, maker, now: now() })
        .filter((a) => !Array.isArray(kinds) || kinds.includes(a.kind));
      await deliver(list);
      return { ok: true, told: list.length };
    },
    /**
     * Words for EVERYONE in the household, now (a reminder for everyone, at its moment): one message each, held through
     * a person's quiet hours like any announcement, said once per occurrence. The one who asked hears it too.
     * @param {string} text
     * @param {{occurrence?: string|null}} [opts]  the row's occurrence (what keeps it said once)
     */
    async say(text, { occurrence = null } = {}) {
      const words = String(text ?? '').trim();
      if (!words) return { ok: false, reason: 'nothing to say' };
      const key = occurrence ?? String(now());
      const people = ((await users.list()) ?? []).filter((r) => r?.id);
      const list = people.map((r) => ({ id: `announce:say:${key}:${r.id}`, personId: r.id, kind: 'say', itemId: key, itemKind: 'say', text: words, at: null }));
      await deliver(list);
      return { ok: true, told: list.length };
    },
    /**
     * A reminder a person set for themselves ("herinner me over 10 minuten: …"), at its moment: said to THEM only, in their
     * own chat — held through their quiet hours like an announcement, said whatever their switch for the bot's own
     * reminders says. Not sent (their door failed): not ok, so the runner tries again while its window is open.
     * @param {string} personId
     * @param {string} text
     * @param {{occurrence?: string|null}} [opts]
     */
    async remind(personId, text, { occurrence = null } = {}) {
      const words = String(text ?? '').trim();
      if (!personId || !words) return { ok: false, reason: 'nothing to say' };
      const key = occurrence ?? String(now());
      const r = await deliver([{ id: `announce:mine:${key}`, personId, kind: 'mine', itemId: key, itemKind: 'mine', text: words, at: null }], { own: true });
      return r.failed ? { ok: false, reason: 'not-sent' } : { ok: true };
    },
    /**
     * A person's held announcements as lines, once their quiet hours are over — or null. The tick says them (in the
     * person's next message) and then calls `sentHeld`.
     */
    heldLines(personId) {
      const held = threads.heldAnnouncementsOf(personId);
      if (!held.length || quietNow(personId)) return null;
      const done = marks.ids();
      const open = held.filter((a) => !done.has(a.id));
      if (!open.length) { threads.setHeldAnnouncements(personId, []); return null; }
      const tp = tFor(personId);
      return { lines: open.map((a) => announcementLine(a, tp, tz, langOf(personId) ?? 'nl')), ids: open.map((a) => a.id) };
    },
    /** The held ones went out: marked, let go. */
    sentHeld(personId, ids) {
      for (const id of ids) marks.mark(id, {});
      threads.setHeldAnnouncements(personId, []);
      tell({ personId, kind: 'held', outcome: 'sent', count: ids.length });
    },
  };
}
