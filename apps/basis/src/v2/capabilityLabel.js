/**
 * A capability (a verb on a noun) as a person reads it: `Toevoegen · notitie`. ONE lookup for every screen that lists
 * capabilities (a circle's settings rows, its override, the recipe consent card, the join wizard), both shells. Before,
 * each screen built it itself (three copies of a `verbLabel` on the phone, four inline on web), and painted the noun's
 * id ("note") where its name exists.
 *
 * The verb's label is the locale's `circle.settings.verb.<atom>`, the noun its own name (`nounWord`: the declaring
 * manifest's `names`); either falls back to its id when no word exists.
 */
import { nounWord } from './nounNames.js';

/** @param {Function} t @param {string} atom */
export function verbLabel(t, atom) {
  const k = `circle.settings.verb.${atom}`;
  const v = typeof t === 'function' ? t(k, { defaultValue: atom }) : null;
  return typeof v === 'string' && v && v !== k ? v : String(atom ?? '');
}

/** @param {Function} t @param {{atom: string, noun: string}} cap */
export function capabilityLabel(t, { atom, noun } = {}) {
  const word = typeof t === 'function' ? nounWord(t, noun) : null;
  const name = typeof word === 'string' && word && word !== `noun.${noun}` ? word : String(noun ?? '');
  return `${verbLabel(t, atom)} · ${name}`;
}
