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
import listsEn from '../../../lists/descriptions.en.json' with { type: 'json' };
import listsNl from '../../../lists/descriptions.nl.json' with { type: 'json' };
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

/** `{ app: { en, nl } }`: the described apps (the guard's source of truth). */
export const OP_DESCRIPTIONS = Object.freeze({
  lists: { en: listsEn, nl: listsNl },
  params: { en: paramsEn, nl: paramsNl },
  governance: { en: governanceEn, nl: governanceNl },
  membership: { en: membershipEn, nl: membershipNl },
  keys: { en: keysEn, nl: keysNl },
  grants: { en: grantsEn, nl: grantsNl },
  'items-lane': { en: itemsLaneEn, nl: itemsLaneNl },
  'chat-lane': { en: chatLaneEn, nl: chatLaneNl },
  calendar: { en: calendarEn, nl: calendarNl },
});

/**
 * An op's words in a language: `{what, params}`, or null when the app is not described yet. English is the fallback.
 * @param {string} app @param {string} opId @param {string} [lang]
 * @returns {{what: string, params: Record<string, string>}|null}
 */
export function opDescription(app, opId, lang = currentLang()) {
  const files = OP_DESCRIPTIONS[app];
  if (!files) return null;
  const d = files[lang]?.[opId] ?? files.en?.[opId];
  return d && typeof d.what === 'string' ? { what: d.what, params: d.params ?? {} } : null;
}

/** Just the sentence, or null. */
export function opWhat(app, opId, lang) {
  return opDescription(app, opId, lang)?.what ?? null;
}
