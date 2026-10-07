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
import { parseDateInput } from '@onderling-app/calendar';
import { reminderLayerFromWords, describeRules } from './reminderWords.js';
import { makeCircleLists } from '@onderling/kring-host/circleLists';
import { calendarManifest } from '../../../calendar/manifest.js';
import { matchEntry, choicesOf } from './entryRef.js';
import { childIdsOf, deleteContainer, contain, param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/**
 * @param {object} a
 * @param {(circleId: string) => object} a.storeFor   the circle's own CircleItemStore
 * @param {(k: string, vars?: object) => string} a.t  locale resolver
 * @param {() => string|null} a.activeCircle  the circle a call means when it does not name one
 * @param {string} [a.localActor]
 * @param {() => {mode: 'keep'|'hide'|'delete', days: number}} [a.passed]  a household bot's setting for what is done or
 *        has passed (shown marked · shown marked for N days · deleted); absent → a done entry leaves the read at once
 * @param {(a: {circleId: string, entry: object, ctx?: object}) => Promise<object>} [a.completeChore]  how a chore on a
 *        list is ticked: the chore's own verb (a household bot's tasks); absent → a plain tick
 * @returns {Record<string, (args: object, ctx?: object) => Promise<object>>} opId → handler
 */
/** How long a removed list can be put back (Frits 2026-10-05: 30 days); after that it is dropped. */
export const REMOVED_LIST_KEEP_DAYS = param({ key: 'lists.removedKeepDays', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30 });

/** Who holds a chore (contact ids — data; the door words them as far as the names setting lets the asker see). */
const holdersOf = (c) => {
  if (c?.type !== 'task') return {};
  const ids = [...new Set([...(Array.isArray(c.assignees) ? c.assignees : []), c.assignee].filter((x) => typeof x === 'string' && x))];
  // its day goes with it: a reader of the list (the week overview, a screen) says when, not only who
  return { holders: ids, ...(c.dueAt ? { dueAt: c.dueAt } : {}) };
};

export function makeListsOps({ storeFor, t, activeCircle, localActor = 'me', passed = null, completeChore = null, now = Date.now } = {}) {
  // What a list may hold beyond its own entries and tasks: appointments (the calendar's `accepts` line).
  const svc = makeCircleLists({ storeFor, manifests: [calendarManifest] });
  // A call names its circle, or means the one the person is looking at. Named wins: an agent or a
  // journey acts on a circle it is not "in", and must be able to say which.
  const circleOf = (args) => args?.circleId ?? activeCircle?.() ?? null;
  // the lists removed in this circle that can still come back, and dropping those past the keep window
  const removedOf = async (circleId) => ((await storeFor(circleId).listByType('removed-list')) ?? []);
  const dropExpired = async (circleId) => {
    const keep = REMOVED_LIST_KEEP_DAYS * 86_400_000;
    for (const r of await removedOf(circleId)) if (now() - (Number(r.removedAt) || 0) >= keep) await storeFor(circleId).delete(r.id);
  };

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
    return (Array.isArray(tree?.children) ? tree.children : []).filter((c) => c && !c.completedAt && c.state !== 'cancelled');
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
      if (!entry) return among.length ? { error: which(among) } : { error: t('circle.lists.not_there', { item }), notFound: true };
      return { circleId, target, entry };
    }
    const target = await findList(circleId, ref);
    if (!target) return { error: t('circle.lists.no_such_list', { name: ref }) };
    const { entry, among } = await findEntry(circleId, target.id, item);
    if (!entry) return among.length ? { error: which(among) } : { error: t('circle.lists.no_such_entry', { item, name: target.text ?? ref }), notFound: true };
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

    /**
     * A line becomes a chore, in place: the same item (id, list, words), its type now `task` — what someone means when
     * they say who does it or when. A chore stays one (`already`); an appointment is its own type and stays it. Who and
     * when are the chore's own verbs' to set, after this (the door's add, or the person's call, passes them on).
     */
    makeChore: async (args) => {
      const at = await locate(args);
      if (at.error) return { ok: false, error: at.error, ...(at.notFound ? { code: 'not-found' } : {}) };
      const { circleId, entry } = at;
      if (entry.type === 'task') return { ok: true, itemId: entry.id, kind: 'task', already: true, message: t('circle.lists.chore_already', { text: entry.text ?? '' }) };
      if (entry.type !== 'list-item') return { ok: false, error: t('circle.lists.not_a_line', { text: entry.text ?? '' }) };
      // the item as stored (the tree's rows are projections), every field kept, the type changed
      const store = svc.storeFor(circleId);
      const stored = await store.get(entry.id);
      if (!stored) return { ok: false, error: t('circle.lists.not_there', { item: entry.text ?? '' }), code: 'not-found' };
      await store.put({ ...stored, type: 'task' }, { by: localActor });
      return { ok: true, itemId: entry.id, kind: 'task', message: t('circle.lists.chore_made', { text: entry.text ?? '' }) };
    },

    /**
     * At a shop ("ik ben bij de Lidl"): the household's general shopping list AND every list whose name mentions that
     * shop — what to buy here. A shop no list mentions is `not-found` (the door hands such words to the model).
     */
    shopVisit: async (args) => {
      const circleId = circleOf(args);
      if (!circleId) return { ok: false, error: t('circle.lists.no_circle') };
      const shop = String(args?.shop ?? '').trim();
      if (!shop) return { ok: false, error: t('circle.lists.need_list_and_text') };
      const containers = (await svc.listContainers(circleId)).filter((c) => c.type === 'list');
      const lower = shop.toLowerCase();
      const own = containers.filter((c) => String(c.text ?? '').toLowerCase().includes(lower));
      if (!own.length) return { ok: false, code: 'not-found', error: t('circle.lists.no_shop_list', { shop }) };
      const general = String(args?.general ?? '').trim();
      const generalList = general ? containers.find((c) => String(c.text ?? '').toLowerCase() === general.toLowerCase() && !own.includes(c)) : null;
      const parts = [];
      for (const list of [...(generalList ? [generalList] : []), ...own]) {
        const open = await entriesOf(circleId, list.id);
        parts.push(open.length ? t('circle.lists.shop_part', { list: list.text, items: open.map((c) => c.text).filter(Boolean).join(', ') }) : t('circle.lists.shop_part_empty', { list: list.text }));
      }
      return { ok: true, message: parts.join('\n') };
    },

    markListItemDone: async (args, ctx) => {
      // Never "done" for an entry that is not there: nothing would have been ticked.
      const at = await locate(args);
      if (at.error) return { ok: false, error: at.error, ...(at.notFound ? { code: 'not-found' } : {}) };
      // A chore is ticked by the chore's own verb (its rules, its state, its reply) — one entry point, the noun's verb
      // underneath — as the person asking.
      if (at.entry.type === 'task' && typeof completeChore === 'function') return completeChore({ circleId: at.circleId, entry: at.entry, ctx });
      await svc.markDone(at.circleId, at.entry.id, localActor);
      // the reply names what was ticked — the entry found, not the words it was asked by
      return { ok: true, message: t('circle.lists.done_named', { text: at.entry.text ?? '' }) };
    },

    listEntries: async (args) => {
      const circleId = circleOf(args);
      if (!circleId) return { ok: false, error: t('circle.lists.no_circle') };
      const ref = String(args?.list ?? '').trim();
      const target = ref ? await findList(circleId, ref) : null;
      if (!target) return { ok: false, error: t('circle.lists.no_such_list', { name: ref }) };
      // the list's own name goes with its entries: a read of five lists says which is which
      if (typeof passed !== 'function') {
        const open = await entriesOf(circleId, target.id);
        return { ok: true, title: target.text ?? ref, items: open.map((c) => ({ id: c.id, label: c.text ?? c.id, type: c.type, ...holdersOf(c) })) };
      }
      // A household bot: what is done (ticked, completed) or has passed (an appointment before now) follows its setting.
      const { mode, days } = passed();
      const now = Date.now();
      const keepMs = Math.max(0, Number(days) || 0) * 86_400_000;
      const tree = await svc.tree(circleId, target.id);
      const items = [];
      for (const c of (Array.isArray(tree?.children) ? tree.children : [])) {
        if (!c || c.state === 'cancelled') continue;
        const doneAt = c.completedAt ? new Date(c.completedAt).getTime() : null;
        const startAt = c.type === 'calendar-event' && c.startsAt ? new Date(c.startsAt).getTime() : null;
        const at = doneAt ?? (startAt !== null && startAt < now ? startAt : null);
        if (at === null) { items.push({ id: c.id, label: c.text ?? c.id, type: c.type, ...holdersOf(c) }); continue; }
        if (mode === 'delete') { await svc.remove(circleId, c.id); continue; }
        if (mode === 'keep' || now - at < keepMs) {
          items.push({ id: c.id, label: t(doneAt !== null ? 'circle.lists.entry_done' : 'circle.lists.event_passed', { text: c.text ?? c.id }), type: c.type, done: true });
        }
      }
      return { ok: true, title: target.text ?? ref, items };
    },

    removeList: async (args, ctx) => {
      const circleId = circleOf(args);
      if (!circleId) return { ok: false, error: t('circle.lists.no_circle') };
      const ref = String(args?.list ?? '').trim();
      const target = ref ? await findList(circleId, ref) : null;
      if (!target) return { ok: false, error: t('circle.lists.no_such_list', { name: ref }) };
      // What goes: the list, and every item under it that has no parent left once it is gone (children of children
      // too). An item on another list as well is detached from this one and stays there.
      const store = svc.storeFor(circleId);
      const removing = [target.id];
      const gone = new Set(removing);
      const kept = new Set();
      for (let i = 0; i < removing.length; i++) {
        const parent = await store.get(removing[i]);
        for (const id of childIdsOf(parent)) {
          const child = await store.get(id);
          if (!child || gone.has(id)) continue;
          if ((Array.isArray(child.containedBy) ? child.containedBy : []).some((p) => !gone.has(p))) { kept.add(id); continue; }
          kept.delete(id); gone.add(id); removing.push(id);
        }
      }
      const items = (await Promise.all(removing.slice(1).map((id) => store.get(id)))).filter(Boolean);
      const chores = items.filter((i) => i.type === 'task');
      const held = chores.filter((c) => (Array.isArray(c.assignees) && c.assignees.length) || c.assignee).length;
      const vars = { list: target.text ?? ref, entries: items.length - chores.length, chores: chores.length, held, kept: kept.size };
      // the confirm asks with the counts: a read, through the same gate as the removal
      if (args?.preview) {
        const what = [
          ...(vars.entries ? [t('circle.lists.remove_count_entries', { count: vars.entries })] : []),
          ...(vars.chores ? [`${t('circle.lists.remove_count_chores', { count: vars.chores })}${held ? ` (${t('circle.lists.remove_count_held', { count: held })})` : ''}`] : []),
        ];
        const ask = what.length ? t('circle.lists.remove_list_confirm_counts', { list: vars.list, what: what.join(', ') }) : t('circle.lists.remove_list_confirm', { list: vars.list });
        return { ok: true, vars, message: vars.kept ? `${ask} ${t('circle.lists.remove_count_kept', { count: vars.kept })}` : ask };
      }
      // kept aside, whole, so it can be put back for a while: the list first, then what went with it
      const whole = (await Promise.all(removing.map((id) => store.get(id)))).filter(Boolean);
      await store.put({
        id: `removed-list-${target.id}`, type: 'removed-list', listId: target.id, name: String(target.text ?? ref),
        removedAt: now(), removedBy: ctx?.caller ?? null, items: whole, keptIds: [...kept],
      }, { by: ctx?.caller ?? localActor });
      for (const id of removing) await deleteContainer(store, id);
      await dropExpired(circleId);
      return { ok: true, message: t('circle.lists.list_removed', { name: target.text ?? ref, days: REMOVED_LIST_KEEP_DAYS }), vars };
    },

    /**
     * Put a removed list back (`/list-restore Feest`): its lines, chores and appointments under their own ids, and an item
     * that stayed on another list linked to it again. Without a name: what can come back, a button each.
     */
    restoreList: async (args, ctx) => {
      const circleId = circleOf(args);
      if (!circleId) return { ok: false, error: t('circle.lists.no_circle') };
      await dropExpired(circleId);
      const removed = (await removedOf(circleId)).sort((a, b) => b.removedAt - a.removedAt);
      const ref = String(args?.list ?? '').trim();
      if (!ref) {
        if (!removed.length) return { ok: true, message: t('circle.lists.restore_none'), quickReplies: [] };
        return {
          ok: true,
          message: [t('circle.lists.restore_offer'), ...removed.map((r) => `· ${r.name}`)].join('\n'),
          quickReplies: removed.map((r) => ({ label: r.name, slash: `/list-restore ${r.name}` })),
        };
      }
      const want = ref.toLowerCase();
      const rec = removed.find((r) => r.name.toLowerCase() === want) ?? removed.find((r) => r.name.toLowerCase().includes(want));
      if (!rec) return { ok: false, error: t('circle.lists.restore_not_found', { name: ref }), code: 'not-found' };
      if (await findList(circleId, rec.name)) return { ok: false, error: t('circle.lists.restore_name_taken', { name: rec.name }) };
      const store = svc.storeFor(circleId);
      for (const item of rec.items) await store.put(item, { by: ctx?.caller ?? localActor });
      for (const id of rec.keptIds ?? []) if (await store.get(id)) await contain(store, rec.listId, id);
      await store.delete(rec.id);
      return { ok: true, message: t('circle.lists.list_restored', { name: rec.name, count: rec.items.length - 1 }) };
    },

    removeFromList: async (args) => {
      const at = await locate(args);
      if (at.error) return { ok: false, error: at.error, ...(at.notFound ? { code: 'not-found' } : {}) };
      await svc.remove(at.circleId, at.entry.id);
      return { ok: true, message: t('circle.lists.removed', { text: at.entry.text ?? '', name: at.target.text ?? '' }) };
    },

    editEntry: async (args) => {
      const text = String(args?.text ?? '').trim();
      // a new time: an appointment moves (keeping its length), a chore gets a new due — the line's time, as its words
      const when = args?.when ? parseDateInput(args.when) : null;
      if (args?.when && !when) return { ok: false, error: t('circle.lists.need_list_and_text') };
      if (!text && !when) return { ok: false, error: t('circle.lists.need_list_and_text') };
      const at = await locate(args);
      if (at.error) return { ok: false, error: at.error, ...(at.notFound ? { code: 'not-found' } : {}) };
      const timed = {};
      if (when && at.entry.type === 'calendar-event') {
        const length = Math.max(0, new Date(at.entry.endsAt ?? at.entry.startsAt).getTime() - new Date(at.entry.startsAt).getTime());
        Object.assign(timed, { startsAt: when, endsAt: new Date(new Date(when).getTime() + (length || 3_600_000)).toISOString() });
      } else if (when) {
        Object.assign(timed, { dueAt: when });
      }
      const words = text || at.entry.text || at.entry.title || '';
      await svc.storeFor(at.circleId).put({ ...at.entry, ...(text ? { text, ...(at.entry.type === 'calendar-event' ? { title: text } : {}) } : {}), ...timed }, { by: localActor });
      return { ok: true, message: t('circle.lists.edited', { text: words, name: at.target.text ?? '' }) };
    },

    /**
     * The reminders everyone it is for gets for one entry, in a person's words; "gewoon" drops them (the usual ones
     * apply again). The household's statement about the item, so it syncs like its words.
     */
    entryReminders: async (args) => {
      const words = String(args?.reminders ?? '').trim();
      const usual = /^(gewoon|normaal|usual|normal)$/i.test(words);
      const reminders = usual ? null : reminderLayerFromWords(words);
      if (!usual && !reminders) return { ok: false, error: t('circle.bot.reminders_usage') };
      const at = await locate(args);
      if (at.error) return { ok: false, error: at.error, ...(at.notFound ? { code: 'not-found' } : {}) };
      const { reminders: _old, ...entry } = at.entry;
      await svc.storeFor(at.circleId).put(reminders ? { ...entry, reminders } : entry, { by: localActor });
      const name = at.entry.text ?? at.entry.title ?? '';
      return { ok: true, message: reminders ? t('circle.lists.reminders_set', { text: name, rules: describeRules(reminders.rules, t) + (reminders.mode === 'add' ? ` (${t('circle.lists.reminders_on_top')})` : '') }) : t('circle.lists.reminders_usual', { text: name }) };
    },

    /** The service itself, for a screen that projects containers (a read, not a second write path). */
    _service: svc,
  };
}

export default makeListsOps;
