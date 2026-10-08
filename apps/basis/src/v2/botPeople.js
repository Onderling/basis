/**
 * botPeople — the bot's people as ROWS, under the household's names ceiling: the one read (`assistant-users`) the chat's
 * `/users` text and a screen's people both paint, and the source a "who" field picks from.
 *
 * The label follows `mayNamePeople` (the same rule the chores read and the add apply): the admin sees names — or the ids
 * under `names: none`, their own choice, as the ids are theirs (they admitted them); anyone else is never shown a row
 * they may not name: it is left out, not shown by id (a `telegram:<uid>` is another person's identifier, not a label).
 */
import { mayNamePeople, namesPolicyFrom } from './botSettings.js';
import { buildStandardRolePolicy } from '@onderling-app/tasks';

/**
 * @param {object} a
 * @param {Array<{id: string, displayName?: string|null, role?: string|null, pubKey?: string|null}>} a.rows  the book
 * @param {unknown} a.setting   the household's names setting (`assistant.names`)
 * @param {string|null} a.callerId  who reads (the door's person)
 * @returns {Array<{id: string, label: string, role: string|null, linked: boolean}>}
 */
export function peopleRows({ rows, setting, callerId }) {
  const list = (rows ?? []).filter((r) => r?.id);
  const roles = Object.fromEntries(list.filter((r) => r.role).map((r) => [r.id, r.role]));
  const callerRole = callerId ? (roles[callerId] ?? null) : 'admin';
  const roleMayAssign = callerId ? buildStandardRolePolicy(roles).canReassign(callerId) : true;
  const mayName = mayNamePeople({ setting, callerId, callerRole, roleMayAssign });
  const out = [];
  for (const r of list) {
    // one's own row is named — except under `names: none`, where no name leaves the bot at all
    const own = r.id === callerId && namesPolicyFrom(setting) !== 'none';
    const named = own || mayName;
    if (!named && callerRole !== 'admin') continue;          // left out, never shown by id
    out.push({ id: r.id, label: named ? (r.displayName || r.id) : r.id, role: r.role ?? null, linked: Boolean(r.linkedRoot) });
  }
  return out;
}
