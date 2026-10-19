/**
 * An EXTENSION's manifest at compose — what the catalogue checks before an extension's nouns and words join it.
 *
 *   - its nouns sit under its composed origin (`<origin>.<noun>`; the origin is the catalogue's reading of who the
 *     manifest is, never a name it gives itself);
 *   - the words its chat gate answers to are its own: each starts with its noun's own word (`plant …`), so a bare verb
 *     ("add", "voeg toe") stays the first-party nouns', and a noun whose own word a first-party op already starts with
 *     is refused — one word, one owner.
 * A refusal names the noun and why; the composer refuses the whole manifest and says so.
 */

/** A noun's own word: what follows its origin (`plants.plant` → `plant`). */
export const nounWordOf = (noun) => String(noun).split('.').slice(1).join('.') || String(noun);

/** The words an extension noun's free atom answers to, unless the noun declares its own: `<noun word> <atom>`. */
export function extensionVerbsFor(noun, atom) {
  return [nounWordOf(noun), atom];
}

/** The first word of every verb a first-party manifest's ops answer to. */
function firstPartyFirstWords(manifests = []) {
  const out = new Set();
  for (const m of manifests) {
    for (const op of m?.operations ?? []) {
      for (const v of op?.surfaces?.slash?.match?.verbs ?? []) {
        const w = (Array.isArray(v) ? v[0] : String(v).trim().split(/\s+/)[0]) ?? '';
        if (w) out.add(String(w).toLowerCase());
      }
    }
    for (const lang of Object.values(m?.gateWords ?? {})) {
      for (const entry of Object.values(lang ?? {})) {
        for (const v of entry?.verbs ?? []) { const w = String(v).trim().split(/\s+/)[0]; if (w) out.add(w.toLowerCase()); }
      }
    }
  }
  return out;
}

/**
 * Check an extension's manifest against the compose rules above: its nouns under its origin, its words its own.
 * @param {object} manifest   the extension's manifest
 * @param {{origin: string, firstParty?: object[]}} a   the composed origin; the first-party manifests already composed
 * @returns {{ok: boolean, problems: Array<{noun: string, reason: 'not-in-origin'|'word-not-the-noun'|'word-taken', word?: string}>}}
 */
export function checkExtensionManifest(manifest, { origin, firstParty = [] } = {}) {
  const problems = [];
  const taken = firstPartyFirstWords(firstParty);
  for (const [noun, n] of Object.entries(manifest?.nouns ?? {})) {
    if (!(typeof origin === 'string' && origin && noun.startsWith(`${origin}.`) && noun.length > origin.length + 1)) {
      problems.push({ noun, reason: 'not-in-origin' });
      continue;
    }
    const word = nounWordOf(noun).toLowerCase();
    if (taken.has(word)) { problems.push({ noun, reason: 'word-taken', word }); continue; }
    // the noun's own declared words (per language, per atom): each must start with the noun's word
    for (const perAtom of Object.values(n?.gateWords ?? {})) {
      for (const phrases of Object.values(perAtom ?? {})) {
        for (const p of Array.isArray(phrases) ? phrases : [phrases]) {
          if (String(p).trim().split(/\s+/)[0]?.toLowerCase() !== word) problems.push({ noun, reason: 'word-not-the-noun', word: String(p) });
        }
      }
    }
  }
  return { ok: problems.length === 0, problems };
}
