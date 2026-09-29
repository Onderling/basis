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
 *   - `cancelEvent`  — the child removed;
 *   - `getEventSnapshot` — one event.
 * The `.ics` feed is a projection for later (a read, never a second store). A person's node composes none of this.
 */
import { addChildTo } from '@onderling/item-store';
import { makeCircleLists } from '@onderling/kring-host/circleLists';
import { buildEvent, rsvpEvent, eventsInWindow } from '@onderling-app/calendar';
import { calendarManifest } from '../../../calendar/manifest.js';

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
  const label = (e) => `${String(e.startsAt).slice(0, 16).replace('T', ' ')} · ${e.title}`;

  return {
    addEvent: async (args) => {
      const circleId = circleOf(args);
      if (!circleId) return { ok: false, error: t('circle.lists.no_circle') };
      const agenda = await agendaOf(circleId);
      if (!agenda) return { ok: false, error: t('circle.calendar.no_agenda') };
      let event;
      try { event = buildEvent(args, { actorDefault: who(args) }); }
      catch (err) { return { ok: false, error: err?.message ?? String(err) }; }
      // The Agenda's child, with the event's own id; `text` so the list shows it as an entry too.
      const made = await addChildTo(storeFor(circleId), agenda.id, { ...event, text: event.title, completedAt: null, createdBy: who(args) });
      return { ok: true, itemId: made?.id ?? event.id, message: t('circle.calendar.added', { title: event.title, when: label(event) }) };
    },

    listEvents: async (args) => {
      const circleId = circleOf(args);
      if (!circleId) return { ok: false, error: t('circle.lists.no_circle') };
      const days = Number(args?.days) > 0 ? Number(args.days) : 7;
      const now = Date.now();
      const open = eventsInWindow(await eventsOf(circleId), { since: now, until: now + days * 86_400_000 });
      return { ok: true, items: open.map((e) => ({ id: e.id, label: label(e), type: 'calendar-event' })) };
    },

    getEventSnapshot: async (args) => {
      const circleId = circleOf(args);
      const event = circleId && args?.id ? await storeFor(circleId).get(String(args.id)) : null;
      return event ? { ok: true, event } : { ok: false, error: t('circle.calendar.no_event') };
    },

    cancelEvent: async (args) => {
      const circleId = circleOf(args);
      const store = circleId ? storeFor(circleId) : null;
      const event = store && args?.id ? await store.get(String(args.id)) : null;
      if (!event) return { ok: false, error: t('circle.calendar.no_event') };
      await store.delete(event.id);
      return { ok: true, message: t('circle.calendar.cancelled', { title: event.title }) };
    },

    ...Object.fromEntries(Object.entries(RSVP).map(([op, response]) => [op, async (args) => {
      const circleId = circleOf(args);
      const store = circleId ? storeFor(circleId) : null;
      const event = store && args?.id ? await store.get(String(args.id)) : null;
      if (!event) return { ok: false, error: t('circle.calendar.no_event') };
      await store.put(rsvpEvent(event, who(args), response), { by: who(args) });
      return { ok: true, message: t(`circle.calendar.rsvp_${response}`, { title: event.title }) };
    }])),
  };
}
