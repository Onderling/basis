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
import tasksEn from '../../../tasks-v0/descriptions.en.json' with { type: 'json' };
import tasksNl from '../../../tasks-v0/descriptions.nl.json' with { type: 'json' };

/** `{ app: { en, nl } }`: the described apps (the guard's source of truth). */
export const OP_DESCRIPTIONS = Object.freeze({
  lists: { en: listsEn, nl: listsNl },
  tasks: { en: tasksEn, nl: tasksNl },
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
