/**
 * householdTemplate — the lists a household bot starts with: Boodschappen · Klusjes · Reparaties · Agenda.
 *
 * Household's four "lists" were app-local item types (shopping · errand · repair · schedule) and its chores a copy of
 * the tasks app. They are lists of the lists feature now: the bot makes the four on its FIRST start — when it has no
 * lists at all — through the lists ops on its own waist, and Klusjes makes a task when a bare add names no kind. A list
 * someone later deletes or renames is not made again: the template is a start, not a rule.
 */

/**
 * The household TEMPLATE, as data: a composition of the plugins that exist (lists · tasks · calendar), not an app.
 * "Household" is the bot's name and this start — a "Tennisclub" template composes the same plugins with other lists
 * and other words.
 *   - `lists`   — the lists made on the first start: the locale key of each name, and what a bare add to it makes
 *                 (`defaultChild`, honoured only when the list type accepts that kind in this composition — the
 *                 Agenda's `calendar-event` once calendar is composed on the box);
 *   - `required` — the fields a new child of a kind must carry before it is added, per kind: none (Frits,
 *                 2026-09-29: "a chore is added as said"; who and when can be set later);
 *   - `promptLines` — what the model is told about this household's lists (LLM-facing).
 */
export const HOUSEHOLD_TEMPLATE = Object.freeze({
  id: 'household',
  lists: Object.freeze([
    { key: 'circle.lists.template.shopping' },
    { key: 'circle.lists.template.chores', defaultChild: 'task' },
    { key: 'circle.lists.template.repairs' },
    { key: 'circle.lists.template.schedule', defaultChild: 'calendar-event' },
  ]),
  required: Object.freeze({}),
  promptLines: Object.freeze([
    'This household keeps its things on LISTS. Add anything with addToList (the list by its name); a bare add makes what that list holds.',
    'Klusjes (chores) holds TASKS: a person claims one ("ik doe de lamp" → claimTask) and completes it; listMine shows theirs.',
    'Boodschappen (shopping) and Reparaties (repairs) hold plain entries; Agenda holds appointments.',
  ]),
});

/** The template's lists (kept as its own name for the callers that only make them). */
export const HOUSEHOLD_LISTS = HOUSEHOLD_TEMPLATE.lists;

/**
 * Make the household's lists when the bot has none.
 * @param {object} a
 * @param {(app: string, op: string, args: object) => Promise<any>} a.callSkill  the bot's own (owner) callSkill
 * @param {(key: string) => string} a.t
 * @returns {Promise<string[]>} the names of the lists made (none when any list already existed)
 */
export async function ensureHouseholdLists({ callSkill, t, template = HOUSEHOLD_TEMPLATE }) {
  const r = await callSkill('lists', 'listLists', {});
  const existing = Array.isArray(r?.items) ? r.items : Array.isArray(r?.lists) ? r.lists : Array.isArray(r) ? r : [];
  if (r?.ok === false || existing.length) return [];
  const made = [];
  for (const { key, defaultChild } of template.lists) {
    const name = t(key);
    const res = await callSkill('lists', 'createList', { text: name, ...(defaultChild ? { defaultChild } : {}) });
    if (res?.ok !== false) made.push(name);
  }
  return made;
}
