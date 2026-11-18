/**
 * opDescriptions — what an op does, and what each of its parameters is, in words a PERSON reads (the assistant plan's
 * step C, ledger L1025). Each app's words live beside its manifest (`descriptions.en.json`, `descriptions.nl.json`):
 *
 *   { "<opId>": { "what": "<a sentence>", "params": { "<param>": "<a short phrase>" } } }
 *
 * Imported here, one app at a time, so both shells bundle them; `lint-op-descriptions` reads THIS registry, so an app
 * counts as described only when its words are read. The MODEL's text is not here: it stays the op's
 * `surfaces.chat.hint` (and `chat-hints.nl.json`), two texts, as Frits agreed.
 */
import { currentLang } from '../localisation.js';
import { decodeGenericOpId } from '@onderling/app-manifest';
import { sharedCircleLocale } from '../locales/index.js';
import { allManifests } from './manifestSources.js';
import listsEn from '../../../lists/descriptions.en.json' with { type: 'json' };
import listsNl from '../../../lists/descriptions.nl.json' with { type: 'json' };
import householdEn from '../../../household/descriptions.en.json' with { type: 'json' };
import householdNl from '../../../household/descriptions.nl.json' with { type: 'json' };
import folioEn from '../../../folio/descriptions.en.json' with { type: 'json' };
import folioNl from '../../../folio/descriptions.nl.json' with { type: 'json' };
import pinboardEn from '../../../pinboard/descriptions.en.json' with { type: 'json' };
import pinboardNl from '../../../pinboard/descriptions.nl.json' with { type: 'json' };
import basisEn from '../../descriptions.en.json' with { type: 'json' };
import basisNl from '../../descriptions.nl.json' with { type: 'json' };
import assistantEn from './assistantManifest.descriptions.en.json' with { type: 'json' };
import assistantNl from './assistantManifest.descriptions.nl.json' with { type: 'json' };
import paramsEn from './paramsManifest.descriptions.en.json' with { type: 'json' };
import paramsNl from './paramsManifest.descriptions.nl.json' with { type: 'json' };
import governanceEn from './governanceManifest.descriptions.en.json' with { type: 'json' };
import governanceNl from './governanceManifest.descriptions.nl.json' with { type: 'json' };
import membershipEn from './membershipManifest.descriptions.en.json' with { type: 'json' };
import membershipNl from './membershipManifest.descriptions.nl.json' with { type: 'json' };
import keysEn from './keyManifest.descriptions.en.json' with { type: 'json' };
import keysNl from './keyManifest.descriptions.nl.json' with { type: 'json' };
import grantsEn from './grantsManifest.descriptions.en.json' with { type: 'json' };
import grantsNl from './grantsManifest.descriptions.nl.json' with { type: 'json' };
import itemsLaneEn from './itemsManifest.descriptions.en.json' with { type: 'json' };
import itemsLaneNl from './itemsManifest.descriptions.nl.json' with { type: 'json' };
import chatLaneEn from './chatManifest.descriptions.en.json' with { type: 'json' };
import chatLaneNl from './chatManifest.descriptions.nl.json' with { type: 'json' };
import calendarEn from '../../../calendar/descriptions.en.json' with { type: 'json' };
import calendarNl from '../../../calendar/descriptions.nl.json' with { type: 'json' };
import tasksEn from '../../../tasks-v0/descriptions.en.json' with { type: 'json' };
import tasksNl from '../../../tasks-v0/descriptions.nl.json' with { type: 'json' };
import agentsEn from '../../../agents/descriptions.en.json' with { type: 'json' };
import agentsNl from '../../../agents/descriptions.nl.json' with { type: 'json' };

/** `{ app: { en, nl } }`: the described apps (the guard's source of truth). */
export const OP_DESCRIPTIONS = Object.freeze({
  lists: { en: listsEn, nl: listsNl },
  household: { en: householdEn, nl: householdNl },
  folio: { en: folioEn, nl: folioNl },
  pinboard: { en: pinboardEn, nl: pinboardNl },
  basis: { en: basisEn, nl: basisNl },
  assistant: { en: assistantEn, nl: assistantNl },
  params: { en: paramsEn, nl: paramsNl },
  governance: { en: governanceEn, nl: governanceNl },
  membership: { en: membershipEn, nl: membershipNl },
  keys: { en: keysEn, nl: keysNl },
  grants: { en: grantsEn, nl: grantsNl },
  'items-lane': { en: itemsLaneEn, nl: itemsLaneNl },
  'chat-lane': { en: chatLaneEn, nl: chatLaneNl },
  calendar: { en: calendarEn, nl: calendarNl },
  tasks: { en: tasksEn, nl: tasksNl },
  agents: { en: agentsEn, nl: agentsNl },
});

/**
 * An op's words in a language: `{what, params}`, or null when the app is not described yet. English is the fallback.
 * @param {string} app @param {string} opId @param {string} [lang]
 * @returns {{what: string, params: Record<string, string>}|null}
 */
export function opDescription(app, opId, lang = currentLang()) {
  const generic = decodeGenericOpId(opId);
  if (generic) return genericDescription(generic, lang);
  const files = OP_DESCRIPTIONS[app];
  if (!files) return null;
  const d = files[lang]?.[opId] ?? files.en?.[opId];
  return d && typeof d.what === 'string' ? { what: d.what, params: d.params ?? {} } : null;
}

/** A noun's own names in a language (its manifest's `nouns[noun].names`), or null. */
function nounNamesOf(app, noun, lang) {
  const m = allManifests().find((x) => x?.app === app);
  const names = m?.nouns?.[noun]?.names;
  return names?.[lang] ?? names?.en ?? null;
}

// the article a noun takes in a sentence: Dutch `een` + the singular; English `a` or `an` by its first letter (never a
// de/het or a/an stored per noun: Fable 2026-11-18)
const ARTICLE = { nl: () => 'een', en: (one) => (/^[aeiou]/i.test(one) ? 'an' : 'a') };

/** A template's noun slots filled: {{a_noun}} the singular with its article, {{nouns}} the plural, {{noun}} bare. */
export function fillNounSlots(text, names, lang) {
  const one = names?.one ?? names?.other ?? '';
  const other = names?.other ?? one;
  return String(text ?? '')
    .replace(/\{\{a_noun\}\}/g, `${(ARTICLE[lang] ?? ARTICLE.en)(one)} ${one}`)
    .replace(/\{\{nouns\}\}/g, other)
    .replace(/\{\{noun\}\}/g, one);
}

/**
 * The generic verbs' words, from the locale where their labels live (the verb label key that capabilityLabel.js reads
 * is the label, `verb_what.<atom>` the sentence, `verb_param.<atom>.<param>` the phrases): ONE vocabulary per verb. Read straight from
 * the bundle, as `chatHints.js` does: the language is an argument, no i18n instance needed.
 */
export function genericVerbWords(lang) {
  const s = sharedCircleLocale?.[lang]?.settings ?? {};
  const text = (v) => (typeof v === 'string' ? v : v?.text);
  const out = {};
  for (const [atom, v] of Object.entries(s.verb_what ?? {})) {
    out[atom] = { what: text(v), params: Object.fromEntries(Object.entries(s.verb_param?.[atom] ?? {}).map(([k, p]) => [k, text(p)])) };
  }
  return out;
}

/**
 * A generic op (`__generic__:<app>:<verb>:<noun>`): the noun's own override of that verb (`@<noun>.<verb>` in its app's
 * file), else the verb's sentence from the locale, filled with the noun's names. A noun with no names: none.
 */
function genericDescription({ app, atom, noun }, lang) {
  const names = nounNamesOf(app, noun, lang);
  if (!names) return null;
  const own = OP_DESCRIPTIONS[app]?.[lang]?.[`@${noun}.${atom}`] ?? OP_DESCRIPTIONS[app]?.en?.[`@${noun}.${atom}`];
  const verb = own ?? genericVerbWords(lang)[atom] ?? genericVerbWords('en')[atom];
  if (typeof verb?.what !== 'string') return null;
  const params = Object.fromEntries(Object.entries(verb.params ?? {}).map(([k, v]) => [k, fillNounSlots(v, names, lang)]));
  return { what: fillNounSlots(verb.what, names, lang), params };
}

/** Just the sentence, or null. */
export function opWhat(app, opId, lang) {
  return opDescription(app, opId, lang)?.what ?? null;
}
