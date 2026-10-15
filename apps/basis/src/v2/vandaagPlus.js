/**
 * Vandaag's "+": an own note or an own appointment — the person's own items, in their own store (the own-devices
 * scope: carried to their other devices, never to a circle's members). One model both shells paint: the acts, their
 * fields, and the op each compiles to through the waist. Moving one into a circle later is the existing share act.
 */
import { encodeGenericOpId } from '@onderling/app-manifest';
import { OWN_DEVICES_SCOPE } from './grantsManifest.js';
import { getActiveScreen } from './userScreens.js';
import { readDayAndTime } from '../forms/parseDate.js';

/** The acts the "+" offers, in order; each field names its input kind and its words. */
export const PLUS_ACTS = Object.freeze([
  Object.freeze({ id: 'own-note', labelKey: 'circle.vandaag.plus_note',
    fields: Object.freeze([Object.freeze({ name: 'body', kind: 'text', labelKey: 'circle.vandaag.plus_note_ph' })]) }),
  Object.freeze({ id: 'own-appointment', labelKey: 'circle.vandaag.plus_appointment',
    fields: Object.freeze([
      Object.freeze({ name: 'title', kind: 'text', labelKey: 'circle.vandaag.plus_title_ph' }),
      Object.freeze({ name: 'when', kind: 'datetime', labelKey: 'circle.vandaag.plus_when' }),
    ]) }),
]);

const EMPTY = { error: 'circle.vandaag.plus_empty' };

/** A moment from what was filled in: a picker's "YYYY-MM-DDTHH:mm", or words ("morgen om 14:00", "vrijdag 10:30") read
 *  by the one bounded reader; a day without a time is that day at nine. Null when it cannot be read. */
function momentOf(text) {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) { const d = new Date(text); return Number.isNaN(d.getTime()) ? null : d; }
  const r = readDayAndTime(text);
  if (!r?.day) return null;
  const d = new Date(`${r.day}T${r.time ?? '09:00'}`);
  return Number.isNaN(d.getTime()) ? null : d;
}
const word = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * The op an act compiles to, from what was filled in — or `{error}` (a locale key) when something is missing.
 * @param {string} actId
 * @param {Record<string, string>} values   a datetime is a picker's local "YYYY-MM-DDTHH:mm" or words ("morgen om 14:00")
 * @param {{asSelf?: string|null}} [o]   the self it is written as (the switcher's one ticked persona); none = the default
 * @returns {{app: string, opId: string, args: object}|{error: string}}
 */
export function plusOp(actId, values = {}, { asSelf = null } = {}) {
  if (actId === 'own-note') {
    const body = word(values.body);
    // written as a persona, it rides that persona's own lane (its other devices, never the default's)
    return body ? { app: 'household', opId: encodeGenericOpId('household', 'add', 'note'), args: { circleId: OWN_DEVICES_SCOPE, body, ...(asSelf && asSelf !== 'default' ? { asSelf } : {}) } } : EMPTY;
  }
  if (actId === 'own-appointment') {
    const title = word(values.title);
    if (!title || !word(values.when)) return EMPTY;
    const at = momentOf(word(values.when));
    if (!at) return { error: 'circle.vandaag.plus_when_unread' };
    // no circle: the agent files it in the person's own agenda
    return { app: 'calendar', opId: 'addEvent', args: { title, when: at.toISOString() } };
  }
  return EMPTY;
}

/** The block that shows what each act makes. */
const SHOWN_BY = Object.freeze({ 'own-note': 'notes', 'own-appointment': 'calendar' });

/**
 * After a save: when the active page has no block showing what was just made, the screen op that adds one (so the
 * person sees their note; it is an ordinary, undoable page change) — or null.
 * @param {object} book   the screens book
 * @param {string} actId
 * @returns {{opId: string, args: object}|null}
 */
export function plusFollowUp(book, actId) {
  const type = SHOWN_BY[actId];
  const page = getActiveScreen(book ?? {});
  if (!type || !page) return null;
  if ((page.blocks ?? []).some((b) => b?.type === type)) return null;
  return { opId: 'screen-add-block', args: { pageId: page.id, type, config: { limit: 5 } } };
}
