/**
 * screenHousehold — the household itself on a connected screen: the lists with their lines (shopping, chores with who
 * holds them, the appointments), and for the admin the people.
 *
 * Read through the read ops the screen holds — each the person's own call through the bot's gate, so their role, the
 * names setting and the settings apply as they do in the chat — never a mirror of the bot's history (which holds every
 * person's thread). A line's actions are its type's ops (`appliesTo`): only those the screen holds a token for, only
 * those its state takes, and only those a line can fill by itself (its id); an op that needs more words (reassign,
 * edit) stays a button with its form. Each action carries the op's own confirm, for the surface to ask.
 *
 * Pure composition over `call`: the shell paints what this returns, and reads again after an action or a nudge.
 */
import { composeAssistantCatalogue } from '../telegram/assistantCatalogue.js';

let catalogue = null;
const catalogueForScreen = () => (catalogue ??= composeAssistantCatalogue({ apps: ['lists', 'tasks', 'calendar'], slim: true }).catalogue);

// What a line can fill by itself: the id the read gave it (as `id` for a chore or an appointment, `item` on a list,
// with the list's name beside it). An op that takes any other word (an edit's text, a reassign's person) is a form.
const FROM_A_LINE = new Set(['id', 'item', 'list']);

/** A line's state as `appliesTo.state` names it: the read's own (a chore says open or claimed), else from who holds it. */
const stateOf = (item) => item?.state ?? (Array.isArray(item?.holders) && item.holders.length ? 'claimed' : 'open');

/** The actions a line of this type takes on this screen, filled from the line. */
function actionsFor(item, list, held, t) {
  if (item?.done) return [];
  const out = [];
  for (const [, entry] of catalogueForScreen().opsById ?? []) {
    const op = entry?.op;
    const skill = `${entry?.appOrigin}.${op?.id}`;
    const applies = op?.appliesTo;
    if (!applies || applies.type !== item?.type || !held.has(skill)) continue;
    if (!op.writes) continue;   // a read is not a line's action
    if (Array.isArray(applies.state) && !applies.state.includes(stateOf(item))) continue;
    const params = Array.isArray(op.params) ? op.params : [];
    if (params.some((p) => !FROM_A_LINE.has(p?.name))) continue;   // every word it takes comes from the line
    const names = new Set(params.map((p) => p?.name));
    const args = names.has('item') ? { item: item.id, ...(names.has('list') ? { list: list.title } : {}) } : { id: item.id };
    out.push({ skill, args, label: t(`circle.connectScreen.action.${op.id}`), confirm: op.surfaces?.ui?.confirm ?? null });
  }
  return out;
}

/**
 * @param {object} a
 * @param {(skill: string, args?: object) => Promise<object|null>} a.call  the screen's call (its token, the bot's gate)
 * @param {string[]} a.ops  the skills this screen holds tokens for
 * @param {(key: string, params?: object) => string} a.t
 * @returns {Promise<{lists: Array<{title: string, items: Array<{id: string, label: string, type: string, done: boolean, actions: object[]}>}>, people: Array<{id: string, label: string, role: string|null, linked: boolean, actions: object[]}>|null}>}
 */
export async function readHousehold({ call, ops, t }) {
  const held = new Set(ops ?? []);
  const lists = [];
  if (held.has('lists.listLists') && held.has('lists.listEntries')) {
    const all = await call('lists.listLists', {}).catch(() => null);
    for (const l of (Array.isArray(all?.items) ? all.items : [])) {
      const read = await call('lists.listEntries', { list: l.label }).catch(() => null);
      if (!read?.ok) continue;
      const list = { title: read.title ?? l.label, items: [] };
      for (const i of (Array.isArray(read.items) ? read.items : [])) {
        list.items.push({ id: i.id, label: i.label ?? i.id, type: i.type ?? null, done: Boolean(i.done), ...(i.yours ? { yours: true } : {}), actions: actionsFor(i, list, held, t) });
      }
      lists.push(list);
    }
  }
  // the people: the one read's rows (under the names ceiling), each with the actions this screen holds for a person
  let people = null;
  if (held.has('assistant.assistant-users')) {
    const r = await call('assistant.assistant-users', {}).catch(() => null);
    if (r?.ok !== false && Array.isArray(r?.items)) {
      people = r.items.map((p) => ({
        id: p.id, label: p.label, role: p.role ?? null, linked: Boolean(p.linked),
        actions: PERSON_ACTIONS.filter((skill) => held.has(skill)).map((skill) => ({
          skill, args: { who: p.id }, label: t(`circle.connectScreen.action.${skill.split('.').pop()}`),
        })),
      }));
    }
  }
  return { lists, people };
}

/** What a person's row carries on a screen (each the admin's; the rest of its params asked in a form). */
const PERSON_ACTIONS = Object.freeze(['assistant.assistant-role', 'assistant.assistant-revoke']);

/** The ops a line can carry as an action on a screen (each needs a short word: `circle.connectScreen.action.<op>`). */
export function lineActionOps() {
  const out = [];
  for (const [, entry] of catalogueForScreen().opsById ?? []) {
    const op = entry?.op;
    if (!op?.appliesTo || !op.writes) continue;
    const params = Array.isArray(op.params) ? op.params : [];
    if (params.some((p) => !FROM_A_LINE.has(p?.name))) continue;   // every word it takes comes from the line
    out.push(op.id);
  }
  return out;
}
