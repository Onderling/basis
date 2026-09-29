/**
 * listsOps — the composable lists' handlers, once.
 *
 * The ops are declared in `apps/lists/manifest.js` and MOUNTED on the agent's waist by whichever shell is
 * running (`agent.mountAppOps('lists', …)`), because the service is per-circle: it holds the circle's own
 * `CircleItemStore`, which only a live composition has. What must NOT be per-shell is the behaviour — a
 * copy in `circleApp.js` and another in `CircleLauncherScreen.js` is the drift this repo spends its guards
 * on, and it is what "a shell does composition and paint, nothing else" forbids. So the shells inject
 * their seams (which store, which translator, who is acting) and this decides what the ops mean.
 *
 * A list lives in the circle's own store, like a task or a message, so it rides the one fan-out path and
 * obeys the circle's data-move branch. Nothing here knows about sharing; that is the point.
 */
import { makeCircleLists } from '@onderling/kring-host/circleLists';
import { calendarManifest } from '../../../calendar/manifest.js';
import { matchEntry, choicesOf } from './entryRef.js';

/**
 * @param {object} a
 * @param {(circleId: string) => object} a.storeFor   the circle's own CircleItemStore
 * @param {(k: string, vars?: object) => string} a.t  locale resolver
 * @param {() => string|null} a.activeCircle  the circle a call means when it does not name one
 * @param {string} [a.localActor]
 * @returns {Record<string, (args: object) => Promise<object>>} opId → handler
 */
export function makeListsOps({ storeFor, t, activeCircle, localActor = 'me' } = {}) {
  // What a list may hold beyond its own entries and tasks: appointments (the calendar's `accepts` line).
  const svc = makeCircleLists({ storeFor, manifests: [calendarManifest] });
  // A call names its circle, or means the one the person is looking at. Named wins: an agent or a
  // journey acts on a circle it is not "in", and must be able to say which.
  const circleOf = (args) => args?.circleId ?? activeCircle?.() ?? null;

  /** A person types a list's NAME; an id is what the app uses. Accept either. */
  const findList = async (circleId, ref) => {
    const containers = await svc.listContainers(circleId);
    return containers.find((c) => c.id === ref)
      ?? containers.find((c) => String(c.text ?? '').toLowerCase() === String(ref).toLowerCase())
      ?? null;
  };

  /** A list's open entries (its direct children), oldest first. */
  const entriesOf = async (circleId, listId) => {
    const tree = await svc.tree(circleId, listId);
    return (Array.isArray(tree?.children) ? tree.children : []).filter((c) => c && !c.completedAt);
  };
  /** An entry on a list, by its id or its words (`matchEntry`: exact words, else the one entry that contains them; several → which). */
  const findEntry = async (circleId, listId, ref) => matchEntry(await entriesOf(circleId, listId), ref, (c) => c.text, undefined, { partialAsks: true });
  /** An open entry on ANY of the circle's lists, by its id or its words — with the list that holds it. */
  const findAnyEntry = async (circleId, ref) => {
    const all = [];
    const listOf = new Map();
    for (const c of await svc.listContainers(circleId)) {
      for (const e of await entriesOf(circleId, c.id)) { all.push(e); listOf.set(e.id, c); }
    }
    const m = matchEntry(all, ref, (c) => c.text, undefined, { partialAsks: true });
    return { ...m, target: m.entry ? listOf.get(m.entry.id) ?? null : null };
  };
  /** Words that are part of one entry ask about it ("Bedoel je 'melk en kaas'?"); words that fit several ask which. */
  const which = (among) => (among.length === 1
    ? t('circle.lists.mean_this', { item: among[0].text ?? '' })
    : t('circle.lists.which_one', { options: choicesOf(among, (c) => c.text) }));
  /**
   * The entry a call names, and the list that holds it — or the refusal. A person names the ENTRY ("verander melk in
   * halfvolle melk"); a list, when given, only tells two entries on different lists apart.
   */
  const locate = async (args) => {
    const circleId = circleOf(args);
    if (!circleId) return { error: t('circle.lists.no_circle') };
    const item = String(args?.item ?? '').trim();
    if (!item) return { error: t('circle.lists.need_item') };
    const ref = String(args?.list ?? '').trim();
    if (!ref) {
      const { entry, among, target } = await findAnyEntry(circleId, item);
      if (!entry) return { error: among.length ? which(among) : t('circle.lists.not_there', { item }) };
      return { circleId, target, entry };
    }
    const target = await findList(circleId, ref);
    if (!target) return { error: t('circle.lists.no_such_list', { name: ref }) };
    const { entry, among } = await findEntry(circleId, target.id, item);
    if (!entry) return { error: among.length ? which(among) : t('circle.lists.no_such_entry', { item, name: target.text ?? ref }) };
    return { circleId, target, entry };
  };

  return {
    createList: async (args) => {
      const circleId = circleOf(args);
      const text = String(args?.text ?? '').trim();
      if (!circleId) return { ok: false, error: t('circle.lists.no_circle') };
      if (!text) return { ok: false, error: t('circle.lists.need_name') };
      // What a bare add to it makes (a chores list: `task`) — one of the kinds a list accepts, else ignored.
      const defaultChild = typeof args?.defaultChild === 'string' && args.defaultChild.trim() ? args.defaultChild.trim() : undefined;
      const made = await svc.createList(circleId, text, localActor, defaultChild ? { defaultChild } : undefined);
      return { ok: true, itemId: made?.id ?? null, message: t('circle.lists.made', { name: text }) };
    },

    addToList: async (args) => {
      const circleId = circleOf(args);
      const text = String(args?.text ?? '').trim();
      const ref = String(args?.list ?? '').trim();
      if (!circleId) return { ok: false, error: t('circle.lists.no_circle') };
      if (!text || !ref) return { ok: false, error: t('circle.lists.need_list_and_text') };
      const target = await findList(circleId, ref);
      if (!target) return { ok: false, error: t('circle.lists.no_such_list', { name: ref }) };
      // WHICH KIND of child is the container's `accepts` policy's decision, not this handler's: `hint`
      // names one of the kinds that container accepts, and absent it the policy's default child wins.
      const kind = String(args?.kind ?? '').trim() || undefined;
      // An appointment needs a time: a bare add to a list whose entries are events (the Agenda) goes through the
      // calendar's own add, which asks when — never as an event with no date.
      if ((kind ?? target.defaultChild) === 'calendar-event') return { ok: false, error: t('circle.calendar.say_when', { name: target.text ?? ref }) };
      // The same words already open on this list: not a second entry (the walk: "lamp vervangen" twice on Klusjes).
      const same = (await entriesOf(circleId, target.id)).find((c) => String(c.text ?? '').trim().toLowerCase() === text.toLowerCase());
      if (same) return { ok: true, itemId: same.id, duplicate: true, message: t('circle.lists.already_there', { item: same.text ?? text, list: target.text ?? ref }) };
      const made = await svc.addItem(circleId, target.id, text, localActor, kind ? { hint: kind } : undefined);
      if (!made) return { ok: false, error: t('circle.lists.not_accepted', { name: target.text ?? ref }) };
      return {
        ok: true, itemId: made.id ?? null, kind: made.type ?? null,
        message: t('circle.lists.added', { text, name: target.text ?? ref }),
      };
    },

    listLists: async (args) => {
      const circleId = circleOf(args);
      if (!circleId) return { ok: false, error: t('circle.lists.no_circle') };
      const containers = await svc.listContainers(circleId);
      return { ok: true, items: containers.map((c) => ({ id: c.id, label: c.text ?? c.id, type: c.type })) };
    },

    markListItemDone: async (args) => {
      // Never "done" for an entry that is not there: nothing would have been ticked.
      const at = await locate(args);
      if (at.error) return { ok: false, error: at.error };
      await svc.markDone(at.circleId, at.entry.id, localActor);
      return { ok: true, message: t('circle.lists.done') };
    },

    listEntries: async (args) => {
      const circleId = circleOf(args);
      if (!circleId) return { ok: false, error: t('circle.lists.no_circle') };
      const ref = String(args?.list ?? '').trim();
      const target = ref ? await findList(circleId, ref) : null;
      if (!target) return { ok: false, error: t('circle.lists.no_such_list', { name: ref }) };
      const open = await entriesOf(circleId, target.id);
      return { ok: true, items: open.map((c) => ({ id: c.id, label: c.text ?? c.id, type: c.type })) };
    },

    removeFromList: async (args) => {
      const at = await locate(args);
      if (at.error) return { ok: false, error: at.error };
      await svc.remove(at.circleId, at.entry.id);
      return { ok: true, message: t('circle.lists.removed', { text: at.entry.text ?? '', name: at.target.text ?? '' }) };
    },

    editEntry: async (args) => {
      const text = String(args?.text ?? '').trim();
      if (!text) return { ok: false, error: t('circle.lists.need_list_and_text') };
      const at = await locate(args);
      if (at.error) return { ok: false, error: at.error };
      await svc.storeFor(at.circleId).put({ ...at.entry, text }, { by: localActor });
      return { ok: true, message: t('circle.lists.edited', { text, name: at.target.text ?? '' }) };
    },

    /** The service itself, for a screen that projects containers (a read, not a second write path). */
    _service: svc,
  };
}

export default makeListsOps;
