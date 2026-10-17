/**
 * offeringsMatch — pure functions for Pinboard's Layer 1 matching
 * (Pinboard V1 Phase 12, 2026-05-06; functional design § 4d).
 *
 * Matches over a member's OFFERINGS (the human-profile "I can do X" data — see
 * plans/NOTE-offering-rename-inventory.md); "skill" is reserved for the invocable A2A sense.
 * The roster wire field is still named `skills` today (renamed with the matching stack in a
 * follow-up pass); this module read-accepts it.
 *
 * No I/O, no inference, no state.  Apps build a matcher by passing
 * the loaded taxonomy + dictionary in; the matcher returns
 * normalised tags + categories for arbitrary text, and computes
 * "is this post relevant to this member's offerings?" deterministically.
 *
 * The dictionary lookups are case-insensitive (input lowercased
 * once at the call site).  Multilingual matching falls out of the
 * dictionary: NL `'fiets'` and EN `'bicycle'` both normalise to
 * canonical `bicycle` in category `vervoer`, so a Dutch post
 * matches an English skill profile.
 */

// The taxonomy moved to @onderling/agent-registry (offering→property fold-in,
// plans/NOTE-skills-properties-audit.md): it is now the COARSE rung of the `offering`
// property descriptor there. Literal-path import so it resolves under BOTH Node's
// exports map and Metro's exports-OFF literal resolution.
import { OFFERINGS_TAXONOMY } from '@onderling/agent-registry/src/offeringsTaxonomy.js';
import dictJson from './tagNormalisation.json' with { type: 'json' };

/**
 * Re-exported so apps can iterate the taxonomy for UI dropdowns.
 * Frozen to prevent accidental mutation. (Canonical home:
 * `@onderling/agent-registry` `OFFERINGS_TAXONOMY`.)
 */
export const TAXONOMY = OFFERINGS_TAXONOMY;

/** Indexed dictionary entries. */
const DICT = dictJson.entries;
/** Quick-set of valid category ids for membership checks. */
const CATEGORY_IDS = new Set(OFFERINGS_TAXONOMY.categories.map((c) => c.id));

/** Tokenise a free-text body into lowercase word tokens. */
function tokenise(text) {
  if (typeof text !== 'string' || !text) return [];
  return text.toLowerCase().split(/[^a-zà-ÿ0-9-]+/).filter(Boolean);
}

/**
 * Look up a single token in the normalisation dictionary.  Returns
 * `null` for unknown tokens.
 *
 * @param {string} token
 * @returns {{ tag: string, category: string } | null}
 */
export function normaliseTag(token) {
  if (typeof token !== 'string' || !token) return null;
  const k = token.toLowerCase();
  return DICT[k] ?? null;
}

/**
 * Suggest a category for a free-text post body.  Counts dictionary
 * hits per category; returns the category with the most hits, plus
 * the de-duplicated set of canonical tags extracted.
 *
 * Returns `{ categoryId: null, tags: [] }` when no dictionary hits.
 *
 * @param {string} text
 * @returns {{ categoryId: string | null, tags: string[] }}
 */
export function categoryFor(text) {
  const tokens = tokenise(text);
  /** @type {Map<string, number>} */
  const counts = new Map();
  /** @type {Set<string>} */
  const tags = new Set();
  for (const t of tokens) {
    const norm = normaliseTag(t);
    if (!norm) continue;
    counts.set(norm.category, (counts.get(norm.category) ?? 0) + 1);
    tags.add(norm.tag);
  }
  let bestCategory = null;
  let bestCount = 0;
  for (const [cat, n] of counts) {
    if (n > bestCount) { bestCategory = cat; bestCount = n; }
  }
  return { categoryId: bestCategory, tags: [...tags] };
}


/**
 * Validate a category id against the taxonomy.  Apps use this to
 * reject typo'd input early.
 */
export function isKnownCategory(id) {
  return CATEGORY_IDS.has(id);
}
