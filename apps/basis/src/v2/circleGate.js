// circleGate.js — the circle bot's deterministic pre-LLM gate, DERIVED FROM THE MANIFEST.
//
// Replaces the hand-written circleGateRules.js. "add X" / "done X" / "claim X" now come from the task
// ops' `surfaces.slash.match` declarations (mockManifests.js) via `renderGate` — the SAME projection
// household's TG-bot uses (`renderSlash`). So the deterministic gate, the slash surface, and the LLM
// tool surface (`renderChat`) all read one source of truth instead of a parallel hand-written copy.
//
// Part A (manifest-gate-surfaces): the gate is now composed at the HOST level — `createGate` from
// `@onderling/manifest-host` projects the circle apps' manifests into gate rules via app-manifest's
// `renderGate` under the hood (same rules, same first-match-wins order). basis no longer reaches
// past the host into `@onderling/app-manifest/src/renderGate.js`; it consumes the substrate's public API,
// exactly as `manifestMerge.js` already consumes `createManifestHost`.
//
// Part C (2026-06-11): projects the circle apps' manifests so the gate covers tasks/stoop/folio/
// calendar user-action verbs. Cross-app verb collisions (share/accept/reject/cancel) were resolved at
// the manifest level (each verb has one owner; losers dropped the bare token). renderGate is
// first-match-wins across the flattened rules, preserving each op's verb order (multiword before bare).
//
// household-mock is DELIBERATELY EXCLUDED from the circle gate: the circle's items are TASKS (not
// household chores), so its add/done verbs would be shadowed by tasks and its remove/list verbs would
// mis-target a chore. Household ops still reach the LLM path; household's own gate verbs serve the
// household TG-bot surface (its real manifest), not the circle.

import { createGate } from '@onderling/manifest-host';
import { mockTasksManifest, mockStoopManifest, mockFolioManifest } from '../core/manifests/mockManifests.js';
import { calendarManifest } from '../../../calendar/manifest.js';
import { CIRCLE_GATE_TRAIL, DEFAULT_GATE_LOCALE } from './circleGateLexicon.js';

/**
 * Token-gate rules for the circle bot, projected from the circle apps' manifests.
 *
 * `locale` (the user's language, 'en' | 'nl') enables the per-locale TRAILING-verb pass so casual
 * phrasing like "kaas done" / "afwas klaar" routes through the deterministic gate instead of falling
 * to the (unreliable) small LLM. Leading verbs are language-neutral on the manifest; only trailing is
 * locale-scoped (circleGateLexicon). Defaults to English.
 */
export function circleGateRules(locale = DEFAULT_GATE_LOCALE) {
  const loc = CIRCLE_GATE_TRAIL[locale] ? locale : DEFAULT_GATE_LOCALE;
  return [
    // Household TYPED-LIST add (prepended, first-match-wins). The tasks-derived gate below treats EVERY
    // "add" as a generic addTask and DROPS the list qualifier (see circleGate.test "add X to the list").
    // But a household circle has typed lists — shopping/errand/repair/schedule — so "add bananas to the
    // shopping list" must reach addItem({type:'shopping'}), not addTask. This catches the TYPED phrasing
    // (English + common Dutch); generic "add X to the list" (no type word) returns null → falls through
    // to the unchanged addTask rule. Types mirror the household manifest's addItem enum.
    { name: 'household:addItem(typed-list)', test: HH_ADD_TYPED, command: householdTypedListAdd },
    // An UNTYPED add ("voeg melk toe", "add milk to the list", "zet kaas erbij") is a household list item
    // whose LIST is unknown → addItem WITHOUT a type, so the shell asks "which list?" (a needsForm on `type`)
    // instead of the July default that made every bare add a task (ledger L90, 2026-09-05). A task is still
    // reachable by saying so ("add task …", "taak: …") — that falls through to the tasks rule.
    { name: 'household:addItem(untyped-asks)', test: (t) => HH_ADD_COLON.test(t) || HH_ADD_UNTYPED.test(t), command: householdUntypedAdd },
    // "kaas is gekocht" · "de afwas is gedaan" · "milk is bought" — a statement that an item is done; the model
    // asked "do you want me to …?" instead (eval 2026-09-05). Deterministic: markComplete by name.
    { name: 'household:markComplete(stated-done)', test: HH_STATED_DONE, command: householdStatedDone },
    // Household READ rules (prepended). The tasks-derived gate skips read phrasing ("show the shopping
    // list", "what tasks do we have") → the LLM, which (small models) mis-picks markComplete and dumps a
    // confusing "which one to complete?" clarify ON A READ (the markComplete-on-read bug, 2026-06-25).
    // Route reads deterministically to listOpen/listTasks so they never reach the model. A read with no
    // recognised list-type/tasks keyword (e.g. "what lists do we have") returns null → falls through.
    { name: 'household:listOpen(typed-list-read)', test: HH_LIST_READ,  command: householdListRead },
    { name: 'household:listTasks(read)',           test: HH_TASKS_READ, command: householdTasksRead },
    ...createGate([
      mockTasksManifest,
      mockStoopManifest,
      mockFolioManifest,
      calendarManifest,
    ], { locale: loc, trailLexicon: CIRCLE_GATE_TRAIL }).rules,
  ];
}

// alias → canonical household list type (the addItem `type` enum: shopping·errand·repair·schedule).
/**
 * The deterministic gate for a household BOT, whose household lives on LISTS: the same phrasings the household rules
 * read ("zet melk op de boodschappen", "wat staat er op de klusjes"), pointed at the lists — `addToList` and
 * `listEntries` on the list the words name — and "wat moet ik nog doen" at `listMine`. The lists and the words people
 * use for them come from the bot's TEMPLATE (`templateLists`), so another template's lists get the same rules.
 * @param {string} [_locale]
 * @param {Array<{name: string, aliases?: string[], defaultChild?: string|null}>} lists  the template's lists
 */
export function listsGateRules(_locale, lists = []) {
  const byWord = new Map();
  for (const l of lists) for (const w of [l.name, ...(l.aliases ?? [])]) if (w) byWord.set(String(w).toLowerCase(), l.name);
  const holdsEvents = new Set(lists.filter((l) => l.defaultChild === 'calendar-event').map((l) => l.name));
  const listFor = (word) => {
    const w = String(word ?? '').trim().toLowerCase();
    return byWord.get(w) ?? byWord.get(w.replace(/(?:lijstje|lijst|list)$/, '')) ?? null;
  };
  const escape = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const words = [...byWord.keys()].sort((a, b) => b.length - a.length).map(escape);
  const listRead = words.length ? new RegExp(`^${HH_READ}\\b.*?\\b(${words.join('|')})\\b`, 'i') : null;
  const chores = lists.find((l) => l.defaultChild === 'task')?.name ?? null;
  return [
    { name: 'lists:addToList(named-list)', test: HH_ADD_TYPED, command: (text) => {
      const m = HH_ADD_TYPED.exec(String(text || '').trim());
      if (!m) return null;
      const list = listFor(m[2]);
      const items = splitItems(m[1].trim());
      if (!list || !items.length) return null;
      return { opId: 'addToList', args: { list, text: items[0] }, ...(items.length > 1 ? { more: items.slice(1).map((t) => ({ opId: 'addToList', args: { list, text: t } })) } : {}) };
    } },
    { name: 'lists:listEntries(named-list-read)', test: (text) => Boolean(listRead && listRead.test(String(text ?? ''))), command: (text) => {
      const m = listRead ? listRead.exec(String(text || '').trim()) : null;
      const list = m ? listFor(m[1]) : null;
      if (!list) return null;
      // a list of appointments is read as the coming days, with their times — the calendar's own read
      return holdsEvents.has(list) ? { opId: 'listEvents', args: {}, appOrigin: 'calendar' } : { opId: 'listEntries', args: { list } };
    } },
    { name: 'tasks:listMine(read)', test: HH_TASKS_READ, command: () => ({ opId: 'listMine', args: {} }) },
    // "wat staat er deze week" / "wat moet er nog gebeuren": the person's week overview — by rule, so the model does not
    // summarise the week itself from what it happens to have in view
    { name: 'assistant:weekOverview(read)', test: WEEK_READ, command: () => ({ opId: 'weekOverview', args: {}, appOrigin: 'assistant' }) },
    // A person's own switch for what the bot writes first: "stop writing to me" must work every time, model or no
    // model — so it is a rule, never the model's reading.
    { name: 'assistant:reminders(off)', test: REMINDERS_OFF, command: () => ({ opId: 'assistant-reminders', args: { mode: 'off' }, appOrigin: 'assistant' }) },
    { name: 'assistant:reminders(on)', test: REMINDERS_ON, command: () => ({ opId: 'assistant-reminders', args: { mode: 'on' }, appOrigin: 'assistant' }) },
    // "add task call the plumber" · "nieuwe taak: lamp vervangen" · "zet een klusje: band plakken" — a task is a child
    // of the list whose entries are chores (it defaults to a task there).
    { name: 'lists:addToList(task-on-chores)', test: (text) => LISTS_ADD_TASK.test(text), command: (text) => {
      const m = LISTS_ADD_TASK.exec(String(text || '').trim());
      const what = m ? m[1].trim() : '';
      return chores && what ? { opId: 'addToList', args: { list: chores, text: what } } : null;
    } },
  ];
}

const REMINDERS_OFF = /^(?:(?:(?:stuur|geef)\s+(?:me|mij)\s+)?geen\s+herinneringen(?:\s+meer)?(?:\s+(?:sturen|graag|aub|alsjeblieft))?|(?:zet\s+)?(?:de\s+|mijn\s+)?herinneringen\s+uit|stop\s+(?:met\s+)?(?:de\s+)?herinneringen|no\s+more\s+reminders|(?:turn\s+)?(?:the\s+|my\s+)?reminders\s+off|stop\s+(?:the\s+)?reminders)\s*[.!]*$/i;
const REMINDERS_ON = /^(?:(?:zet\s+)?(?:de\s+|mijn\s+)?herinneringen\s+(?:weer\s+)?aan|(?:turn\s+)?(?:the\s+|my\s+)?reminders\s+(?:back\s+)?on)\s*[.!]*$/i;
const WEEK_READ = /^(?:wat\s+staat\s+er\s+(?:voor\s+)?deze\s+week|wat\s+moet\s+er\s+(?:nog|deze\s+week)?\s*gebeuren|what(?:'s|\s+is)\s+on\s+this\s+week)\s*[?.!]*$/i;
// A chore that says WHO ("voor mij", "voor Bert", "for me") or WHEN (a day word) is the model's: it has the assignee and
// the due date to fill, which this typed rule cannot.
const CHORE_WHO_OR_WHEN = /\b(?:voor\s+\S+|for\s+\S+|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|morgen|vandaag|overmorgen|volgende\s+week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|next\s+week)\b/i;
const LISTS_ADD_TASK_TYPED = /^(?:add|new|voeg|zet|nieuwe?|maak)?\s*(?:a|an|een)?\s*(?:task|taak|chore|klus|klusje)\s*:?\s+(.+?)\s*$/i;
const LISTS_ADD_TASK = { test: (s) => LISTS_ADD_TASK_TYPED.test(String(s ?? '')) && !CHORE_WHO_OR_WHEN.test(String(s ?? '')), exec: (s) => LISTS_ADD_TASK_TYPED.exec(String(s ?? '')) };

const HH_LIST_ALIASES = {
  shopping: 'shopping', groceries: 'shopping', grocery: 'shopping',
  boodschappen: 'shopping', boodschappenlijst: 'shopping', boodschappenlijstje: 'shopping',
  errand: 'errand', errands: 'errand', klusje: 'errand', klusjes: 'errand',
  repair: 'repair', repairs: 'repair', reparatie: 'repair', reparaties: 'repair',
  schedule: 'schedule', schedules: 'schedule', agenda: 'schedule',
};
/** "stokbrood, melk en eieren" → three items; a single item stays one ("brood en eieren" is a deliberate pair only
 *  when written without a comma list — the same rule as a person reading it). */
export function splitItems(text) {
  const s = String(text ?? '').trim();
  if (!/,/.test(s)) return [s];
  return s.split(/\s*,\s*|\s+(?:en|and)\s+/i).map((x) => x.trim()).filter(Boolean);
}

/** A household list named the way people say it ("boodschappen", "klusjes", "groceries") → the addItem enum value, or null. */
export function householdListType(word) {
  const w = String(word ?? '').trim().toLowerCase().replace(/(?:lijstje|lijst|list)$/, '');
  return HH_LIST_ALIASES[w] ?? HH_LIST_ALIASES[String(word ?? '').trim().toLowerCase()] ?? null;
}
/**
 * A command's enum args named the way people say them ("boodschappen") → the declared value ("shopping"), for the ops
 * whose enum is a household list type. Anything the op does not declare, or that is already a declared value, stays.
 * @param {{opId: string, args?: object}} cmd
 * @param {{opsById?: Map<string, {op?: object}>}} catalogue
 */
export function coerceListArgs(cmd, catalogue) {
  const op = catalogue?.opsById?.get?.(cmd.opId)?.op;
  const args = { ...(cmd.args ?? {}) };
  for (const p of (op?.params ?? [])) {
    if (p?.kind !== 'enum' || !Array.isArray(p.of)) continue;
    const v = args[p.name];
    if (typeof v !== 'string' || p.of.includes(v)) continue;
    const alt = householdListType(v);
    if (alt && p.of.includes(alt)) args[p.name] = alt;
  }
  return { ...cmd, args };
}
// "<item> is gekocht/gedaan/klaar/af" · "<item> is bought/done" — a statement, not a command.
const HH_STATED_DONE = /^(?:de\s+|het\s+|the\s+)?(.+?)\s+(?:is|zijn|are)\s+(?:al\s+|already\s+)?(gekocht|gehaald|gedaan|klaar|af|binnen|bought|done|finished)[.!]?$/i;
function householdStatedDone(text) {
  const m = HH_STATED_DONE.exec(String(text || '').trim());
  if (!m) return null;
  const item = m[1].trim();
  return item ? { opId: 'markComplete', args: { match: item } } : null;
}
// "add <item>" · "voeg <item> toe" · "zet <item> erbij" · "add <item> to the list" — no list named.
const HH_ADD_UNTYPED =
  /^(?:add|voeg|zet|doe|noteer)\s+(.+?)(?:\s+(?:toe|erbij|op\s+de\s+lijst|op\s+het\s+lijstje|to\s+the\s+list|on\s+the\s+list))?\s*$/i;
// "voeg toe: spruiten kopen" · "add: milk" — the verb first, then a colon, then the item (walk 3: the tasks rule
// took "Voeg toe: …" and made a task named "toe: spruiten kopen").
const HH_ADD_COLON = /^(?:voeg\s+toe|add|zet\s+erbij|noteer)\s*:\s*(.+?)\s*$/i;
function householdUntypedAdd(text, ctx) {
  const colon = HH_ADD_COLON.exec(String(text || '').trim());
  if (colon) return { opId: 'addItem', args: { text: colon[1].trim() } };   // explicit form: always ours, never a task
  // With a conversation under way the MODEL decides — it has the recent turns ("doe broccoli erbij" after a
  // shopping-list exchange means shopping); the memory-less gate would only ask what the model already knows.
  if (Number(ctx?.memoryTurns) > 0) return null;
  const m = HH_ADD_UNTYPED.exec(String(text || '').trim());
  if (!m) return null;
  const item = m[1].trim().replace(/^(?:a|an|the|een|de|het)\s+/i, '');
  if (!item) return null;
  if (/^(?:task|taak|klus)\b/i.test(item)) return null;   // "add task …" is a task — the tasks rule takes it
  return { opId: 'addItem', args: { text: item } };        // no type → the shell asks which list
}
// "add <item> to [the] <type> [list]" · "noteer <item> op de <type>lijst" · "voeg <item> toe aan de <type>"
const HH_ADD_TYPED =
  /^(?:add|noteer|zet|voeg)\s+(.+?)\s+(?:toe\s+)?(?:to|on|op|aan|naar)\s+(?:the\s+|de\s+|het\s+|my\s+|mijn\s+)?([a-zA-Z]+?)(?:[-\s]?(?:list|lijst|lijstje))?\.?$/i;

/**
 * "add X to the <type> list" → `addItem({type, text:X})` when <type> is a known household list type;
 * otherwise null so the generic addTask rule handles it. Pure + deterministic (gate-safe).
 * @param {string} text
 * @returns {{opId:'addItem', args:{type:string, text:string}}|null}
 */
function householdTypedListAdd(text) {
  const m = HH_ADD_TYPED.exec(String(text || '').trim());
  if (!m) return null;
  const item = m[1].trim();
  const type = HH_LIST_ALIASES[m[2].toLowerCase()];
  if (!item || !type) return null;   // no known list type → generic add (addTask) takes it
  const items = splitItems(item);
  return { opId: 'addItem', args: { type, text: items[0] }, ...(items.length > 1 ? { more: items.slice(1).map((t) => ({ opId: 'addItem', args: { type, text: t } })) } : {}) };
}

// Read intent (EN + common NL); leading verb so a mutate phrase ("add"/"done"/"complete") never matches.
const HH_READ = '(?:show|list|see|view|display|open|give|what(?:\'?s| is| are)?(?: on| in| left)?|which|welke|laat|toon|wat)';
// read intent + a recognised list-type keyword → listOpen({type}); the type is the capture group.
const HH_LIST_READ = new RegExp('^' + HH_READ +
  '\\b.*?\\b(shopping|groceries|grocery|boodschappen|boodschappenlijst|errand|errands|klusje|klusjes|repair|repairs|reparatie|reparaties|schedule|schedules|agenda)\\b', 'i');
// read intent + a tasks/chores keyword → listTasks.
const HH_TASKS_READ = new RegExp('^' + HH_READ + '\\b.*?\\b(tasks?|chores?|to-?dos?|taken)\\b', 'i');

/** "show the <type> list" / "what's on the <type> list" → `listOpen({type})`; null if no known type. */
function householdListRead(text) {
  const m = HH_LIST_READ.exec(String(text || '').trim());
  if (!m) return null;
  const type = HH_LIST_ALIASES[m[1].toLowerCase()];
  return type ? { opId: 'listOpen', args: { type } } : null;
}
/** "what tasks do we have" / "show the chores" → `listTasks`. */
function householdTasksRead(text) {
  return HH_TASKS_READ.test(String(text || '').trim()) ? { opId: 'listTasks', args: {} } : null;
}
