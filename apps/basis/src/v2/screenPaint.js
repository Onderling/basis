/**
 * screenPaint — what a connected screen paints: the ops its grant names, grouped the way `/help` groups them (lists,
 * chores, the agenda, the person's own settings, the admin's last), each with its person-facing line, its params
 * (a form when it has any), and whether the surface must ask first (the op's declared confirm — the waist does not ask).
 * The manifests are the screen's own imports (the bot's door catalogue), filtered by the grant. Pure.
 */

import { composeAssistantCatalogue } from '../telegram/assistantCatalogue.js';
import { botOpLevel } from './botOpMap.js';

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
