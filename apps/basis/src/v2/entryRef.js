/**
 * entryRef — the entry a person means when they name it in their own words.
 *
 * A person never sees an id: they say "ik doe het vuilnis" for the chore "vuilnis buiten zetten", "ik kom naar de
 * tandarts" for the appointment. An op that takes an id takes those words too, and this picks the entry: the id
 * itself, else the entry whose words are exactly these (case aside), else the ONE entry whose words contain them.
 * Two entries that both contain the words are not guessed between — no entry, and the caller asks.
 */

/**
 * The entry, or — when the words fit more than one — which ones, so the person is asked "which one?" with the choices
 * rather than told there is none.
 * @template T
 * @param {T[]} entries  the open entries to choose from
 * @param {string} ref   an id, or the person's words
 * @param {(e: T) => string} textOf  an entry's words
 * @param {(e: T) => string} [idOf]
 * @returns {{ entry: T|null, among: T[] }}  `among`: the entries the words fit when they fit several (else empty)
 */
export function matchEntry(entries, ref, textOf, idOf = (e) => e?.id) {
  const want = String(ref ?? '').trim();
  if (!want || !Array.isArray(entries)) return { entry: null, among: [] };
  const byId = entries.find((e) => idOf(e) === want);
  if (byId) return { entry: byId, among: [] };
  const low = want.toLowerCase();
  const words = (e) => String(textOf(e) ?? '').toLowerCase();
  const exact = entries.filter((e) => words(e) === low);
  if (exact.length) return { entry: exact[0], among: [] };
  const within = entries.filter((e) => words(e).includes(low));
  return within.length === 1 ? { entry: within[0], among: [] } : { entry: null, among: within };
}

/** The "which one?" line's choices: the entries' words, quoted, in the order they came. */
export const choicesOf = (among, textOf) => among.map((e) => `"${String(textOf(e) ?? '')}"`).join(' · ');
