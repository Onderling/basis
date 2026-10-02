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

const SECTION_OF = { lists: 'lists', tasks: 'chores', calendar: 'agenda', assistant: 'you' };
const ORDER = ['lists', 'chores', 'agenda', 'you', 'admin'];

/**
 * @param {object} a
 * @param {string[]} a.ops  the granted ops (`app.op`)
 * @param {{opsById: Map}} a.catalogue  the bot's door catalogue (its manifests, as the screen imports them)
 * @param {(entry: object) => boolean} [a.isAdmin]  is this op the admin's
 * @param {(key: string, params?: object) => string} a.t
 * @returns {Array<{section: string, title: string, items: Array<{skill: string, appOrigin: string, opId: string, label: string,
 *   params: object[], needsForm: boolean, confirm: object|null}>}>}
 */
export function screenPanels({ ops, catalogue, isAdmin = () => false, t }) {
  const byKey = new Map();
  for (const [, entry] of catalogue?.opsById ?? []) {
    if (entry?.appOrigin && entry?.op?.id) byKey.set(`${entry.appOrigin}.${entry.op.id}`, entry);
  }
  const groups = new Map(ORDER.map((s) => [s, []]));
  for (const skill of ops ?? []) {
    const entry = byKey.get(skill);
    if (!entry) continue;   // an op the screen's code does not know: not painted (a received manifest is a later step)
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
    });
  }
  return ORDER.filter((s) => groups.get(s).length).map((s) => ({ section: s, title: t(`circle.bot.help.sections.${s}`), items: groups.get(s) }));
}


/** The panels for a grant, from the bot's door catalogue as the screen's code knows it (a household bot's apps). */
export function screenPanelsForGrant(ops, t) {
  const { catalogue } = composeAssistantCatalogue({ apps: ['lists', 'tasks', 'calendar'], slim: true });
  const isAdmin = (entry) => (entry.appOrigin === 'assistant' ? entry.op?.visibility === 'trusted' : botOpLevel(entry.op?.id) === 'trusted');
  return screenPanels({ ops, catalogue, isAdmin, t });
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
