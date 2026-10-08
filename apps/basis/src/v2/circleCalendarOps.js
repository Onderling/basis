/**
 * circleCalendarOps — the calendar's verbs over a circle's ONE store (the household bot's Agenda).
 *
 * The calendar app keeps events in an in-memory pseudo-pod per agent (`CalendarStore`): no circle, gone at a restart.
 * On a household bot the events are the household's: a `calendar-event` is a child of the Agenda list in the circle's
 * `CircleItemStore` (a ref and a back-ref — containment), and the calendar's verbs act on it there:
 *   - `addEvent`     — the calendar's own validation (`buildEvent`: a title, when, how long), the child written under
 *                      the Agenda (the list whose default child is an event, else the one by the template's name);
 *   - `listEvents`   — a read over the store with a window (`days`, default 7), soonest first;
 *   - `rsvpAccept` · `rsvpDecline` · `rsvpTentative` — the child's rsvp for the person who asks;
 *   - `briefSummary` · `searchEvents` — the next 24 hours for the morning brief; appointments by their words;
 *   - `cancelEvent`  — the child kept as cancelled (the calendar's own soft cancel: the Agenda's edge stays whole and
 *                      the record stays; the window no longer lists it);
 *   - `getEventSnapshot` — one event.
 * An event is named by its id or by its words ("de tandarts"), and a time is the household's clock: a time without a
 * zone is read as local, and shown as local.
 * The `.ics` feed is a projection for later (a read, never a second store). A person's node composes none of this.
 */
import { reminderLayerFromWords } from './reminderWords.js';
import { addChildTo } from '@onderling/item-store';
import { makeCircleLists } from '@onderling/kring-host/circleLists';
import { buildEvent, rsvpEvent, eventsInWindow } from '@onderling-app/calendar';
import { calendarManifest } from '../../../calendar/manifest.js';
import { matchEntry, choicesOf } from './entryRef.js';

const RSVP = { rsvpAccept: 'accepted', rsvpDecline: 'declined', rsvpTentative: 'tentative' };

/**
 * @param {object} a
 * @param {(circleId: string) => object} a.storeFor   the circle's own CircleItemStore
 * @param {() => string|null} a.activeCircle
 * @param {(key: string, vars?: object) => string} a.t
 * @param {string} [a.localActor]
 * @returns {Record<string, (args: object) => Promise<object>>} opId → handler
 */
export function makeCircleCalendarOps({ storeFor, activeCircle, t, localActor = 'me' } = {}) {
  const lists = makeCircleLists({ storeFor, manifests: [calendarManifest] });
  const circleOf = (args) => args?.circleId ?? activeCircle?.() ?? null;
  const who = (args) => (typeof args?.actor === 'string' && args.actor ? args.actor : localActor);

  /** The Agenda: the list whose default child is an event, else the one by the template's name. */
  async function agendaOf(circleId) {
    const containers = await lists.listContainers(circleId);
    const name = String(t('circle.lists.template.schedule') ?? '').toLowerCase();
    return containers.find((c) => c.defaultChild === 'calendar-event')
      ?? containers.find((c) => String(c.text ?? '').toLowerCase() === name)
      ?? null;
  }
  const eventsOf = async (circleId) => (await storeFor(circleId).listByType('calendar-event')) ?? [];
  const pad = (n) => String(n).padStart(2, '0');
  /** When, on the household's clock: `YYYY-MM-DD HH:MM` in local time. */
  const stamp = (e) => {
    const d = new Date(e.startsAt);
    return Number.isNaN(d.getTime()) ? String(e.startsAt ?? '')
      : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const label = (e) => `${stamp(e)} · ${e.title}`;
  /** The event a call names — its id, or its words among the open ones. */
  const titleOf = (e) => e.title ?? e.text;
  const eventOf = async (circleId, ref) => {
    if (!circleId || !ref) return { event: null, among: [] };
    const open = (await eventsOf(circleId)).filter((e) => e.state !== 'cancelled');
    const m = matchEntry(open, ref, titleOf);
    if (m.entry || m.among.length) return { event: m.entry, among: m.among };
    return { event: (await storeFor(circleId).get(String(ref))) ?? null, among: [] };
  };
  /** Words that fit several appointments ask which; words that fit none say so. */
  const missing = (among) => ({ ok: false, error: among.length ? t('circle.lists.which_one', { options: choicesOf(among, titleOf) }) : t('circle.calendar.no_event') });

  return {
    addEvent: async (args) => {
      const circleId = circleOf(args);
      if (!circleId) return { ok: false, error: t('circle.lists.no_circle') };
      // a circle that has no Agenda yet (only a household's template makes one) gets it with its first appointment,
      // as a person's own calendar does — an appointment made in any circle is that circle's
      let agenda = await agendaOf(circleId);
      if (!agenda) {
        try { await lists.createList(circleId, t('circle.lists.template.schedule'), who(args), { defaultChild: 'calendar-event' }); } catch { /* read again below */ }
        agenda = await agendaOf(circleId);
      }
      if (!agenda) return { ok: false, error: t('circle.calendar.no_agenda') };
      let event;
      try { event = buildEvent(args, { actorDefault: who(args) }); }
      catch (err) { return { ok: false, error: err?.message ?? String(err) }; }
      // its own reminders, in a person's words ("ook avond", "60"): the household's statement about this appointment
      const reminders = args?.reminders ? reminderLayerFromWords(args.reminders) : null;
      if (args?.reminders && !reminders) return { ok: false, error: t('circle.bot.reminders_usage') };
      // the same appointment again — its title (case aside) at the same start — is not a second one
      const same = (await eventsOf(circleId)).find((e) => e.state !== 'cancelled' && !e.completedAt
        && String(e.title ?? '').trim().toLowerCase() === String(event.title ?? '').trim().toLowerCase()
        && new Date(e.startsAt).getTime() === new Date(event.startsAt).getTime());
      // the appointment and when: the door words it in the person's date language (`replyLine`)
      if (same) return { ok: true, duplicate: true, itemId: same.id, title: same.title, startsAt: same.startsAt, message: t('circle.calendar.already_there', { title: same.title, when: stamp(same) }) };
      // The Agenda's child, with the event's own id; `text` so the list shows it as an entry too.
      const made = await addChildTo(storeFor(circleId), agenda.id, { ...event, text: event.title, completedAt: null, createdBy: who(args), ...(reminders ? { reminders } : {}) });
      return { ok: true, itemId: made?.id ?? event.id, title: event.title, startsAt: event.startsAt, message: t('circle.calendar.added', { title: event.title, when: stamp(event) }) };
    },

    listEvents: async (args) => {
      const circleId = circleOf(args);
      if (!circleId) return { ok: false, error: t('circle.lists.no_circle') };
      const days = Number(args?.days) > 0 ? Number(args.days) : 7;
      const now = Date.now();
      const open = eventsInWindow(await eventsOf(circleId), { since: now, until: now + days * 86_400_000 });
      // the list's own name above its appointments, as any list read says which list it is
      const agenda = await agendaOf(circleId);
      // who it names and who answered (the household's people, by id): a door's reader sees them as names, under the
      // household's names setting (the agent puts them through it), never as ids
      const people = (e) => ({
        ...(Array.isArray(e.attendees) && e.attendees.length ? { attendees: [...e.attendees] } : {}),
        ...(e.rsvp && typeof e.rsvp === 'object' && Object.keys(e.rsvp).length ? { rsvp: { ...e.rsvp } } : {}),
      });
      return { ok: true, ...(agenda?.text ? { title: agenda.text } : {}), items: open.map((e) => ({ id: e.id, label: label(e), type: 'calendar-event', title: titleOf(e), startsAt: e.startsAt ?? null, ...(e.createdBy ? { createdBy: e.createdBy } : {}), ...people(e) })) };
    },

    /** The morning brief's calendar slot: the next 24 hours, the first five; nothing when there is nothing. */
    briefSummary: async (args) => {
      const circleId = circleOf(args);
      if (!circleId) return { ok: true };
      const now = Date.now();
      const soon = eventsInWindow(await eventsOf(circleId), { since: now, until: now + 86_400_000 });
      if (!soon.length) return { ok: true };
      return { ok: true, items: soon.slice(0, 5).map((e) => ({ id: e.id, label: label(e) })), message: t('circle.calendar.brief', { count: soon.length }) };
    },

    /** Appointments whose title holds the words, soonest first (cancelled ones not). */
    searchEvents: async (args) => {
      const circleId = circleOf(args);
      if (!circleId) return { ok: false, error: t('circle.lists.no_circle') };
      const q = String(args?.query ?? '').trim().toLowerCase();
      const hits = (await eventsOf(circleId)).filter((e) => e.state !== 'cancelled' && (!q || String(titleOf(e) ?? '').toLowerCase().includes(q)))
        .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
      return { ok: true, items: hits.map((e) => ({ id: e.id, label: label(e), type: 'calendar-event', title: titleOf(e), startsAt: e.startsAt ?? null })) };
    },

    getEventSnapshot: async (args) => {
      const circleId = circleOf(args);
      const { event, among } = await eventOf(circleId, args?.id);
      return event ? { ok: true, event } : missing(among);
    },

    cancelEvent: async (args) => {
      const circleId = circleOf(args);
      const { event, among } = await eventOf(circleId, args?.id);
      if (!event) return missing(among);
      await storeFor(circleId).put({ ...event, state: 'cancelled' }, { by: who(args) });
      return { ok: true, title: event.title, startsAt: event.startsAt, message: t('circle.calendar.cancelled', { title: event.title, when: stamp(event) }) };
    },

    ...Object.fromEntries(Object.entries(RSVP).map(([op, response]) => [op, async (args) => {
      const circleId = circleOf(args);
      const { event, among } = await eventOf(circleId, args?.id);
      if (!event) return missing(among);
      await storeFor(circleId).put(rsvpEvent(event, who(args), response), { by: who(args) });
      // the reply names the appointment answered, and when
      return { ok: true, title: event.title, startsAt: event.startsAt, message: t(`circle.calendar.rsvp_${response}`, { title: event.title, when: stamp(event) }) };
    }])),
  };
}
