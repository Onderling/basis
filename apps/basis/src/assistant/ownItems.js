/**
 * What the person's own assistant may READ for a line: their OWN notes, appointments and own lists' entries, each with
 * its words, shaped for the retriever (`{id, type, text}`). Every read goes through `call`, the shell's call AS the self
 * ticked in the "+" (the waist's `actAs`): the own lists are read as that self by the agent. The own notes' and the own
 * agenda's routes answer every self's rows at once (the Vandaag blocks show all ticked selves and mark each row's maker),
 * so those rows are cut here to the ticked self's, by the row's maker, as the blocks decide a maker: a persona's note or
 * appointment never reaches another self's model. A source that fails contributes nothing.
 */
import { encodeGenericOpId } from '@onderling/app-manifest';
import { OWN_DEVICES_SCOPE } from '../v2/grantsManifest.js';

const OWN = OWN_DEVICES_SCOPE;
const words = (v) => (typeof v === 'string' ? v.trim() : '');
const itemsOf = (r) => (Array.isArray(r?.items) ? r.items : Array.isArray(r?.notes) ? r.notes : Array.isArray(r?.events) ? r.events : Array.isArray(r) ? r : []);

/**
 * @param {object} a
 * @param {(app: string, opId: string, args: object) => Promise<any>} a.call   the call as the ticked self
 * @param {{key: string|null, isDefault: boolean}} a.self   the ticked self: its key, and whether it is the general self
 * @returns {() => Promise<Array<{id: string, type: string, text: string}>>}
 */
/**
 * The routes that answer EVERY self's rows on the own scope (until the agent reads them per self, as it does lists): the
 * own agenda and the own notes. Their rows are cut to the ticked self here, by the one rule below, on every path that
 * reads them for the assistant (this reader, and a read the model picks). The own lists' route reads as the self.
 */
export const EVERY_SELF_ROUTES = Object.freeze(new Set(['calendar', 'household']));

/**
 * Is this row the ticked self's? The general self's when it names no persona's key (as the Vandaag blocks decide a
 * maker), else the persona's own key.
 * @param {{key: string|null, isDefault: boolean}} self
 */
export const rowIsSelfs = (self) => (n) => (self?.isDefault
  ? n?.createdBy == null || n.createdBy === 'me' || n.createdBy === self.key
  : n?.createdBy === self?.key);

/**
 * A route's answer cut to the ticked self, when the route answers every self (`EVERY_SELF_ROUTES`); else as it came.
 * @param {string} app @param {any} result  the op's result (`{items}`) @param {{key, isDefault}} self
 */
export function cutToSelf(app, result, self) {
  if (!EVERY_SELF_ROUTES.has(app) || !Array.isArray(result?.items)) return result;
  return { ...result, items: result.items.filter(rowIsSelfs(self)) };
}

export function loadOwnItems({ call, self = { key: null, isDefault: true } } = {}) {
  const mine = rowIsSelfs(self);
  const read = async (app, opId, args) => { try { return itemsOf(await call(app, opId, { circleId: OWN, ...args })); } catch { return []; } };
  return async () => {
    if (typeof call !== 'function') return [];
    const [notes, events, lists] = await Promise.all([
      read('household', encodeGenericOpId('household', 'list', 'note'), {}),
      read('calendar', 'listEvents', {}),
      read('lists', 'listLists', {}),
    ]);
    const entries = (await Promise.all(lists.map(async (l) => {
      const name = words(l.label ?? l.text ?? l.name);
      if (!name) return [];
      return (await read('lists', 'listEntries', { list: name })).map((e) => ({ e, name }));
    }))).flat();
    return [
      ...notes.filter(mine).map((n) => ({ id: String(n.id ?? ''), type: 'note', text: words(n.body ?? n.text ?? n.label) })),
      ...events.filter(mine).map((ev) => ({ id: String(ev.id ?? ''), type: 'calendar-event', text: [words(ev.title ?? ev.text ?? ev.label), words(ev.when ?? ev.startsAt ?? '')].filter(Boolean).join(' · ') })),
      ...entries.map(({ e, name }) => ({ id: String(e.id ?? ''), type: 'list-item', text: `${name}: ${words(e.text ?? e.label)}${e.done === true ? ' (done)' : ''}` })),
    ].filter((i) => i.text);
  };
}
