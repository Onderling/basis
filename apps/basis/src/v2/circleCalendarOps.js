/**
 * circleCalendarOps — the calendar's verbs over a circle's ONE store (the household bot's Agenda).
 *
 * The calendar app keeps events in an in-memory pseudo-pod per agent (`CalendarStore`): no circle, gone at a restart.
 * On a household bot the events are the household's: a `calendar-event` is a child of the Agenda list in the circle's
 * `CircleItemStore` (a ref and a back-ref — containment), and the calendar's verbs act on it there:
 *   - `addEvent`     — the calendar's own validation (`buildEvent`: a title, when, how long), the child written under
 *                      the Agenda (the list whose default child is an event, else the one by the template's name);
 *   - `listEvents`   — a read over the store with a window (`days`, default 7), soonest first;
 *   - `rsvpAccept` · `rsvpDecline` · `rsvpTentative` — the asker's answer, as its OWN item (rsvpItems.js), never a
 *                      field on the event: the event's `rsvp` is projected from the answers when it is read;
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
import { buildEvent, retimeEvent, eventsInWindow } from '@onderling-app/calendar';
import { rsvpItem, signedRsvpItem, withAnswers, RSVP_TYPE } from './rsvpItems.js';
import { calendarManifest } from '../../../calendar/manifest.js';
import { matchEntry, choicesOf } from './entryRef.js';

const RSVP = { rsvpAccept: 'accepted', rsvpDecline: 'declined', rsvpTentative: 'tentative' };

/**
 * @param {object} a
 * @param {(circleId: string) => object} a.storeFor   the circle's own CircleItemStore
 * @param {() => string|null} a.activeCircle
 * @param {(key: string, vars?: object) => string} a.t
 * @param {string|((circleId: string|null, named: string|null) => string|null)} [a.localActor]  who writes when the call names no actor — per circle,
 *   so a circle that has a self of its own (a pair circle's lens) is written as that self, never as the general one;
 *   null = no writer here (the write is refused with `no-self`). EVERY write into a pair circle resolves its author
 *   here, never at a call site.
 * @param {(circleId: string) => Promise<{pubKey: string, sign: Function}|null>} [a.signerFor]  the answering self's circle
 *   identity: an answer is SIGNED by it (rsvpItems.js); absent (a store no one else writes) an answer goes unsigned
 * @param {(circleId: string) => Promise<((item: object) => boolean)|null>} [a.answerRuleFor]  the roster's rule for which
 *   answers stand (`rosterAnswerRule`); absent, the local shape
 * @param {(bytes: Uint8Array) => string} [a.encode]  how a signature is written (base64)
 * @param {(circleId: string|null, named: string|null) => string|null} [a.answererFor]  who an answer is FROM (the self's
 *   roster id, or the door person the call names); absent, the writer (`localActor`)
 * @returns {Record<string, (args: object) => Promise<object>>} opId → handler
 */
export function makeCircleCalendarOps({ storeFor, activeCircle, t, localActor = 'me', signerFor = null, answerRuleFor = null, encode = null, answererFor = null } = {}) {
  const lists = makeCircleLists({ storeFor, manifests: [calendarManifest] });
  const circleOf = (args) => args?.circleId ?? activeCircle?.() ?? null;
  // who writes: a function `localActor` DECIDES per circle (it gets the actor the call names, and may refuse it — a
  // pair circle is written by its self only); a plain one is the default when the call names no actor
  const named = (args) => (typeof args?.actor === 'string' && args.actor ? args.actor : null);
  const who = (args) => (typeof localActor === 'function' ? localActor(circleOf(args), named(args)) : (named(args) ?? localActor));
  // no writer (a pair circle whose self this device does not run): not ours to write — said, never written
  const noSelf = () => ({ ok: false, code: 'no-self', error: t('circle.calendar.no_self') });

  /** The Agenda: the list whose default child is an event, else the one by the template's name. */
  async function agendaOf(circleId) {
    const containers = await lists.listContainers(circleId);
    const name = String(t('circle.lists.template.schedule') ?? '').toLowerCase();
    return containers.find((c) => c.defaultChild === 'calendar-event')
      ?? containers.find((c) => String(c.text ?? '').toLowerCase() === name)
      ?? null;
  }
  const eventsOf = async (circleId) => (await storeFor(circleId).listByType('calendar-event')) ?? [];
  // what is READ: the events with their answers projected from the answer items (writes use the raw events above, so
  // a projected map is never written back onto an event)
  const ruleFor = async (circleId) => (typeof answerRuleFor === 'function' ? (await answerRuleFor(circleId).catch(() => null)) : null);
  const answeredEventsOf = async (circleId) => {
    const store = storeFor(circleId);
    const [events, answers, counts] = await Promise.all([eventsOf(circleId), store.listByType(RSVP_TYPE).catch(() => []), ruleFor(circleId)]);
    return withAnswers(events, answers ?? [], counts);
  };
  const pad = (n) => String(n).padStart(2, '0');
  /** When, on the household's clock: `YYYY-MM-DD HH:MM` in local time. */
  const stamp = (e) => {
    const d = new Date(e.startsAt);
    return Number.isNaN(d.getTime()) ? String(e.startsAt ?? '')
      : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}${d.getHours() || d.getMinutes() ? ` ${pad(d.getHours())}:${pad(d.getMinutes())}` : ''}`;   // a whole day: no time
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
      if (!who(args)) return noSelf();
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
      // without the calendar's own `rsvp: {}`: in a circle the answers are their own items, never a field here
      try { const { rsvp: _none, ...built } = buildEvent(args, { actorDefault: who(args) }); event = built; }
      catch (err) { return { ok: false, error: err?.message ?? String(err) }; }
      // an import's record of the answers the file held (shown, never counted: an answer is its own signed item)
      const kept = args?.answersAt && typeof args.answersAt === 'object' ? Object.fromEntries(Object.entries(args.answersAt).filter(([w, r]) => typeof w === 'string' && ['accepted', 'tentative', 'declined'].includes(r))) : null;
      if (event && kept && Object.keys(kept).length) event = { ...event, answersAt: kept };
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
      return { ok: true, itemId: made?.id ?? event.id, title: event.title, startsAt: event.startsAt, ...(reminders ? { reminders } : {}), message: t('circle.calendar.added', { title: event.title, when: stamp(event) }) };
    },

    listEvents: async (args) => {
      const circleId = circleOf(args);
      if (!circleId) return { ok: false, error: t('circle.lists.no_circle') };
      const days = Number(args?.days) > 0 ? Number(args.days) : 7;
      const now = Date.now();
      const open = eventsInWindow(await answeredEventsOf(circleId), { since: now, until: now + days * 86_400_000 });
      // the list's own name above its appointments, as any list read says which list it is
      const agenda = await agendaOf(circleId);
      // who it names and who answered (the household's people, by id): a door's reader sees them as names, under the
      // household's names setting (the agent puts them through it), never as ids
      const people = (e) => ({
        ...(Array.isArray(e.attendees) && e.attendees.length ? { attendees: [...e.attendees] } : {}),
        ...(e.rsvp && typeof e.rsvp === 'object' && Object.keys(e.rsvp).length ? { rsvp: { ...e.rsvp } } : {}),
        ...(e.answersAt && typeof e.answersAt === 'object' && Object.keys(e.answersAt).length ? { answersAt: { ...e.answersAt } } : {}),
      });
      return { ok: true, ...(agenda?.text ? { title: agenda.text } : {}), items: open.map((e) => ({ id: e.id, label: label(e), type: 'calendar-event', title: titleOf(e), startsAt: e.startsAt ?? null, ...(e.createdBy ? { createdBy: e.createdBy } : {}), ...people(e) })) };
    },

    /** The morning brief's calendar slot: the next 24 hours, the first five; nothing when there is nothing. */
    briefSummary: async (args) => {
      const circleId = circleOf(args);
      if (!circleId) return { ok: true };
      const now = Date.now();
      const soon = eventsInWindow(await answeredEventsOf(circleId), { since: now, until: now + 86_400_000 });
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
      if (!event) return missing(among);
      const [answered] = withAnswers([event], (await storeFor(circleId).listByType(RSVP_TYPE).catch(() => [])) ?? [], await ruleFor(circleId));
      return { ok: true, event: answered };
    },

    /** A new title and/or moment for the appointment (the length stays; a day without a time is the whole day). */
    updateEvent: async (args) => {
      if (!who(args)) return noSelf();
      const circleId = circleOf(args);
      const { event, among } = await eventOf(circleId, args?.id);
      if (!event) return missing(among);
      let next;
      try { next = retimeEvent(event, { title: args?.title, when: args?.when }); }
      catch (err) { return { ok: false, error: err?.message ?? String(err) }; }
      await storeFor(circleId).put(next, { by: who(args) });
      return { ok: true, itemId: next.id, title: next.title, startsAt: next.startsAt, message: t('circle.calendar.updated', { title: next.title, when: stamp(next) }) };
    },

    cancelEvent: async (args) => {
      if (!who(args)) return noSelf();
      const circleId = circleOf(args);
      const { event, among } = await eventOf(circleId, args?.id);
      if (!event) return missing(among);
      await storeFor(circleId).put({ ...event, state: 'cancelled' }, { by: who(args) });
      return { ok: true, itemId: event.id, title: event.title, startsAt: event.startsAt, message: t('circle.calendar.cancelled', { title: event.title, when: stamp(event) }) };
    },

    ...Object.fromEntries(Object.entries(RSVP).map(([op, response]) => [op, async (args) => {
      const answerer = typeof answererFor === 'function' ? answererFor(circleOf(args), named(args)) : who(args);
      if (!answerer) return noSelf();
      const circleId = circleOf(args);
      const { event, among } = await eventOf(circleId, args?.id);
      if (!event) return missing(among);
      // the answer is its own item, written as the answering self — the event itself is not touched
      const facts = { eventId: event.id, person: answerer, response };
      const signer = typeof signerFor === 'function' ? await signerFor(circleId).catch(() => null) : null;
      // a circle's answer is signed by the answering self's circle identity; one that cannot be signed is not written
      if (typeof signerFor === 'function' && !(signer?.pubKey && typeof signer.sign === 'function' && typeof encode === 'function')) return noSelf();
      await storeFor(circleId).put(signer ? signedRsvpItem(signer, facts, encode) : rsvpItem(facts), { by: answerer });
      // the reply names the appointment answered, and when
      return { ok: true, title: event.title, startsAt: event.startsAt, message: t(`circle.calendar.rsvp_${response}`, { title: event.title, when: stamp(event) }) };
    }])),
  };
}
