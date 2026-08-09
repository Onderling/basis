/**
 * basis v2 — offering-match source.
 *
 * When a user posts an offering-question in a circle, the app should surface
 * inline candidate matches: members of the circle whose declared offerings
 * overlap the question, plus optionally agents and via-hop
 * candidates. The RENDERER + the match card shape
 * (`buildOfferingMatches`) shipped earlier; this is the SOURCE — picking
 * the candidates from a real directory.
 *
 * Pure: hosts pass the directory + offering catalogue + the user query;
 * we tokenize, score, rank, and return `{id, label, source, score,
 * matchedTokens}[]` ready for `buildOfferingMatches`.  The chat-shell
 * integration (rendering the matches under a posted question + wiring
 * the [Ask]/[Skip] taps) lives in the follow-up.
 *
 * Scoring is intentionally simple at V0: case-folded token containment
 * with a small bonus for category / radius / openness signals.  Real
 * relevance signals (per-skill openness against the asker's circles,
 * status: actief/gepauzeerd, distance buckets) land when the substrate
 * declares them on a candidate; the helper is forward-compatible.
 */

import { MATCH_SOURCES } from './circleOfferings.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';   // re-exported from @onderling/core

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'do', 'for', 'from',
  'has', 'have', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or',
  'that', 'the', 'this', 'to', 'with', 'you', 'your',
  // Dutch — every-day fillers.
  'de', 'het', 'een', 'en', 'is', 'in', 'op', 'van', 'voor', 'naar',
  'ik', 'jij', 'wij', 'mijn', 'jouw', 'iemand', 'wie', 'wat',
]);

// Parameter register (#36) — default offering-match result cap (scope:device, kind:internal).
const MAX_RESULTS_DEFAULT = param({ key: 'kringHost.maxResults', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 5 });

/**
 * Tokenize free text → lowercased non-stopword tokens.  Exposed for
 * tests + so hosts can tokenize the query the same way before passing
 * to alternative scorers (e.g. embeddings later).
 */
export function tokenize(s) {
  if (typeof s !== 'string') return [];
  const lowered = s.toLowerCase();
  const tokens = lowered.match(/[a-zà-öø-ÿ]+/gi) ?? [];
  return tokens.filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * Rank candidates against a free-text query.
 *
 * @param {object} args
 * @param {string} args.query                  user question text
 * @param {object[]} [args.members=[]]         circle members; each {webid|id, displayName|handle|label, offerings:[{text|label, category?, openness?}]} (legacy `skills` read-accepted)
 * @param {object[]} [args.agents=[]] agent participants; same offering shape
 * @param {object[]} [args.hopCandidates=[]] via-hop candidates; same offering shape
 * @param {number}   [args.maxResults]
 * @returns {Array<{id:string, label:string, source:'human'|'agent'|'via-hop', score:number, matchedTokens:string[], skill:string|null}>}
 */
export function findOfferingMatches({
  query,
  members = [],
  agents = [],
  hopCandidates = [],
  maxResults = MAX_RESULTS_DEFAULT,
} = {}) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const scoreOne = (cand, source) => {
    // Read-accept: new callers pass `offerings`; legacy callers pass `skills`.
    const offerings = Array.isArray(cand?.offerings) ? cand.offerings
                    : Array.isArray(cand?.skills)    ? cand.skills
                    : [];
    let best = null;
    for (const sk of offerings) {
      const skillText = pickText(sk);
      if (!skillText) continue;
      const skillTokens = tokenize(skillText);
      const matched = queryTokens.filter((q) => skillTokens.includes(q));
      if (matched.length === 0) continue;
      // Base score: matched-token ratio against the query, +0.5 per
      // matched token (so 2 matches beat 1 match in a short query),
      // small floor so any match shows up.
      const ratio = matched.length / queryTokens.length;
      const score = ratio + matched.length * 0.5;
      if (!best || score > best.score) {
        best = { score, skill: skillText, matchedTokens: matched };
      }
    }
    if (!best) return null;
    return {
      id:            cand?.id ?? cand?.webid ?? null,
      label:         pickLabel(cand) ?? '(unknown)',
      source,
      score:         best.score,
      matchedTokens: best.matchedTokens,
      skill:         best.skill,
    };
  };

  const out = [];
  for (const m of asArray(members))       { const r = scoreOne(m, 'human');    if (r) out.push(r); }
  for (const a of asArray(agents))        { const r = scoreOne(a, 'agent');    if (r) out.push(r); }
  for (const h of asArray(hopCandidates)) { const r = scoreOne(h, 'via-hop');  if (r) out.push(r); }

  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie-break: human > agent > via-hop (closer first).
    return sourceRank(a.source) - sourceRank(b.source);
  });
  return out.slice(0, Math.max(1, maxResults | 0));
}

function pickText(skill) {
  if (typeof skill === 'string') return skill;
  if (!skill || typeof skill !== 'object') return null;
  const cands = [skill.text, skill.label, skill.title, skill.what];
  for (const c of cands) if (typeof c === 'string' && c.trim()) return c.trim();
  return null;
}

function pickLabel(cand) {
  if (!cand || typeof cand !== 'object') return null;
  const cands = [cand.displayName, cand.handle, cand.label, cand.name];
  for (const c of cands) if (typeof c === 'string' && c.trim()) return c.trim();
  return cand.webid ?? cand.id ?? null;
}

function asArray(v) { return Array.isArray(v) ? v : []; }

function sourceRank(s) {
  if (s === 'human')  return 0;
  if (s === 'agent')  return 1;
  if (s === 'via-hop') return 2;
  return 3;
}

export { MATCH_SOURCES };
