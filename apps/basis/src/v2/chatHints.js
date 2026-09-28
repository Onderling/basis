/**
 * chatHints — an op's chat hint in the member's language, for the model's tool list.
 *
 * The manifest's `surfaces.chat.hint` is the English source (the prompt's rules speak it). The Dutch lives in
 * `locales/chat-hints.nl.json` as `<app>.<opId>` (`{text, doc}`), so a Dutch thread's tools read Dutch first
 * (`lint-chat-hints-localised` keeps every household-scope op covered). Its own file, not the shared UI bundle: these
 * are words for the model, not for a screen, and an English copy would be the manifest's sentence twice.
 *
 * Read straight from the bundle, not through `t()`: the tool list is built per turn in the thread's language, whatever
 * language the process runs in, and needs no i18n instance.
 */
import chatHintsNl from '../locales/chat-hints.nl.json' with { type: 'json' };

const BY_LANG = { nl: chatHintsNl };

/**
 * @param {string} app @param {string} opId @param {string} lang
 * @returns {string|null} the hint in `lang` from the bundle, or null (English: the manifest's own)
 */
export function chatHintFor(app, opId, lang) {
  if (lang === 'en') return null;
  const leaf = BY_LANG[lang]?.[app]?.[opId];
  const text = typeof leaf === 'string' ? leaf : leaf?.text;
  return typeof text === 'string' && text.trim() ? text : null;
}
