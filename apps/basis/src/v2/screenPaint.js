/**
 * screenPaint — what a connected screen paints: the ops its grant names, grouped the way `/help` groups them (lists,
 * chores, the agenda, the person's own settings, the admin's last), each with its person-facing line, its params
 * (a form when it has any), and whether the surface must ask first (the op's declared confirm — the waist does not ask).
 * The manifests are the screen's own imports (the bot's door catalogue), filtered by the grant. Pure.
 */

import { composeAssistantCatalogue } from '../telegram/assistantCatalogue.js';
import { botOpLevel } from './botOpMap.js';
import { parseInput } from '../parser.js';
import { resolveDispatch } from '../router.js';
import { isLineOp } from './screenHousehold.js';

const SECTION_OF = { lists: 'lists', tasks: 'chores', calendar: 'agenda', assistant: 'you' };
const ORDER = ['lists', 'chores', 'agenda', 'you', 'admin'];
/** On a management screen the admin's things come first (Frits, 2026-10-04); `/help` keeps the admin's last. */
const SCREEN_ORDER = ['admin', 'lists', 'chores', 'agenda', 'you'];

/**
 * @param {object} a
 * @param {string[]} a.ops  the granted ops (`app.op`)
 * @param {{opsById: Map}} a.catalogue  the bot's door catalogue (its manifests, as the screen imports them)
 * @param {(entry: object) => boolean} [a.isAdmin]  is this op the admin's
 * @param {(key: string, params?: object) => string} a.t
 * @returns {Array<{section: string, title: string, items: Array<{skill: string, appOrigin: string, opId: string, label: string,
 *   params: object[], needsForm: boolean, confirm: object|null}>}>}
 */
export function screenPanels({ ops, catalogue, isAdmin = () => false, t, order = ORDER }) {
  const byKey = new Map();
  for (const [, entry] of catalogue?.opsById ?? []) {
    if (entry?.appOrigin && entry?.op?.id) byKey.set(`${entry.appOrigin}.${entry.op.id}`, entry);
  }
  const groups = new Map(order.map((s) => [s, []]));
  for (const skill of ops ?? []) {
    const entry = byKey.get(skill);
    if (!entry) continue;   // an op the screen's code does not know: not painted (a received manifest is a later step)
    if (isLineOp(entry.op)) continue;   // it lives on its line (the household section), never as a standalone form
    const { appOrigin, op } = entry;
    const key = `circle.bot.help.ops.${appOrigin}.${op.id}`;
    const line = t(key);
    const params = Array.isArray(op.params) ? op.params : [];
    groups.get(isAdmin(entry) ? 'admin' : (SECTION_OF[appOrigin] ?? 'you')).push({
      skill, appOrigin, opId: op.id,
      label: line && line !== key ? line : op.id,
      params,
      needsForm: params.some((p) => p?.required),
      confirm: op.surfaces?.ui?.confirm ?? null,
      // it changes something: the household on the screen is read again after it
      writes: Boolean(op.writes),
    });
  }
  return order.filter((s) => groups.get(s).length).map((s) => ({ section: s, title: t(`circle.bot.help.sections.${s}`), items: groups.get(s) }));
}


/** The panels for a grant, from the bot's door catalogue as the screen's code knows it (a household bot's apps). */
export function screenPanelsForGrant(ops, t) {
  const { catalogue } = composeAssistantCatalogue({ apps: ['lists', 'tasks', 'calendar'], slim: true });
  const isAdmin = (entry) => (entry.appOrigin === 'assistant' ? entry.op?.visibility === 'trusted' : botOpLevel(entry.op?.id) === 'trusted');
  return screenPanels({ ops, catalogue, isAdmin, t, order: SCREEN_ORDER });
}

/**
 * What fills in a field on the screen: the field's declared source (`pickerSource: {listOp, appOrigin}` on the op's
 * param — the read that lists its values) called through the screen's OWN grant, so it offers only what this person may
 * read. A read the screen holds no token for offers nothing (it is not asked). Each item: its id the value, its words
 * the label.
 * @param {{call: (skill: string, args: object) => Promise<any>, ops: () => string[], appOrigin: string}} a
 *   `appOrigin` — the field's own app, for a source that names none
 * @returns {(decl: {listOp: string, appOrigin?: string, filter?: object}) => Promise<Array<{id: string, label: string}>>}
 */
export function screenPickerFetcher({ call, ops, appOrigin }) {
  return async (decl) => {
    const skill = `${decl?.appOrigin ?? appOrigin}.${decl?.listOp}`;
    if (!decl?.listOp || !(ops() ?? []).includes(skill)) return [];
    const r = await call(skill, decl.filter && typeof decl.filter === 'object' ? { ...decl.filter } : {});
    const items = Array.isArray(r?.items) ? r.items : (Array.isArray(r?.entries) ? r.entries : (Array.isArray(r) ? r : []));
    return items
      .filter((i) => i && (i.id ?? i.webid) != null)
      .map((i) => ({ id: String(i.id ?? i.webid), label: String(i.label ?? i.text ?? i.title ?? i.name ?? i.id ?? i.webid) }));
  };
}

/**
 * An action on a row (a person's role, a chore's new holder) whose op asks more than the row knows: the form for the
 * rest, with what the row knows filled in — the dependent pick answered by context (Fable, the screen-fields brief).
 * Null when nothing is missing (the action runs as it is), or when the screen's code does not know the op.
 * @param {string} skill  `app.op`
 * @param {object} args   what the row fills in
 * @returns {{opId: string, appOrigin: string, params: object[], missing: string[], prefilled: object}|null}
 */
export function screenActionForm(skill, args = {}) {
  const [appOrigin, opId] = String(skill ?? '').split('.');
  let entry = null;
  for (const [, e] of catalogueForScreen().opsById ?? []) { if (e?.appOrigin === appOrigin && e?.op?.id === opId) { entry = e; break; } }
  if (!entry) return null;
  const params = Array.isArray(entry.op.params) ? entry.op.params : [];
  // what the form asks: the required, and what an op marks `ask` (optional at the waist — "words or a new time" — but
  // the thing a person edits on a screen)
  const missing = params.filter((p) => (p?.required || p?.ask) && (args?.[p.name] === undefined || args[p.name] === '')).map((p) => p.name);
  return missing.length ? { opId, appOrigin, params, missing, prefilled: { ...args } } : null;
}

/** The bot's catalogue as the screen's code knows it (its own manifests), composed once. */
let screenCatalogue = null;
const catalogueForScreen = () => (screenCatalogue ??= composeAssistantCatalogue({ apps: ['lists', 'tasks', 'calendar'], slim: true }).catalogue);

/**
 * A reply's quick replies as buttons on a screen. Each `{label, slash}` is resolved by the SCREEN's own parser over its
 * own manifests into an op and args — the bot's text is a menu, never something the screen runs as text. A button is
 * kept only when the screen holds a token for the op it resolves to (the screen ops, `/bevestig`, anything withheld
 * fall away); the call it makes is any other call of the screen's (its token, the door's gate, the step-up where
 * declared), and the op's own confirm rides along for the surface to ask.
 * @param {object|null} result  an op's answer (`quickReplies: [{label, slash}]`)
 * @param {string[]} ops  the skills this screen holds tokens for (`app.op`)
 * @returns {Array<{label: string, skill: string, args: object, confirm: object|null}>}
 */
export function screenReplies(result, ops) {
  const replies = Array.isArray(result?.quickReplies) ? result.quickReplies : [];
  if (!replies.length) return [];
  const catalogue = catalogueForScreen();
  const held = new Set(ops ?? []);
  const out = [];
  for (const r of replies) {
    const slash = typeof r?.slash === 'string' ? r.slash.trim() : '';
    if (!slash.startsWith('/')) continue;
    let route = null;
    try { route = resolveDispatch(parseInput(slash, catalogue, {}), catalogue); } catch { route = null; }
    if (!route || (route.kind !== 'ready' && route.kind !== 'needsConfirm')) continue;
    const entry = catalogue.opsById?.get?.(route.opId);
    const skill = `${entry?.appOrigin ?? route.appOrigin}.${entry?.op?.id ?? route.opId}`;
    if (!held.has(skill)) continue;
    out.push({ label: String(r.label ?? slash), skill, args: declaredArgs(route.args, entry?.op), confirm: entry?.op?.surfaces?.ui?.confirm ?? null });
  }
  return out;
}

// The words a slash leaves unsplit (`_match`) belong to the op's one param: a screen's call carries declared params only.
function declaredArgs(args, op) {
  const { _match, ...rest } = args ?? {};
  const params = Array.isArray(op?.params) ? op.params : [];
  const open = params.filter((p) => p?.name && rest[p.name] === undefined);
  if (typeof _match === 'string' && _match.trim() && open.length === 1) rest[open[0].name] = _match.trim();
  return rest;
}
