/**
 * botOpMap — what a household bot offers, per person: the slim map.
 *
 * Three plugins, three concerns, no overlap, and the model never needs an app name: lists HOLD (make one, list them,
 * add to one, and an entry's done · remove · edit), tasks MOVE (a task's claim · complete · reassign · edit · remove,
 * and "mine"), and the assistant's own ops set a person's thread. "Zet melk op de lijst" is one op whatever the list;
 * "ik doe de lamp" is claimTask on a Klusjes child; "wat moet ik nog doen" is listMine.
 *
 * The map is the ONE declaration three things read: the box's catalogue (nothing else is composed), each thread's
 * tools (a member's column, or member + admin), and the host gate (an op's level; an op off the map is refused).
 * The tasks app's other ops (circles, availability, schedules, inboxes, subtask proposals) and household's item and
 * chore ops never reach the bot — the circle management is the basis door's, and household is a template now.
 */

/** Per role, the ops a thread offers. The admin's column is ADDED to the member's. */
export const BOT_OP_MAP = Object.freeze({
  member: Object.freeze([
    'listLists', 'listEntries', 'addToList', 'markListItemDone', 'removeFromList', 'editEntry',
    'listMine', 'claimTask', 'completeTask',
    'assistant-memory', 'assistant-language',
  ]),
  admin: Object.freeze(['createList', 'reassignTask', 'removeTask', 'editTask']),
});

const MEMBER = new Set(BOT_OP_MAP.member);
const ADMIN = new Set(BOT_OP_MAP.admin);

/**
 * An op's level on the bot's door: `authenticated` (a member's), `trusted` (the admin's), or null — not on the map,
 * refused. The door's own admin ops declare their level themselves (`visibility` on the assistant manifest).
 * @param {string} opId
 * @returns {'authenticated'|'trusted'|null}
 */
export function botOpLevel(opId) {
  const id = String(opId ?? '').replace(/^[a-z-]+\//, '');   // a collision-prefixed id (`tasks/listOpen`) is its op
  if (MEMBER.has(id)) return 'authenticated';
  if (ADMIN.has(id)) return 'trusted';
  return null;
}

/** Is this catalogue entry on the map at all (any role)? */
export const onBotMap = (opId) => botOpLevel(opId) !== null;

/**
 * The catalogue a thread sees: the ops its role reaches. The door's own ops without a chat surface (the admin's
 * slash commands) stay — they gate themselves at their declared level.
 * @param {object} catalogue  a merged catalogue (`opsById`, `commandMenu`)
 * @param {'member'|'admin'|null} role  null (the owner, no door caller) → everything on the map
 */
export function scopeCatalogueToRole(catalogue, role) {
  if (!catalogue || !catalogue.opsById || typeof catalogue.opsById.forEach !== 'function') return catalogue;
  const allowed = (key, entry) => {
    const id = entry?.op?.id ?? key;
    if (entry?.appOrigin === 'assistant') return true;
    const level = botOpLevel(id);
    if (!level) return false;
    return level === 'authenticated' || role !== 'member';
  };
  const opsById = new Map();
  for (const [k, entry] of catalogue.opsById) if (allowed(k, entry)) opsById.set(k, entry);
  const commandMenu = Array.isArray(catalogue.commandMenu)
    ? catalogue.commandMenu.filter((e) => opsById.has(e?.opId))
    : catalogue.commandMenu;
  return { ...catalogue, opsById, commandMenu };
}
