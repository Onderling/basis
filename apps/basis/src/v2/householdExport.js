/**
 * householdExport — a household's data as ONE file that a later version can still read.
 *
 * The rule here is "no backwards compatibility" (stores and wire may break freely); this file is its one exception
 * (Frits, 2026-09-30). What makes it version-proof is where it stands: it is WRITTEN from the dictionary's public
 * fields (a list, its entries, a chore, an appointment — nothing store-internal) and READ BACK by the ordinary ops
 * (`createList`, `addToList`, `addEvent`, the tick, the rsvp), each called as the person it was — the host vouches, as
 * its door does. A store layout can change under it; the ops' contract is what it depends on, and a checked-in v1
 * file that must keep importing (`test/fixtures/household-export-v1.json`) holds us to it.
 *
 * Not in the file: a person's thread with the bot (theirs, sealed to the bot), the reminder marks, creation times,
 * ids. Containment is the nesting; an entry on a second list is referred to by its number in the file.
 */
import { childIdsOf } from '@onderling/item-store';

export const EXPORT_FORMAT = 'onderling-household-export';
export const EXPORT_VERSION = 1;

const CONTAINERS = new Set(['list', 'board']);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length)));
const holdersOf = (it) => [...new Set([...(Array.isArray(it.assignees) ? it.assignees : []), it.assignee].filter(Boolean))];

/** One entry by its public fields — the dictionary's, by type. */
function entryOf(it) {
  const done = it.completedAt ? { completedAt: new Date(it.completedAt).toISOString(), completedBy: it.completedBy ?? undefined } : {};
  if (it.type === 'calendar-event') {
    return clean({
      type: 'calendar-event', title: it.title ?? it.text ?? '', startsAt: it.startsAt, endsAt: it.endsAt,
      createdBy: it.createdBy, rsvp: it.rsvp && Object.keys(it.rsvp).length ? { ...it.rsvp } : undefined,
      cancelled: it.state === 'cancelled' ? true : undefined, ...done,
    });
  }
  if (it.type === 'task') {
    return clean({ type: 'task', text: it.text ?? it.title ?? '', holders: holdersOf(it), dueAt: it.dueAt, createdBy: it.createdBy, ...done });
  }
  return clean({ type: it.type || 'list-item', text: it.text ?? '', createdBy: it.createdBy, ...done });
}

/**
 * The file, from the household's items (the circle's store, as it is), its people and its settings. Pure.
 * @param {object} a
 * @param {object[]} a.items  every item of the household's circle store
 * @param {Array<{id: string, channel?: string, uid?: string, role?: string, displayName?: string}>} [a.people]
 * @param {Record<string, any>} [a.settings]  the household's own settings (`assistant.*`)
 * @param {number} [a.now]
 */
export function exportHousehold({ items = [], people = [], settings = {}, now = Date.now() } = {}) {
  const byId = new Map(items.filter(Boolean).map((i) => [i.id, i]));
  const numberOf = new Map();   // item id → its number in the file (the first place it is written)
  let next = 1;
  const write = (item) => {
    if (numberOf.has(item.id)) return { ref: numberOf.get(item.id) };
    const n = next++;
    numberOf.set(item.id, n);
    const children = childIdsOf(item).map((id) => byId.get(id)).filter(Boolean).map(write);
    return { n, ...entryOf(item), ...(children.length ? { children } : {}) };
  };
  const lists = items.filter((i) => i && CONTAINERS.has(i.type)).map((l) => {
    numberOf.set(l.id, next++);
    return clean({ n: numberOf.get(l.id), name: l.text ?? '', kind: l.type === 'board' ? 'board' : undefined, defaultChild: l.defaultChild, entries: childIdsOf(l).map((id) => byId.get(id)).filter(Boolean).map(write) });
  });
  // what sits on no list (a chore added without one): kept, beside the lists
  const loose = items.filter((i) => i && !CONTAINERS.has(i.type) && !numberOf.has(i.id) && !(Array.isArray(i.containedBy) && i.containedBy.length)).map(write);
  return {
    format: EXPORT_FORMAT, v: EXPORT_VERSION, exportedAt: new Date(now).toISOString(),
    lists, loose,
    people: people.filter((p) => p?.id).map((p) => clean({ id: p.id, channel: p.channel, uid: p.uid, role: p.role, displayName: p.displayName })),
    settings: { ...settings },
    knowledge: [],
  };
}

/** Is this a file this version can read? `{ok}` or `{ok: false, reason}`. */
export function checkExport(file) {
  if (!file || typeof file !== 'object' || file.format !== EXPORT_FORMAT) return { ok: false, reason: 'not-an-export' };
  if (file.v !== 1) return { ok: false, reason: 'unknown-version' };
  return { ok: true };
}

/** What a file holds, counted — for the question before an import. */
export function countExport(file) {
  const c = { lists: 0, entries: 0, chores: 0, appointments: 0, people: (file?.people ?? []).length };
  const walk = (e) => {
    if (!e || e.ref) return;
    if (e.type === 'task') c.chores += 1; else if (e.type === 'calendar-event') c.appointments += 1; else c.entries += 1;
    for (const ch of e.children ?? []) walk(ch);
  };
  for (const l of file?.lists ?? []) { c.lists += 1; for (const e of l.entries ?? []) walk(e); }
  for (const e of file?.loose ?? []) walk(e);
  return c;
}

/**
 * Read a file back, through the ops. Returns what was restored and what was not (said, never silently dropped).
 * @param {object} file
 * @param {object} a
 * @param {(app: string, op: string, args: object, ctx?: object) => Promise<any>} a.call  the host's call: without a
 *        caller it is the host's own write; with `ctx.caller` the gate vouches for that person, as a door does
 * @param {(id: string, role: string) => Promise<void>} [a.tier]  put a restored person in the gate (their role)
 */
export async function importHousehold(file, { call, tier = null } = {}) {
  const checked = checkExport(file);
  if (!checked.ok) return { ok: false, reason: checked.reason };
  const done = { lists: 0, entries: 0, chores: 0, appointments: 0, people: 0, settings: 0 };
  const notRestored = [];
  // A write is made AS a person the file names among its people (the gate vouches for them); anyone else — the
  // host's own placeholder, a person no longer in the book — is the host's own write.
  const known = new Set((file.people ?? []).map((p) => p?.id).filter(Boolean));
  const as = (who, app, op, args) => (who && known.has(who)
    ? call(app, op, { ...args, actor: who }, { caller: who })
    : call(app, op, args));

  for (const p of file.people ?? []) {
    // the people, the settings and the lists are the HOST's own writes (the book, the register, the containers):
    // no door caller — as the box writes them itself; each entry after is written as its person
    const r = await call('stoop', 'addContact', clean({ webid: p.id, channel: p.channel, role: p.role, displayName: p.displayName }));
    if (r?.ok === false) { notRestored.push({ what: 'person', id: p.id, why: r.error ?? 'refused' }); continue; }
    if (typeof tier === 'function' && p.role) await tier(p.id, p.role).catch(() => {});
    done.people += 1;
  }
  for (const [key, value] of Object.entries(file.settings ?? {})) {
    const r = await call('params', 'set-param', { key, value });
    if (r?.ok === false) notRestored.push({ what: 'setting', key, why: r.error ?? 'refused' }); else done.settings += 1;
  }

  const existing = new Set((((await call('lists', 'listLists', {}))?.items) ?? []).map((l) => String(l.label ?? '').toLowerCase()));
  const addEntry = async (list, e) => {
    if (e.ref) { notRestored.push({ what: 'second-list', list, ref: e.ref }); return; }
    if (e.type === 'calendar-event') {
      const r = await as(e.createdBy, 'calendar', 'addEvent', clean({ title: e.title, when: e.startsAt, until: e.endsAt }));
      if (!r?.ok) { notRestored.push({ what: 'appointment', title: e.title, why: r?.error ?? 'refused' }); return; }
      for (const [who, answer] of Object.entries(e.rsvp ?? {})) {
        const op = { accepted: 'rsvpAccept', tentative: 'rsvpTentative', declined: 'rsvpDecline' }[answer];
        if (op) await as(who, 'calendar', op, { id: r.itemId });
      }
      if (e.cancelled) await as(e.createdBy, 'calendar', 'cancelEvent', { id: r.itemId });
      else if (e.completedAt) await as(e.completedBy, 'lists', 'markListItemDone', { item: r.itemId });
      done.appointments += 1;
      return;
    }
    if (e.type === 'task') {
      const holder = (e.holders ?? [])[0] ?? null;
      const due = e.dueAt ? localDay(e.dueAt) : undefined;
      const r = holder
        ? await as(holder, 'lists', 'addToList', clean({ list, text: e.text, assignee: 'mij', due }))
        : await as(null, 'lists', 'addToList', clean({ list, text: e.text, due }));
      if (!r?.ok) { notRestored.push({ what: 'chore', text: e.text, why: r?.error ?? 'refused' }); return; }
      if ((e.holders ?? []).length > 1) notRestored.push({ what: 'second-holder', text: e.text, holders: e.holders.slice(1) });
      if (e.completedAt && r.itemId) await as(e.completedBy ?? holder, 'tasks', 'completeTask', { id: r.itemId });
      for (const ch of e.children ?? []) notRestored.push({ what: 'sub-chore', text: ch.text ?? ch.title ?? '' });
      done.chores += 1;
      return;
    }
    const r = await as(e.createdBy, 'lists', 'addToList', { list, text: e.text });
    if (!r?.ok) { notRestored.push({ what: 'entry', text: e.text, why: r?.error ?? 'refused' }); return; }
    if (e.completedAt) await as(e.completedBy, 'lists', 'markListItemDone', { item: r.itemId ?? e.text, list });
    done.entries += 1;
  };

  for (const l of file.lists ?? []) {
    if (!existing.has(String(l.name ?? '').toLowerCase())) {
      const r = await call('lists', 'createList', clean({ text: l.name, defaultChild: l.defaultChild }));
      if (!r?.ok) { notRestored.push({ what: 'list', name: l.name, why: r?.error ?? 'refused' }); continue; }
      existing.add(String(l.name).toLowerCase());
      done.lists += 1;
    }
    for (const e of l.entries ?? []) await addEntry(l.name, e);
  }
  for (const e of file.loose ?? []) notRestored.push({ what: 'loose', text: e.text ?? e.title ?? '' });
  return { ok: true, done, notRestored };
}

/** A due moment as the household's own day ("YYYY-MM-DD" on the box's clock — the chore's `due` takes a day). */
function localDay(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
