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

/**
 * Is this op one that acts ON a line (Fable, the screen-fields brief)? It changes something, it names the type it applies to
 * (`appliesTo`), and it takes the line itself (`id` for a chore or an appointment, `item` on a list). Such an op lives on
 * the line — the screen paints it as the line's action, never as a standalone form; what else it takes (an edit's words,
 * a reassign's person) is asked in its form with the line filled in. An add (a list's new line, a new appointment) is not
 * one: it takes no line. ONE predicate, for the line's actions and for the screen's panels, so the two cannot disagree.
 * @param {object} op  a manifest op
 */
export function isLineOp(op) {
  const params = Array.isArray(op?.params) ? op.params : [];
  return Boolean(op?.appliesTo) && Boolean(op?.writes) && params.some((p) => p?.name === 'id' || p?.name === 'item');
}

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
    if (!isLineOp(op) || applies.type !== item?.type || !held.has(skill)) continue;
    if (Array.isArray(applies.state) && !applies.state.includes(stateOf(item))) continue;
    // the line fills what it can (its id, or its item and list); the rest is asked in the op's form on the screen
    const names = new Set((op.params ?? []).map((p) => p?.name));
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
    if (isLineOp(entry?.op)) out.push(entry.op.id);
  }
  return out;
}
