// Generic gazetteer-based NAME redaction — the locale-agnostic ENGINE.
//
// ⚠️ Names are an OPEN, AMBIGUOUS set, so a gazetteer is BEST-EFFORT, never a
// guarantee (foreign names slip through; capitalised homographs over-match).
// This module encodes the *structure* of the heuristic; ALL locale content —
// the name list, the placeholder, the honorific/relational/job titles, the
// surname particles — is DATA the caller supplies via the `gazetteer` config.
//
// The heuristic, in order:
//   pass 0  title + capitalised name  → redact the name, KEEP the title
//           (gazetteer-independent: a title is a high-precision "person follows"
//            signal). Caller supplies the title alternations as `titlePatterns`.
//   pass 1  known first name + (particle) + surname → redact the WHOLE name.
//   pass 2  remaining standalone known first names → redact.
//
// Only capitalised tokens are considered (Unicode-aware) so lowercase
// homographs ("mark" the verb) survive — but capitalised homographs and
// sentence-initial words still over-match. That is inherent, not a bug here.

const DEFAULT_PARTICLES = ['van', 'de', 'der', 'den', 'ten', 'ter'];

// Any token that starts with an uppercase letter (Unicode-aware).
const CAP_WORD = /\p{Lu}[\p{L}'’-]*/gu;

/**
 * Build the "name tail" sub-pattern (a capitalised name, optional leading/middle
 * particle, optional surname) from the caller's particle list. Mirrors the
 * NAME_TAIL in the original names.js but parameterised on the particles.
 */
function nameTail(particles) {
  const p = particles.join('|');
  // optional LEADING particle(s) ("de Vries", "van der Berg"), a capitalised
  // word, an optional middle particle, an optional surname.
  return `(?:(?:${p})\\s+){0,2}\\p{Lu}[\\p{L}'’-]+(?:\\s+(?:${p})\\b)?(?:\\s+\\p{Lu}[\\p{L}'’-]+)?`;
}

/**
 * First-name + (particle) + surname matcher source. The first capture group is
 * the first name (gazetteer-gated by the engine).
 */
function firstPlusSurname(particles) {
  const p = particles.join('|');
  return `\\b(\\p{Lu}[\\p{L}'’-]+)(\\s+(?:${p})\\b)?\\s+\\p{Lu}[\\p{L}'’-]+`;
}

/**
 * Redact names from text using a gazetteer config.
 *
 * @param {string} text  (run AFTER structured redact() so it skips [tokens])
 * @param {{
 *   names: string[] | Set<string>,
 *   placeholder: string,
 *   particles?: string[],
 *   titlePatterns?: string[],   // each a regex SOURCE for a title prefix group,
 *                               //   e.g. '(?:[Mm]eneer|[Mm]evrouw)\\s+'
 * }} gazetteer
 * @returns {{ text: string, hits: Array<{type:'name', value:string}> }}
 */
export function redactGazetteer(text, gazetteer) {
  const {
    names,
    placeholder,
    particles = DEFAULT_PARTICLES,
    titlePatterns = [],
  } = gazetteer;

  const nameSet = names instanceof Set
    ? names
    : new Set(Array.from(names, (n) => n.toLowerCase()));

  const hits = [];
  let out = text;

  const tail = nameTail(particles);

  // pass 0: TITLE + capitalised name → redact the name (gazetteer-independent).
  // Each titlePattern is a SOURCE that matches+captures the title prefix; the
  // engine appends the name-tail group. No `i` flag — under /iu, \p{Lu} would
  // case-fold and eat the following ordinary word (the meneer-Jansen leak).
  for (const titleSrc of titlePatterns) {
    const re = new RegExp(`\\b(${titleSrc})(${tail})`, 'gu');
    out = out.replace(re, (m, title, name) => {
      hits.push({ type: 'name', value: name });
      return title + placeholder;
    });
  }

  // pass 1: first-name + (particle) + surname, when the first name is known.
  const fps = new RegExp(firstPlusSurname(particles), 'gu');
  out = out.replace(fps, (m, first) => {
    if (nameSet.has(first.toLowerCase())) {
      hits.push({ type: 'name', value: m });
      return placeholder;
    }
    return m;
  });

  // pass 2: remaining standalone known first names.
  out = out.replace(CAP_WORD, (w) => {
    if (nameSet.has(w.toLowerCase())) {
      hits.push({ type: 'name', value: w });
      return placeholder;
    }
    return w;
  });

  return { text: out, hits };
}
