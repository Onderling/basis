/**
 * What a shown noun is called — from the manifest that declares it (`nouns[noun].names`: per language its plural forms,
 * `other` required, `one` optional), merged into the shared locale as `noun.<noun>_one` / `noun.<noun>_other`, so both
 * shells name a noun with their own `t()` and basis's locale carries no noun's name. A noun two manifests name is
 * ambiguous and left unnamed (its fitness fails), never resolved by catalogue order.
 */
import { allManifests } from './manifestSources.js';

/**
 * The `noun` locale block per language, from the manifests' declarations.
 * @param {{manifests?: object[]}} [o]
 * @returns {Record<string, Record<string, {text: string}>>}   `{ nl: { 'calendar-event_one': {text}, … }, en: {…} }`
 */
export function nounWords({ manifests = allManifests() } = {}) {
  const declared = new Map();
  for (const m of manifests ?? []) for (const [noun, d] of Object.entries(m?.nouns ?? {})) if (d?.names) declared.set(noun, [...(declared.get(noun) ?? []), d.names]);
  const out = {};
  for (const [noun, all] of declared) {
    if (all.length !== 1) continue;
    for (const [lang, forms] of Object.entries(all[0])) {
      out[lang] ??= {};
      for (const form of ['one', 'other']) if (typeof forms?.[form] === 'string') out[lang][`${noun}_${form}`] = { text: forms[form] };
    }
  }
  return out;
}

const capital = (s) => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s);

/** A heading over a noun's rows: its plural form, capitalised ("Afspraken"). @param {Function} t @param {string} noun */
export function nounHeading(t, noun) { return capital(t(`noun.${noun}`, { count: 2 })); }

/** A noun's word inside a sentence, as declared ("afspraak"). @param {Function} t @param {string} noun @param {number} [count] */
export function nounWord(t, noun, count = 1) { return t(`noun.${noun}`, { count }); }
