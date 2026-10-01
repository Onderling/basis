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
  // The household circle's own rules, first-match-wins, before the manifest-derived ones. Their WORDS are the gate's
  // locale files (gate.<lang>.json, the `circle.*` entries); what each does is CIRCLE_RULES below.
  const compiled = compileGateWords(GATE_WORDS, { list: Object.keys(HH_LIST_ALIASES) });
  return [
    ...CIRCLE_RULES.map(({ id, name, build }) => {
      const forms = compiled.get(id) ?? [];
      const slotsOf = (text) => { for (const f of forms) { const m = f.match(text); if (m) return m; } return null; };
      const command = (text, ctx) => { const m = slotsOf(String(text ?? '')); return m ? build(m, String(text).trim(), ctx) : null; };
      return { name, test: (text) => Boolean(slotsOf(String(text ?? ''))), command };
    }),
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
// The household circle's own rules: what each one does with the slots its words (gate.<lang>.json) hand back.
const CIRCLE_RULES = [
  // "zet melk op de boodschappen" · "add milk to the shopping list" — a known list type, one or more things
  { id: 'circle.addItem.typed', name: 'household:addItem(typed-list)', build: (m) => {
    const type = householdListType(m.list);
    const items = splitItems(m.items);
    if (!type || !items[0]) return null;
    return { opId: 'addItem', args: { type, text: items[0] }, ...(items.length > 1 ? { more: items.slice(1).map((t) => ({ opId: 'addItem', args: { type, text: t } })) } : {}) };
  } },
  // "voeg toe: spruiten kopen" (always ours, never a task) · "voeg melk toe" (no list named → the shell asks which)
  { id: 'circle.addItem.untyped', name: 'household:addItem(untyped-asks)', build: (m, _text, ctx) => {
    if (m.text !== undefined) return m.text ? { opId: 'addItem', args: { text: m.text } } : null;
    // With a conversation under way the MODEL decides — it has the recent turns ("doe broccoli erbij" after a
    // shopping-list exchange means shopping); the memory-less gate would only ask what the model already knows.
    if (Number(ctx?.memoryTurns) > 0) return null;
    const item = String(m.item ?? '').replace(/^(?:a|an|the|een|de|het)\s+/i, '');
    if (!item || /^(?:task|taak|klus)\b/i.test(item)) return null;   // "add task …" is a task — the tasks rule takes it
    return { opId: 'addItem', args: { text: item } };
  } },
  // "kaas is gekocht" · "the dishes are done" — a statement, not a command
  { id: 'circle.markComplete.stated', name: 'household:markComplete(stated-done)', build: (m) => (m.item ? { opId: 'markComplete', args: { match: m.item } } : null) },
  { id: 'circle.listOpen.typed', name: 'household:listOpen(typed-list-read)', build: (m) => { const type = householdListType(m.list); return type ? { opId: 'listOpen', args: { type } } : null; } },
  { id: 'circle.listTasks.read', name: 'household:listTasks(read)', build: () => ({ opId: 'listTasks', args: {} }) },
];
/** The circle rules' ids, in order — what the words guard checks each language against. */
export const CIRCLE_GATE_RULE_IDS = Object.freeze(CIRCLE_RULES.map((r) => r.id));
