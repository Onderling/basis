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
const HH_LIST_ALIASES = {
  shopping: 'shopping', groceries: 'shopping', grocery: 'shopping',
  boodschappen: 'shopping', boodschappenlijst: 'shopping', boodschappenlijstje: 'shopping',
  errand: 'errand', errands: 'errand', klusje: 'errand', klusjes: 'errand',
  repair: 'repair', repairs: 'repair', reparatie: 'repair', reparaties: 'repair',
  schedule: 'schedule', schedules: 'schedule', agenda: 'schedule',
};
/** A household list named the way people say it ("boodschappen", "klusjes", "groceries") → the addItem enum value, or null. */
export function householdListType(word) {
  const w = String(word ?? '').trim().toLowerCase().replace(/(?:lijstje|lijst|list)$/, '');
  return HH_LIST_ALIASES[w] ?? HH_LIST_ALIASES[String(word ?? '').trim().toLowerCase()] ?? null;
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
  return { opId: 'addItem', args: { type, text: item } };
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
