/**
 * What the person's own assistant may READ for a line: their OWN notes, appointments and own lists' entries, each with
 * its words, shaped for the retriever (`{id, type, text}`). Every read goes through `call`, the shell's call AS the self
 * ticked in the "+" (the waist's `actAs`): the own lists and the own agenda are read as that self by the agent. The own
 * notes' route answers every self's notes at once (the Vandaag notes block shows all ticked selves and marks each row's
 * maker), so the notes are cut here to the ticked self's, by the row's maker, as the block decides a maker: a persona's
 * notes never reach another self's model. A source that fails contributes nothing.
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
export function loadOwnItems({ call, self = { key: null, isDefault: true } } = {}) {
  // whose note a row is, as the screen's block reads it: the general self's when it names no persona's key
  const ownNote = (n) => (self.isDefault ? n.createdBy == null || n.createdBy === 'me' || n.createdBy === self.key : n.createdBy === self.key);
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
      ...notes.filter(ownNote).map((n) => ({ id: String(n.id ?? ''), type: 'note', text: words(n.body ?? n.text ?? n.label) })),
      ...events.map((ev) => ({ id: String(ev.id ?? ''), type: 'calendar-event', text: [words(ev.title ?? ev.text ?? ev.label), words(ev.when ?? ev.startsAt ?? '')].filter(Boolean).join(' · ') })),
      ...entries.map(({ e, name }) => ({ id: String(e.id ?? ''), type: 'list-item', text: `${name}: ${words(e.text ?? e.label)}${e.done === true ? ' (done)' : ''}` })),
    ].filter((i) => i.text);
  };
}
