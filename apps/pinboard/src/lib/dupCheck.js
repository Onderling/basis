/**
 * dupCheck — near-duplicate-post warning helper.
 *
 * Pinboard V1 Phase 13.5 (2026-05-06; functional design § C7).  Pure
 * function: compare a candidate post body to a list of recent posts;
 * return whether one is a near-duplicate, plus which one.  No I/O.
 *
 * Threshold heuristic for V1:
 *   - normalise: lowercase, strip punctuation, collapse whitespace.
 *   - compare via Levenshtein-ratio: 1 - (distance / max(lenA, lenB)).
 *   - "near duplicate" iff ratio >= 0.8.
 *
 * The threshold is a guess; first-tester feedback will retune it.
 */

const NORMALISE_RE = /[^\p{L}\p{N}\s]/gu;
const WHITESPACE_RE = /\s+/g;

/** Normalise a post body for comparison. */
export function normalisePostText(text) {
  if (typeof text !== 'string') return '';
  return text.toLowerCase().replace(NORMALISE_RE, '').replace(WHITESPACE_RE, ' ').trim();
}

/**
 * Levenshtein edit distance between two strings.  V1 implementation:
 * O(n*m) DP; fine for post bodies (hundreds of chars).
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // Two-row DP to keep memory at O(min(n,m)).
  let prev = new Array(b.length + 1);
  let next = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    next[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(
        prev[j] + 1,        // deletion
        next[j - 1] + 1,    // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, next] = [next, prev];
  }
  return prev[b.length];
}

/**
 * Similarity ratio: 1 - distance / max-length.  Returns 1 for
 * identical, 0 for completely different.
 */
export function similarity(a, b) {
  const na = normalisePostText(a);
  const nb = normalisePostText(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  const d = levenshtein(na, nb);
  return 1 - d / Math.max(na.length, nb.length);
}

/**
 * Find the most similar prior post whose similarity ≥ threshold.
 * Returns `{ duplicate: priorPost, ratio }` or `null` when none hit.
 *
 * @param {string} candidateText
 * @param {Array<{id: string, text: string}>} priorPosts
 * @param {object} [opts]
 * @param {number} [opts.threshold=0.8]
 * @returns {{duplicate: object, ratio: number} | null}
 */
export function findNearDuplicate(candidateText, priorPosts, { threshold = 0.8 } = {}) {
  if (!Array.isArray(priorPosts)) return null;
  let best = null;
  for (const p of priorPosts) {
    if (!p || typeof p.text !== 'string') continue;
    const ratio = similarity(candidateText, p.text);
    if (ratio >= threshold && (best == null || ratio > best.ratio)) {
      best = { duplicate: p, ratio };
    }
  }
  return best;
}
