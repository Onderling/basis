/**
 * entryRef — the entry a person means when they name it in their own words.
 *
 * A person never sees an id: they say "ik doe het vuilnis" for the chore "vuilnis buiten zetten", "ik kom naar de
 * tandarts" for the appointment. An op that takes an id takes those words too, and this picks the entry: the id
 * itself, else the entry whose words are exactly these (case aside), else the ONE entry whose words contain them.
 * Two entries that both contain the words are not guessed between — no entry, and the caller asks.
 */

/**
 * @template T
 * @param {T[]} entries  the open entries to choose from
 * @param {string} ref   an id, or the person's words
 * @param {(e: T) => string} textOf  an entry's words
 * @param {(e: T) => string} [idOf]
 * @returns {T|null}
 */
export function pickEntry(entries, ref, textOf, idOf = (e) => e?.id) {
  const want = String(ref ?? '').trim();
  if (!want || !Array.isArray(entries)) return null;
  const byId = entries.find((e) => idOf(e) === want);
  if (byId) return byId;
  const low = want.toLowerCase();
  const words = (e) => String(textOf(e) ?? '').toLowerCase();
  const exact = entries.filter((e) => words(e) === low);
  if (exact.length) return exact[0];
  const within = entries.filter((e) => words(e).includes(low));
  return within.length === 1 ? within[0] : null;
}
