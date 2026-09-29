/**
 * householdTemplate — the lists a household bot starts with: Boodschappen · Klusjes · Reparaties · Agenda.
 *
 * Household's four "lists" were app-local item types (shopping · errand · repair · schedule) and its chores a copy of
 * the tasks app. They are lists of the lists feature now: the bot makes the four on its FIRST start — when it has no
 * lists at all — through the lists ops on its own waist, and Klusjes makes a task when a bare add names no kind. A list
 * someone later deletes or renames is not made again: the template is a start, not a rule.
 */

/** The template: the locale key of each list's name, and what a bare add to it makes. */
export const HOUSEHOLD_LISTS = Object.freeze([
  { key: 'circle.lists.template.shopping' },
  { key: 'circle.lists.template.chores', defaultChild: 'task' },
  { key: 'circle.lists.template.repairs' },
  { key: 'circle.lists.template.schedule' },
]);

/**
 * Make the household's lists when the bot has none.
 * @param {object} a
 * @param {(app: string, op: string, args: object) => Promise<any>} a.callSkill  the bot's own (owner) callSkill
 * @param {(key: string) => string} a.t
 * @returns {Promise<string[]>} the names of the lists made (none when any list already existed)
 */
export async function ensureHouseholdLists({ callSkill, t }) {
  const r = await callSkill('lists', 'listLists', {});
  const existing = Array.isArray(r?.items) ? r.items : Array.isArray(r?.lists) ? r.lists : Array.isArray(r) ? r : [];
  if (r?.ok === false || existing.length) return [];
  const made = [];
  for (const { key, defaultChild } of HOUSEHOLD_LISTS) {
    const name = t(key);
    const res = await callSkill('lists', 'createList', { text: name, ...(defaultChild ? { defaultChild } : {}) });
    if (res?.ok !== false) made.push(name);
  }
  return made;
}
