/**
 * householdTemplate — the lists a household bot starts with: Boodschappen · Klusjes · Reparaties · Agenda.
 *
 * Household's four "lists" were app-local item types (shopping · errand · repair · schedule) and its chores a copy of
 * the tasks app. They are lists of the lists feature now: the bot makes the four on its FIRST start — when it has no
 * lists at all — through the lists ops on its own waist, and Klusjes makes a task when a bare add names no kind. A list
 * someone later deletes or renames is not made again: the template is a start, not a rule.
 */

import { reminderPromptLines } from './botReminders.js';

/**
 * The household TEMPLATE, as data: a composition of the plugins that exist (lists · tasks · calendar), not an app.
 * "Household" is the bot's name and this start — a "Tennisclub" template composes the same plugins with other lists
 * and other words.
 *   - `lists`   — the lists made on the first start: the locale key of each name, the KIND of list it is (the words
 *                 people use for it — "boodschappen", "klusjes" — which the deterministic gate reads), and what a bare add to it makes
 *                 (`defaultChild`, honoured only when the list type accepts that kind in this composition — the
 *                 Agenda's `calendar-event` once calendar is composed on the box);
 *   - `required` — the fields a new child of a kind must carry before it is added, per kind: none (Frits,
 *                 2026-09-29: "a chore is added as said"; who and when can be set later);
 *   - `promptLines` — what the model is told about this household's lists (LLM-facing).
 */
export const HOUSEHOLD_TEMPLATE = Object.freeze({
  id: 'household',
  // Each list: its name (a locale key), its kind (the placeholder its name fills in the lines: `{shopping}` …), what a
  // bare add makes, and the words people use for it — the gate's aliases, read from here and nowhere else.
  lists: Object.freeze([
    { key: 'circle.lists.template.shopping', kind: 'shopping', aliases: Object.freeze(['boodschappen', 'boodschappenlijst', 'boodschappenlijstje', 'shopping', 'groceries', 'grocery']) },
    { key: 'circle.lists.template.chores', kind: 'errand', defaultChild: 'task', aliases: Object.freeze(['klusjes', 'klusje', 'klusjeslijst', 'takenlijst', 'errand', 'errands', 'chores']) },
    { key: 'circle.lists.template.repairs', kind: 'repair', aliases: Object.freeze(['reparaties', 'reparatie', 'repair', 'repairs']) },
    { key: 'circle.lists.template.schedule', kind: 'schedule', defaultChild: 'calendar-event', aliases: Object.freeze(['agenda', 'schedule', 'schedules']) },
  ]),
  // The plugins this template composes on the bot (added to its app list at every start): lists hold, tasks move, the
  // calendar keeps the Agenda.
  apps: Object.freeze(['lists', 'tasks', 'calendar']),
  // Fixed pairs that are ONE entry, though they read as two ("peper en zout"): an add does not split them. Short on
  // purpose; the admin may grow it later.
  compoundEntries: Object.freeze(['peper en zout', 'zout en peper', 'brood en spelen']),
  required: Object.freeze({}),
  // The model's household words (Fable's text, verbatim): the tool name beside the phrase it answers, in Dutch. A list's
  // name is its placeholder (`{errand}` → the chores list's name, `{lists}` → all of them); `promptLinesFor` fills them.
  promptLines: Object.freeze([
    "Dit huishouden houdt alles op LIJSTEN: {lists}.",
    "addToList(list, text) voegt iets toe; eten, drinken en huishoudspullen zonder lijstnaam gaan op {shopping}, zonder vraag.",
    "{errand} zijn TAKEN: \"nieuwe taak voor mij/voor Bert: X (maandag)\" → addToList(list: {errand}, text: X, assignee: mij/Bert, due: de dag als datum). \"ik doe de lamp\" → claimTask(id: de woorden); \"de lamp is gemaakt\" → completeTask(id: de woorden). \"wat moet ik nog doen\" → listMine. \"wat staat er op de klusjes / de takenlijst\" → listEntries(list: {errand}).",
    "\"… is gekocht / gedaan / gemaakt\" over een lijstregel → markListItemDone(item: de woorden). \"haal … van de lijst\" → removeFromList(item). \"verander … in …\" → editEntry(item, text). Geef alleen item (en text); laat list weg. Vraag NOOIT op welke lijst iets staat: het systeem zoekt de regel zelf.",
    "{schedule} zijn AFSPRAKEN: \"tandarts morgen om 10 uur\" → addEvent(title, when als lokale tijd zonder zone, bv. 2026-09-30T10:00). \"wat staat er in de agenda\" → listEvents. \"ik kom (naar de tandarts)\" / \"ik ben erbij\" → rsvpAccept(id: de woorden); \"ik kan niet\" → rsvpDecline; \"misschien\" → rsvpTentative.",
    "\"ik ben bij … geweest\" / \"de afspraak is geweest\" is GEEN rsvp: → markListItemDone(item: de woorden van de afspraak).",
    "\"wie zitten er in dit huishouden\" / \"wie is de beheerder\" → assistant-people. Zeg NOOIT dat je dat niet kunt zien.",
    "\"wat staat er deze week\" / \"wat moet er nog gebeuren\" → weekOverview. \"geen herinneringen meer\" → assistant-reminders(mode: off).",
    "Zegt iemand bij iets op een andere lijst wie het doet of wanneer (\"melk voor Bob\", \"taart voor zaterdag\"): roep addToList aan met assignee en/of due; het wordt een klusje op diezelfde lijst. \"maak van X een klusje (voor Bob)\" → makeChore(item: X, assignee, due).",
    "Elk ding is een eigen regel: \"melk en kaas\" zijn twee aanroepen (melk, kaas). Vaste paren zoals \"peper en zout\" blijven één.",
    "Een klusje voor jezelf (\"nieuwe taak voor mij: X\") mag ieder lid: roep addToList aan met assignee: mij. Een klusje voor een ander: roep addToList ook aan; het systeem zegt zelf of het mag. Zeg NOOIT zelf dat iets niet mag als er een tool voor is.",
    "Iedereen mag een lijst maken (createList), weggooien (removeList) en binnen 30 dagen terugzetten (restoreList).",
    "Je kunt niet veranderen hoe je werkt: je antwoorden, de overzichten en de knoppen liggen vast. Krijg je een wens of feedback daarover: bedank, zeg eerlijk dat je dat zelf niet kunt veranderen, en dat wie het anders wil het aan de beheerder van het huishouden kan vragen. Beloof NOOIT dat je iets voortaan anders doet.",
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

/**
 * What a household bot composes: the household and the template's plugins — fixed. There is no app switch on a bot:
 * what it holds is its lists and what each list's lines are; a person's own box keeps its app list (`assistant.apps`).
 * @param {object} [template]
 * @returns {string[]}
 */
export function householdBotApps(template = HOUSEHOLD_TEMPLATE) {
  return ['household', ...template.apps];
}

/**
 * The template's lists as the gate and the lines use them: each list's name (in the door's language), kind, default
 * child and the words people use for it.
 * @param {(key: string) => string} t
 * @param {object} [template]
 * @returns {Array<{name: string, kind: string, defaultChild: string|null, aliases: string[]}>}
 */
export function templateLists(t, template = HOUSEHOLD_TEMPLATE) {
  return (template.lists ?? []).map((l) => ({
    name: t(l.key), kind: l.kind, defaultChild: l.defaultChild ?? null, aliases: [...(l.aliases ?? [])],
  }));
}

/** What a list is for, when a template brings no lines of its own: one line per list, from what it holds. LLM-facing. */
function listLine({ name, defaultChild }) {
  if (defaultChild === 'task') return `${name} zijn TAKEN: "nieuwe taak: X" → addToList(list: ${name}, text: X); "ik doe …" → claimTask(id: de woorden); "… is gedaan" → completeTask(id: de woorden).`;
  if (defaultChild === 'calendar-event') return `${name} zijn AFSPRAKEN: addEvent(title, when als lokale tijd zonder zone, bv. 2026-09-30T10:00); "wat staat er in ${name}" → listEvents.`;
  return `${name}: addToList(list: ${name}, text) zet er iets op; "wat staat er op ${name}" → listEntries(list: ${name}).`;
}

/**
 * The model's lines for a template, its list names filled in: the template's own lines (placeholders `{<kind>}` and
 * `{lists}`), or — for a template without them — one line per list from what it holds.
 * @param {(key: string) => string} t
 * @param {object} [template]
 * @returns {string[]}
 */
/**
 * Everything a household bot tells its model about its household, in ONE place: the template's lines and the reminder
 * lines. The box reads it, and so does the eval — "the eval composes the bot as it ships" stays true by construction.
 */
export function botPromptLines(t, template = HOUSEHOLD_TEMPLATE) {
  return [...promptLinesFor(t, template), ...reminderPromptLines()];
}

/**
 * The model's lines for lists as they ARE (a circle's own, which no template made): their names, and one line per list
 * from what it holds. LLM-facing.
 * @param {Array<{name: string, defaultChild?: string|null}>} lists
 * @returns {string[]}
 */
export function promptLinesForLists(lists) {
  const named = (lists ?? []).filter((l) => l?.name);
  if (!named.length) return ['Er zijn hier nog geen lijsten.'];
  return [`Hier staat alles op LIJSTEN: ${named.map((l) => l.name).join(', ')}.`, ...named.map(listLine)];
}

export function promptLinesFor(t, template = HOUSEHOLD_TEMPLATE) {
  const lists = templateLists(t, template);
  const byKind = Object.fromEntries(lists.map((l) => [l.kind, l.name]));
  const all = lists.map((l) => l.name).join(', ');
  if (!Array.isArray(template.promptLines) || !template.promptLines.length) return promptLinesForLists(lists);
  return template.promptLines.map((line) => line
    .replace(/\{lists\}/g, all)
    .replace(/\{([a-z-]+)\}/g, (m, kind) => byKind[kind] ?? m));
}

/**
 * What a household bot's model may draw on: every open entry of every list, with its list — the retrieval a bare
 * "kaas is gekocht" needs to find the entry's id. (A person's node reads its household items instead.)
 * @param {{ callSkill: Function }} a
 */
export function loadListItems({ callSkill }) {
  return async () => {
    try {
      const lists = (await callSkill('lists', 'listLists', {}))?.items ?? [];
      const out = [];
      for (const l of lists) {
        const entries = (await callSkill('lists', 'listEntries', { list: l.id }))?.items ?? [];
        for (const e of entries) out.push({ id: String(e.id ?? ''), type: e.type ?? 'list-item', text: `${e.label ?? ''} (${l.label ?? ''})` });
      }
      return out.filter((it) => it.id && it.text);
    } catch { return []; }
  };
}

/**
 * One add per thing: "melk en kaas" → melk, kaas; "stokbrood, melk en eieren" → three. Commas split first, then " en " /
 * " and " — except a part that is a known pair ("peper en zout"), which stays one entry.
 * @param {string} text
 * @param {readonly string[]} [compounds]
 * @returns {string[]}
 */
export function splitEntryText(text, compounds = HOUSEHOLD_TEMPLATE.compoundEntries) {
  const whole = String(text ?? '').trim();
  const known = new Set((compounds ?? []).map((c) => String(c).toLowerCase()));
  if (!whole || known.has(whole.toLowerCase())) return whole ? [whole] : [];
  const parts = [];
  for (const piece of whole.split(/\s*,\s*/)) {
    const p = piece.trim();
    if (!p) continue;
    if (known.has(p.toLowerCase())) { parts.push(p); continue; }
    parts.push(...p.split(/\s+(?:en|and)\s+/i).map((x) => x.trim()).filter(Boolean));
  }
  return parts.length ? parts : [whole];
}

/**
 * The dispatcher's `expand` for a household bot: an addToList whose text names several things becomes one add per
 * thing, on the gate's route and the model's alike — but only on a list of PLAIN entries. A chore or an appointment is
 * one thing however it is worded ("lamp vervangen en ophangen", "tandarts en huisarts"): the target list is found by its
 * name or its words in the template, and a list whose entries are tasks or appointments is never split. A list the
 * template does not know (one the admin made) holds plain entries.
 * @param {{template?: object, t?: (key: string) => string}} [a]
 * @returns {(cmd: {opId: string, args?: object, appOrigin?: string}) => object[]}
 */
export function expandAdds({ template = HOUSEHOLD_TEMPLATE, t = (k) => k } = {}) {
  const byWord = new Map();
  for (const l of templateLists(t, template)) for (const w of [l.name, ...l.aliases]) if (w) byWord.set(String(w).toLowerCase(), l);
  const holdsThings = (listRef) => {
    const l = byWord.get(String(listRef ?? '').trim().toLowerCase());
    return !l || !l.defaultChild;   // unknown, or plain entries
  };
  return (cmd) => {
    if (cmd?.opId !== 'addToList' || typeof cmd.args?.text !== 'string') return [cmd];
    if (!holdsThings(cmd.args.list)) return [cmd];
    const parts = splitEntryText(cmd.args.text, template.compoundEntries);
    return parts.length > 1 ? parts.map((text) => ({ ...cmd, args: { ...cmd.args, text } })) : [cmd];
  };
}

