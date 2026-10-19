/**
 * Vandaag's "+": an own note or an own appointment — the person's own items, in their own store (the own-devices
 * scope: carried to their other devices, never to a circle's members). One model both shells paint: the acts, their
 * fields, and the op each compiles to through the waist. Moving one into a circle later is the existing share act.
 */
import { OWN_DEVICES_SCOPE } from './grantsManifest.js';
import { getActiveScreen } from './userScreens.js';
import { readDayAndTime } from '../forms/parseDate.js';
import { nounWord } from './nounNames.js';
import { attachEntriesFor } from './attachEntries.js';
import { catalogueManifests } from './manifestSources.js';
import { renderGate } from '@onderling/app-manifest';

/**
 * The acts the "+" offers: the composed manifests' attach entries declared for the OWN scope (`surfaces.attach.scopes`,
 * a noun's `attach` included), through the same projection and filter a circle's composer uses (`attachEntriesFor`) —
 * so an app that declares an own-scope entry shows up here with no basis code. Each act: what it makes (its noun),
 * its fields, the op that adds it, and the ops that change and take it away.
 * @param {{manifestsByOrigin?: Record<string, object>}} [a]   default: the catalogue this app runs
 */
export function plusActs({ manifestsByOrigin } = {}) {
  const byOrigin = manifestsByOrigin ?? Object.fromEntries(catalogueManifests().filter((m) => m?.app).map((m) => [m.app, m]));
  return Object.freeze(attachEntriesFor({ manifestsByOrigin: byOrigin, scope: 'own' }).map((e) => Object.freeze({
    id: `${e.appOrigin}.${e.itemType ?? e.opId}`,
    appOrigin: e.appOrigin, opId: e.opId, noun: e.itemType ?? null,
    fields: Object.freeze((e.fields ?? (e.params ?? []).filter((p) => p.required).map((p) => ({ name: p.name, kind: p.kind === 'date' ? 'datetime' : 'text' })))
      .map((f) => Object.freeze({ ...f }))),
    ...(e.edit ? { edit: e.edit } : {}),
    ...(e.remove ? { remove: e.remove } : {}),
  })));
}

/** The acts on this device: the catalogue's own-scope entries. */
export const PLUS_ACTS = plusActs();

/**
 * An act's words ("Eigen afspraak"): basis's frame around the word the declaring manifest names its noun with.
 * @param {Function} t @param {{noun: string}} act
 */
export function plusLabel(t, act) { return t('circle.vandaag.plus_own', { noun: nounWord(t, act.noun) }); }

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
const actOf = (actId, acts = PLUS_ACTS) => acts.find((a) => a.id === actId) ?? null;

/** The args from what was filled in: every field, trimmed; a datetime read to an ISO moment — or `{error}`. */
function argsOf(act, values) {
  const args = {};
  for (const f of act.fields) {
    const v = word(values?.[f.name]);
    if (!v) return EMPTY;
    if (f.kind === 'datetime') {
      const at = momentOf(v);
      if (!at) return { error: 'circle.vandaag.plus_when_unread' };
      args[f.name] = at.toISOString();
    } else args[f.name] = v;
  }
  return { args };
}

/**
 * The op an act compiles to, from what was filled in — or `{error}` (a locale key) when something is missing.
 * Always on the OWN scope (named as the circle: the own route for a noun, the own agenda for the calendar).
 * @param {string} actId
 * @param {Record<string, string>} values   a datetime is a picker's local "YYYY-MM-DDTHH:mm" or words ("morgen om 14:00")
 * @returns {{app: string, opId: string, args: object}|{error: string}}
 *   (who it is made AS — the switcher's ticked self — is the call's, not the op's: the host passes `{ actAs }`)
 */
export function plusOp(actId, values = {}, { acts = PLUS_ACTS } = {}) {
  const act = actOf(actId, acts);
  if (!act) return EMPTY;
  const r = argsOf(act, values);
  if (r.error) return r;
  return { app: act.appOrigin, opId: act.opId, args: { circleId: OWN_DEVICES_SCOPE, ...r.args } };
}

/**
 * A row on Vandaag opening the sheet on itself: its act (by the row's noun), its words as made, its id — for an OWN
 * row only (a circle's row opens the circle's own actions; the sheet never edits a circle's item as if it were yours).
 * @param {{id: string, own?: boolean, circleId?: string|null, fields?: object, maker?: string|null}} row
 * @param {string} noun
 * @returns {{act: object, id: string, values: object, asSelf: string}|null}   `asSelf`: the self it is changed as
 */
export function plusEditFor(row, noun, { acts = PLUS_ACTS } = {}) {
  if (!row?.id || row.circleId || row.own === false) return null;
  // changed AS the self that made it: a row whose maker is not run here stays read-only
  if (row.maker === null) return null;
  const act = acts.find((a) => a.noun === noun) ?? null;
  if (!act || !act.edit) return null;
  const values = {};
  for (const f of act.fields) {
    const v = row.fields?.[f.name];
    if (v == null) continue;
    // a moment as the picker shows it (local "YYYY-MM-DDTHH:mm")
    if (f.kind === 'datetime') { const d = new Date(v); if (!Number.isNaN(d.getTime())) { const p = (n) => String(n).padStart(2, '0'); values[f.name] = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; continue; } }
    values[f.name] = String(v);
  }
  return { act, id: row.id, values, asSelf: row.maker ?? 'default' };
}

/** The change of an own item: the act's edit op with what was filled in — or `{error}`. */
export function plusSaveOp(actId, values = {}, { id, acts = PLUS_ACTS } = {}) {
  const act = actOf(actId, acts);
  if (!act?.edit || !id) return EMPTY;
  const r = argsOf(act, values);
  if (r.error) return r;
  return { app: act.appOrigin, opId: act.edit, args: { circleId: OWN_DEVICES_SCOPE, id, ...r.args } };
}

/** Taking an own item away: the act's remove op. */
export function plusRemoveOp(actId, { id, acts = PLUS_ACTS } = {}) {
  const act = actOf(actId, acts);
  if (!act?.remove || !id) return EMPTY;
  return { app: act.appOrigin, opId: act.remove, args: { circleId: OWN_DEVICES_SCOPE, id } };
}

/** The words an act's noun goes by, in every language its manifest names it ("notitie", "afspraak", "appointment"). */
function wordsFor(act, manifestsByOrigin) {
  const names = manifestsByOrigin?.[act.appOrigin]?.nouns?.[act.noun]?.names ?? {};
  return Object.values(names).flatMap((n) => [n?.one, n?.other]).filter((w) => typeof w === 'string' && w).map((w) => w.toLowerCase());
}
const catalogueByOrigin = () => Object.fromEntries(catalogueManifests().filter((m) => m?.app).map((m) => [m.app, m]));
const pickerMoment = (day, time) => `${day}T${time ?? '09:00'}`;

/**
 * THE FREE LINE at the top of the "+" sheet: what was typed, read by the same bounded readers the circle chat uses —
 * the manifests' gate rules, then the day-and-time reader and the noun's own word ("notitie: …", "afspraak morgen
 * 14:00 …"). Only the sheet's own acts may be chosen; a reading that names anything else is no reading (the fields stay
 * empty, the line as typed). The act compiles on the OWN scope (`plusOp`), so a line can never reach a circle.
 * @param {string} line
 * @returns {{actId: string, values: Record<string, string>}|null}
 */
export function plusRead(line, { acts = PLUS_ACTS, manifestsByOrigin, now } = {}) {
  const text = word(line);
  if (!text) return null;
  const byOrigin = manifestsByOrigin ?? catalogueByOrigin();
  // 1. the gate: an app's declared phrasing, accepted only when it names one of the sheet's acts
  const origins = new Set(acts.map((a) => a.appOrigin));
  for (const rule of renderGate(Object.values(byOrigin).filter((m) => origins.has(m?.app)))) {
    let cmd = null;
    try { cmd = rule.command(text); } catch { cmd = null; }
    const act = cmd && acts.find((a) => a.opId === cmd.opId && (!cmd.appOrigin || cmd.appOrigin === a.appOrigin));
    if (!act) continue;
    const values = {};
    for (const f of act.fields) if (cmd.args?.[f.name] != null) values[f.name] = String(cmd.args[f.name]);
    // a timed act whose phrasing left the moment in its words ("afspraak morgen 14:00 tandarts"): the day reader takes it out
    const dt = act.fields.find((f) => f.kind === 'datetime');
    const tf = act.fields.find((f) => f.kind !== 'datetime');
    if (dt && !values[dt.name] && tf && values[tf.name]) {
      const m = readDayAndTime(values[tf.name], now ? { now } : {});
      if (m?.day) { values[dt.name] = pickerMoment(m.day, m.time); values[tf.name] = word(m.rest ?? ''); if (!values[tf.name]) delete values[tf.name]; }
    }
    if (Object.keys(values).length) return { actId: act.id, values };
  }
  // 2. the noun's own word at the start names the act; the day-and-time reader takes a moment out of the rest
  const lower = text.toLowerCase();
  let act = null; let rest = text;
  for (const a of acts) {
    const w = wordsFor(a, byOrigin).find((x) => lower === x || lower.startsWith(`${x}:`) || lower.startsWith(`${x} `));
    if (w) { act = a; rest = text.slice(w.length).replace(/^[:\s]+/, ''); break; }
  }
  const timed = (a) => a.fields.some((f) => f.kind === 'datetime');
  const moment = readDayAndTime(rest, now ? { now } : {});
  if (!act && moment?.day) act = acts.find(timed) ?? null;
  if (!act) return null;
  const values = {};
  let words = rest;
  if (timed(act)) {
    if (moment?.day) { const f = act.fields.find((x) => x.kind === 'datetime'); values[f.name] = pickerMoment(moment.day, moment.time); words = moment.rest ?? ''; }
    for (const w of wordsFor(act, byOrigin)) words = words.replace(new RegExp(`^${w}\\b[:\\s]*`, 'i'), '');
  }
  const textField = act.fields.find((f) => f.kind !== 'datetime');
  if (textField && word(words)) values[textField.name] = word(words);
  return Object.keys(values).length ? { actId: act.id, values } : null;
}

/**
 * The free line read by a MODEL, when one is configured: asked with the sheet's acts (and their fields) and the own
 * scope only. Its answer is held to those bounds — an act outside them is no reading, a field it does not declare is
 * dropped — so a model can improve the reading, never widen it.
 * @param {string} line
 * @param {{ask: (line: string, bounds: {scope: string, acts: Array<{actId: string, fields: string[]}>}) => Promise<{actId: string, values: object}|null>}} a
 */
export async function plusReadWithModel(line, { ask, acts = PLUS_ACTS } = {}) {
  if (typeof ask !== 'function' || !word(line)) return null;
  let r = null;
  try { r = await ask(word(line), { scope: OWN_DEVICES_SCOPE, acts: acts.map((a) => ({ actId: a.id, fields: a.fields.map((f) => f.name) })) }); } catch { r = null; }
  const act = r && acts.find((a) => a.id === r.actId);
  if (!act) return null;
  const values = {};
  for (const f of act.fields) if (r.values?.[f.name] != null && word(String(r.values[f.name]))) values[f.name] = word(String(r.values[f.name]));
  return Object.keys(values).length ? { actId: act.id, values } : null;
}

/**
 * The model's side of the free line (LLM-facing, not a user string): pick one of the acts and fill its fields from the
 * line, or say none — nothing else, no circle, no other act.
 */
const PLUS_MODEL_SYSTEM = 'You read one short line a person typed to make something of their own. Choose at most ONE of the acts below '
  + 'and fill only its listed fields from the line; a moment field as local "YYYY-MM-DDTHH:mm". Answer with JSON only: '
  + '{"actId": "...", "values": {...}}, or {"actId": null} when no act fits. Never invent an act, a field, or a place to put it.';

/**
 * `ask` for `plusReadWithModel` over one model client: the line is the only thing sent (the acts and the own scope are
 * the bounds, in the instruction); the answer's JSON is read back, anything else is no reading.
 * @param {{invoke: Function}|null} client   the person's own model (`ownModelClient`), or null
 * @returns {Function|null}
 */
export function plusModelAsk(client) {
  if (!client || typeof client.invoke !== 'function') return null;
  return async (line, bounds) => {
    const acts = (bounds?.acts ?? []).map((a) => `- ${a.actId}: ${a.fields.join(', ')}`).join('\n');
    const now = new Date();
    const system = `${PLUS_MODEL_SYSTEM}\nScope: ${bounds?.scope}\nNow: ${now.toString()}\nActs:\n${acts}`;
    const res = await client.invoke({ system, messages: [{ role: 'user', content: line }] });
    const text = typeof res?.replyText === 'string' ? res.replyText : '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { const j = JSON.parse(m[0]); return j && typeof j.actId === 'string' ? { actId: j.actId, values: j.values ?? {} } : null; } catch { return null; }
  };
}

/** The block that shows what each noun makes. */
const SHOWN_BY = Object.freeze({ note: 'notes', 'calendar-event': 'calendar' });

/**
 * After a save: when the active page has no block showing what was just made, the screen op that adds one (so the
 * person sees their note; it is an ordinary, undoable page change) — or null.
 * @param {object} book   the screens book
 * @param {string} actId
 * @returns {{opId: string, args: object}|null}
 */
export function plusFollowUp(book, actId) {
  const type = SHOWN_BY[actOf(actId)?.noun];
  const page = getActiveScreen(book ?? {});
  if (!type || !page) return null;
  if ((page.blocks ?? []).some((b) => b?.type === type)) return null;
  return { opId: 'screen-add-block', args: { pageId: page.id, type, config: { limit: 5 } } };
}
