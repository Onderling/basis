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
import { readDayAndTime } from '../forms/parseDate.js';
import { compileGateWords, GATE_WORDS } from './gateWords.js';

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
  const chores = lists.find((l) => l.defaultChild === 'task')?.name ?? null;
  // The WORDS are the locale files' (gate.<lang>.json: patterns, examples, what must not match); the household bot
  // understands its languages side by side. What each rule DOES stays here, keyed by the entry's id.
  const compiled = compileGateWords(GATE_WORDS, { list: [...byWord.keys()] });
  return GATE_RULES.map(({ id, name, build }) => {
    const forms = compiled.get(id) ?? [];
    const slotsOf = (text) => { for (const f of forms) { const m = f.match(text); if (m) return m; } return null; };
    const command = (text) => { const m = slotsOf(String(text ?? '')); return m ? build(m, String(text).trim(), { listFor, holdsEvents, chores }) : null; };
    // a rule TAKES a line when it builds a command for it — its own checks included, not only its words
    return { name, test: (text) => Boolean(command(text)), command };
  });
}

/** What each of the household's word rules does, in order (the first that builds a command wins). */
const GATE_RULES = [
  { id: 'lists.addToList.named', name: 'lists:addToList(named-list)', build: (m, _t, { listFor }) => {
    const list = listFor(m.list);
    const items = splitItems(m.items);
    if (!list || !items.length) return null;
    return { opId: 'addToList', args: { list, text: items[0] }, ...(items.length > 1 ? { more: items.slice(1).map((x) => ({ opId: 'addToList', args: { list, text: x } })) } : {}) };
  } },
  { id: 'lists.listEntries.named', name: 'lists:listEntries(named-list-read)', build: (m, _t, { listFor, holdsEvents }) => {
    const list = listFor(m.list);
    if (!list) return null;
    // a list of appointments is read as the coming days, with their times — the calendar's own read
    return holdsEvents.has(list) ? { opId: 'listEvents', args: {}, appOrigin: 'calendar' } : { opId: 'listEntries', args: { list } };
  } },
  { id: 'tasks.listMine', name: 'tasks:listMine(read)', build: () => ({ opId: 'listMine', args: {} }) },
  // the person's week overview — by rule, so the model does not summarise the week itself
  { id: 'assistant.weekOverview', name: 'assistant:weekOverview(read)', build: () => ({ opId: 'weekOverview', args: {}, appOrigin: 'assistant' }) },
  // mostly a reply to the bot's own reminder, so it works without a model; the waist finds the one item (or asks),
  // and a chore's tick is the chore's own verb underneath
  { id: 'lists.markListItemDone.stated', name: 'lists:markListItemDone(stated)', build: (m) => ({ opId: 'markListItemDone', args: { item: m.item } }) },
  // a person's own switch for what the bot writes first: every time, model or no model
  { id: 'assistant.reminders.off', name: 'assistant:reminders(off)', build: () => ({ opId: 'assistant-reminders', args: { mode: 'off' }, appOrigin: 'assistant' }) },
  { id: 'assistant.reminders.on', name: 'assistant:reminders(on)', build: () => ({ opId: 'assistant-reminders', args: { mode: 'on' }, appOrigin: 'assistant' }) },
  // the deterministic floor: exact imperatives; the words go to the waist, which finds one item or asks which
  { id: 'tasks.claimTask', name: 'tasks:claimTask(i-do)', build: (m) => {
    const what = m.item;
    // "ik doe mee" / "ik doe het morgen" are talk, not a claim: they stay the model's
    if (!what || NOT_A_THING.test(what) || readDayAndTime(what)) return null;
    return { opId: 'claimTask', args: { id: what }, fallback: 'model' };
  } },
  { id: 'lists.removeFromList', name: 'lists:removeFromList(take-off)', build: (m, _t, { listFor }) => {
    if (m.list && !listFor(m.list)) return null;
    return { opId: 'removeFromList', args: { item: m.item }, fallback: 'model' };
  } },
  { id: 'lists.createList', name: 'lists:createList(make)', build: (m) => (m.name ? { opId: 'createList', args: { text: m.name } } : null) },
  // a chore that says who (and a day the bounded reader reads): "nieuwe taak voor mij: ramen lappen, morgen"
  { id: 'lists.addToList.choreFor', name: 'lists:addToList(chore-who-when)', build: (m, _t, { chores }) => {
    if (!chores) return null;
    const who = /^(?:mij|me|ik|myself)$/i.test(m.person) ? 'mij' : m.person;
    const body = m.text;
    // a tail after a comma is the chore's day ("…, morgen"): one the reader cannot read is the model's
    const tail = /,\s*([^,]+)$/.exec(body)?.[1] ?? null;
    if (tail && !readDayAndTime(tail)) return null;
    if (!CHORE_WHO_OR_WHEN.test(body)) return { opId: 'addToList', args: { list: chores, text: body.replace(/[,.;]+$/, ''), assignee: who } };
    const read = readDayAndTime(body);
    if (!read || read.time || !read.rest) return null;   // a day it does not read, or a time: the model's
    return { opId: 'addToList', args: { list: chores, text: caseOf(body, read.rest), assignee: who, due: read.day } };
  } },
  // "nieuwe taak: lamp vervangen" — a child of the list whose entries are chores; one that says who or when is the
  // rule above's, or the model's
  { id: 'lists.addToList.task', name: 'lists:addToList(task-on-chores)', build: (m, text, { chores }) => {
    if (!chores || !m.text || CHORE_WHO_OR_WHEN.test(text)) return null;
    return { opId: 'addToList', args: { list: chores, text: m.text } };
  } },
  // LAST: an appointment — a short title, a day and a time the bounded reader reads. Narrow on purpose: a sentence
  // about someone ("ik ben morgen om 10 uur weg") or without a time stays the model's.
  { id: 'calendar.addEvent.dayTime', name: 'calendar:addEvent(day-and-time)', build: (_m, text) => {
    const read = readDayAndTime(text);
    if (!read || !read.time || !read.rest) return null;
    const words = read.rest.split(' ');
    if (words.length > 4 || words.some((w) => PERSON_WORDS.has(w))) return null;
    return { opId: 'addEvent', args: { title: caseOf(text, read.rest), when: `${read.day}T${read.time}` }, appOrigin: 'calendar' };
  } },
];

/** Every rule id the household's words must carry in every language (the guard reads it). */
export const GATE_RULE_IDS = Object.freeze(GATE_RULES.map((r) => r.id));


const NOT_A_THING = /^(?:mee|het|dat|dit|niks|niets|wat|ook|even|it|that|this|nothing)\b/i;
const PERSON_WORDS = new Set(['ik', 'je', 'jij', 'we', 'wij', 'hij', 'zij', 'ze', 'u', 'jullie', 'mij', 'me', 'i', 'you', 'he', 'she', 'they', 'my', 'mijn']);
/** The words of `lower` as they were typed in `original` (the reader lowercases). */
const caseOf = (original, lower) => { const i = original.toLowerCase().indexOf(lower); return i >= 0 ? original.slice(i, i + lower.length) : lower; };
// A chore that says WHO ("voor mij", "voor Bert") or WHEN (a day word): the who-and-when rule reads it when it can
// (a person, and a day the bounded reader reads); the plain chore rule leaves it alone, and anything else is the model's.
const CHORE_WHO_OR_WHEN = /\b(?:voor\s+\S+|for\s+\S+|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|morgen|vandaag|overmorgen|volgende\s+week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|next\s+week)\b/i;

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
