/**
 * botOpMap — what a household bot offers, per person: the slim map.
 *
 * Three plugins, three concerns, no overlap, and the model never needs an app name: lists HOLD (make one, list them,
 * add to one, and an entry's done · remove · edit), tasks MOVE (a task's claim · complete · reassign · edit · remove,
 * and "mine"), the calendar keeps the Agenda's appointments (add · the coming days · rsvp; the admin cancels), and the
 * assistant's own ops set a person's thread. "Zet melk op de lijst" is one op whatever the list;
 * "ik doe de lamp" is claimTask on a Klusjes child; "wat moet ik nog doen" is listMine.
 *
 * The map is the ONE declaration three things read: the box's catalogue (nothing else is composed), each thread's
 * tools (a member's column, or member + admin), and the host gate (an op's level; an op off the map is refused).
 * The tasks app's other ops (circles, availability, schedules, inboxes, subtask proposals) and household's item and
 * chore ops never reach the bot — the circle management is the basis door's, and household is a template now.
 */

/** Per role, the ops a thread offers. The admin's column is ADDED to the member's. */
import { STANDARD_ROLE_TABLE } from '@onderling-app/tasks';
export const BOT_OP_MAP = Object.freeze({
  member: Object.freeze([
    // making, removing and putting back a list are everyone's (Frits 2026-10-05: a removed list can come back 30 days)
    'listLists', 'createList', 'removeList', 'restoreList', 'listEntries', 'addToList', 'markListItemDone', 'removeFromList', 'editEntry',
    // a line becomes a chore when someone says who does it or when: anyone who may add may say that
    'makeChore',
    'listMine', 'claimTask', 'completeTask',
    'addEvent', 'listEvents', 'rsvpAccept', 'rsvpDecline', 'rsvpTentative', 'cancelEvent',
    'assistant-memory', 'assistant-language', 'assistant-reminders', 'assistant-overview', 'weekOverview',
  ]),
  admin: Object.freeze(['reassignTask', 'removeTask', 'editTask']),
  // An observer READS (core's role word: they look, they do not change): the member's reads and their own thread.
  observer: Object.freeze(['listLists', 'listEntries', 'listMine', 'listEvents', 'assistant-memory', 'assistant-language', 'assistant-overview', 'weekOverview', 'assistant-screen', 'assistant-screens', 'assistant-screen-confirm', 'assistant-screen-paste', 'assistant-menu', 'assistant-view', 'assistant-link', 'assistant-link-confirm', 'assistant-unlink', 'assistant-inapp']),
});

const MEMBER = new Set(BOT_OP_MAP.member);
const ADMIN = new Set(BOT_OP_MAP.admin);
/**
 * A coordinator's ops beyond the member's, READ from the tasks role table (one source: the bot's map and the chores'
 * own rule held this fact twice and disagreed — a coordinator could not move a chore on the bot, L198): moving a chore
 * (`reassign`), editing any (`editBody: 'any'`), removing one only where the table says so.
 */
const COORDINATOR_EXTRA = new Set([
  ...(STANDARD_ROLE_TABLE.coordinator?.reassign ? ['reassignTask'] : []),
  ...(STANDARD_ROLE_TABLE.coordinator?.editBody === 'any' ? ['editTask'] : []),
  ...(STANDARD_ROLE_TABLE.coordinator?.remove ? ['removeTask'] : []),
]);

/**
 * An op's level on the bot's door: `authenticated` (a member's), `trusted` (the admin's), or null — not on the map,
 * refused. The door's own admin ops declare their level themselves (`visibility` on the assistant manifest).
 * @param {string} opId
 * @returns {'authenticated'|'by-role'|null}  `by-role`: any admitted person passes the tier, the role decides
 */
export function botOpLevel(opId) {
  const id = String(opId ?? '').replace(/^[a-z-]+\//, '');   // a collision-prefixed id (`tasks/listOpen`) is its op
  if (MEMBER.has(id)) return 'authenticated';
  // the admin's data column: its ROLE decides (`botRoleAllows`, under the bot's roles preset); without a role rule the
  // door holds it to the admin (fail closed)
  if (ADMIN.has(id)) return 'by-role';
  return null;
}

const OBSERVER = new Set(BOT_OP_MAP.observer);

/**
 * Does this role reach this op, beyond its tier? Only an observer is narrowed (to the reads); the host gate asks it at
 * the waist, so an observer is refused an add however it is asked for — not only never shown the tool.
 * @param {string|null} role
 * @param {string} opId
 * @param {'standard'|'flat'} [preset]  the bot's `assistant.roles`
 */
export function botRoleAllows(role, opId, preset = 'standard') {
  const id = String(opId ?? '').replace(/^[a-z-]+\//, '');
  if (role === 'observer') return OBSERVER.has(id);
  if (!ADMIN.has(id) || role == null || role === 'admin') return true;
  // the admin's data column: everyone's but an observer's under `flat`; a coordinator's own share under `standard`
  if (preset === 'flat' && (role === 'member' || role === 'coordinator')) return true;
  return role === 'coordinator' && COORDINATOR_EXTRA.has(id);
}

/** Is this catalogue entry on the map at all (any role)? */
export const onBotMap = (opId) => botOpLevel(opId) !== null;

/**
 * The catalogue a thread sees: the ops its role reaches. The door's own ops without a chat surface (the admin's
 * slash commands) stay — they gate themselves at their declared level.
 * @param {object} catalogue  a merged catalogue (`opsById`, `commandMenu`)
 * @param {'member'|'admin'|null} role  null (the owner, no door caller) → everything on the map
 */
/** The door's own ops a household bot does not have: its plugins are its template's, so there is no app switch. */
const NOT_ON_A_BOT = new Set(['assistant-apps']);

/**
 * Does the bot offer this op to this role (`null`: the bot's whole map, any role)? One rule for narrowing a merged
 * catalogue and for narrowing an app's manifest before it is merged.
 * @param {string} appOrigin
 * @param {{id: string, visibility?: string}} op
 * @param {string|null} role
 */
export function botOffers(appOrigin, op, role, preset = 'standard') {
  const id = op?.id;
  // the door's own ops gate themselves at their declared level; an observer is narrowed to its column there too, and
  // the admin's own (`trusted`) are not offered to anyone else — their /help does not list what they cannot do
  if (appOrigin === 'assistant') {
    if (NOT_ON_A_BOT.has(id)) return false;
    if (role === 'observer') return botRoleAllows(role, id);
    return op?.visibility !== 'trusted' || role == null || role === 'admin';
  }
  if (!botOpLevel(id)) return false;
  // one rule for what a role reaches — the same the host gate asks
  return botRoleAllows(role, id, preset);
}

export function scopeCatalogueToRole(catalogue, role, preset = 'standard') {
  if (!catalogue || !catalogue.opsById || typeof catalogue.opsById.forEach !== 'function') return catalogue;
  const opsById = new Map();
  for (const [k, entry] of catalogue.opsById) if (botOffers(entry?.appOrigin, { ...(entry?.op ?? {}), id: entry?.op?.id ?? k }, role, preset)) opsById.set(k, entry);
  const commandMenu = Array.isArray(catalogue.commandMenu) ? narrowMenu(catalogue.commandMenu, opsById) : catalogue.commandMenu;
  return { ...catalogue, opsById, commandMenu };
}

/**
 * The command menu, narrowed to the ops kept. A command two apps declared is ambiguous in the merge (a bare entry with
 * choices, and a qualified `/app:command` per declarer); when the narrowing leaves ONE of them, the bare command is that
 * op again and its qualified form goes — the household's generated `/complete-task` beside the tasks one made the bare
 * command answer nothing on the bot. Left two or more, it stays ambiguous between those.
 */
function narrowMenu(menu, opsById) {
  const kept = menu.filter((e) => opsById.has(e?.opId));
  const settled = new Map();   // bare command → the one entry left
  const out = [];
  for (const e of menu) {
    if (!e?.ambiguous) continue;
    const live = (e.choices ?? []).map((c) => kept.find((k) => k.command === c.command)).filter(Boolean);
    if (live.length === 1) settled.set(e.command, live[0]);
  }
  const qualifiedOf = new Set([...settled.values()].map((k) => k.command));
  for (const e of menu) {
    if (e?.ambiguous) {
      const one = settled.get(e.command);
      if (one) out.push({ command: e.command, opId: one.opId, appOrigin: one.appOrigin, ...(one.body ? { body: one.body } : {}) });
      else {
        const live = (e.choices ?? []).filter((c) => kept.some((k) => k.command === c.command));
        if (live.length > 1) out.push({ ...e, choices: live });
      }
      continue;
    }
    if (!opsById.has(e?.opId) || qualifiedOf.has(e.command)) continue;
    out.push(e);
  }
  return out;
}

/**
 * What a person's model is told about the tools they do NOT have: a member asking to make a list gets "the admin does
 * that" rather than their words squeezed into another op. LLM-facing.
 * @param {'member'|'admin'|null} role
 * @param {(key: string) => string} [t]  the door's translator
 * @returns {string[]}
 */
export function roleHintsFor(role, t = null, preset = 'standard') {
  if (role == null || role === 'admin') return [];
  const notMine = BOT_OP_MAP.admin.filter((id) => !botRoleAllows(role, id, preset));
  if (!notMine.length) return [];
  // With the door's translator the model is handed the refusal itself, so the words are the locale's, not its own.
  const say = typeof t === 'function'
    ? `call no tool and reply with exactly this sentence, nothing more: "${t('circle.bot.admin_only')}"`
    : 'do not use another tool instead: reply that only the household\'s admin can do that, and stop there';
  return [`These are the household admin's, not this member's: ${notMine.join(', ')}. When the member asks for one of them, ${say}.`];
}

