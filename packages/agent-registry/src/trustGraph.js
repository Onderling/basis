/**
 * trustGraph — the web-of-trust endorsement walk (commons-governance G2).
 *
 * G1 shipped a SINGLE-root, FLAT catalogue: an endorsement counted only if its
 * `endorser` was one of the configured roots. G2 makes the catalogue a real
 * web-of-trust: MULTIPLE curator roots and a TRANSITIVE walk over the
 * endorsement graph to a bounded depth, ranked by trust-path proximity.
 *
 * ── The graph ──────────────────────────────────────────────────────────────
 * An endorsement's `endorser` and `subject` are BOTH pubKeys, so an endorser
 * can itself be endorsed — that is what makes the endorsement set a graph. A
 * `recommend` edge `endorser → subject` means "I, endorser, vouch for subject."
 * The walk is a bounded BFS from the roots (depth 0) over these edges.
 *
 * ── The one design rule the plan left to pick (documented) ───────────────────
 * "Endorses a curator" (extends the walk) vs "endorses an agent" (a catalogue
 * candidate). Because an endorsement BINDS to a cardHash, endorsing anything —
 * agent OR curator — requires that thing to have a resolvable Agent Card (the
 * hash is checked at verify). So "resolveCard succeeds ⇒ agent" cannot tell the
 * two apart. The rule we adopt instead is uniform + testable:
 *
 *   1. REACHABILITY is universal — every verified `recommend` puts its subject
 *      in the graph as a node at depth+1 (the "endorser ∈ the graph" rule), so
 *      the walk continues through it (bounded, cycle-guarded). A pure agent that
 *      published no endorsements simply contributes no further edges — harmless.
 *   2. CANDIDACY is by card ROLE — a subject is offered for INSTALL (a catalogue
 *      candidate) unless its card declares a curator role
 *      (`x-onderling.role ∈ {curator, community}`). A curator identity card is a
 *      trust node you walk THROUGH, not an agent you install. Every other role
 *      (the fixtures' default `service`, plus `agent`, …) is an installable
 *      candidate. This keeps ALL of G1's `role:'service'` cards as candidates
 *      (no regression) and lets a curator publish a `role:'curator'` card that
 *      routes trust without polluting the install list.
 *
 * ── Bounded depth ────────────────────────────────────────────────────────────
 * `maxDepth` = the maximum CANDIDATE depth = the max number of endorsement hops
 * from a root. A candidate endorsed by a node at node-depth `d` sits at
 * candidate-depth `d+1`; it is included iff `d+1 ≤ maxDepth`. Equivalently we
 * read the endorsements of nodes with node-depth `< maxDepth`. A root endorsing
 * an agent directly ⇒ candidate-depth 1; root → curator B → agent X ⇒ depth 2.
 *
 * ── Flag precedence (documented decision) ────────────────────────────────────
 * A verified `flag` from ANY reachable curator EXCLUDES the subject outright,
 * regardless of depth — even if a closer curator recommends it. Moderation is
 * decisive within the graph you chose to trust. This is exactly G1's "flag wins
 * over recommend," generalised to the whole reachable set (so single-root G2 ==
 * G1). A depth-weighted "closer recommend beats a farther flag" is a possible
 * future refinement (noted for Frits) but the conservative default is: a
 * reachable curator's warning always wins.
 *
 * ── Ranking (deterministic) ──────────────────────────────────────────────────
 * Candidates are ordered by:
 *   1. trust-path proximity — shortest candidate-depth ASC (closer to a root
 *      ranks higher),
 *   2. breadth — number of DISTINCT reachable endorsers DESC (more curators in
 *      your graph vouch for it ⇒ higher) as a tiebreak,
 *   3. id ASC (localeCompare) — a stable final tiebreak for determinism.
 *
 * ── Cycle safety ─────────────────────────────────────────────────────────────
 * A `visited` set of expanded endorser pubKeys means each node's endorsements
 * are read at most once; an `a ↔ b` (or self) endorsement cycle terminates.
 *
 * Verification is NOT re-implemented — every edge is validated with G1's
 * `verifyEndorsement` (Ed25519 sig + expiry + subject-binding + cardHash), so
 * an escalate-after-endorse card swap drops the edge here too (invariant #3).
 */

import { verifyEndorsement } from './endorsement.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';

/** Card roles that mark a TRUST NODE (walked through) rather than an installable agent. */
export const CURATOR_ROLES = new Set(['curator', 'community']);

function roleOf(card) {
  const r = card?.['x-onderling']?.role ?? card?.role ?? null;
  return typeof r === 'string' ? r : null;
}
function isCuratorCard(card) {
  return CURATOR_ROLES.has(roleOf(card));
}

/** Default maximum candidate depth for `walkTrustGraph`'s bounded BFS over the endorsement graph. */
// Parameter register (#36) — trust-graph BFS depth bound (scope:device, kind:internal).
export const DEFAULT_MAX_DEPTH = param({ key: 'trustGraph.maxDepth', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 4 });

/**
 * walkTrustGraph — bounded BFS over the endorsement graph from `roots`.
 *
 * @param {object} opts
 * @param {string[]} opts.roots  — curator root pubKeys (depth 0).
 * @param {(endorser: string) => (object[]|Promise<object[]>)} opts.endorsementsOf
 *   — that endorser's PUBLISHED endorsement records (their pod resource). Only
 *     records whose signed `endorser` === the queried pubKey are honoured.
 * @param {(subject: string, endorsement: object) => (object|null|Promise<object|null>)} opts.resolveCard
 *   — resolves the endorsed subject's Agent Card (then cardHash-verified).
 * @param {number} [opts.maxDepth=DEFAULT_MAX_DEPTH]  — max candidate depth.
 * @param {() => number} [opts.now]  — injectable clock (expiry).
 * @returns {Promise<Array<{ subject, card, depth, endorsers: string[], tags: string[] }>>}
 *   ranked candidates (proximity, then breadth, then id).
 */
export async function walkTrustGraph({ roots, endorsementsOf, resolveCard, maxDepth = DEFAULT_MAX_DEPTH, now } = {}) {
  const rootList = (Array.isArray(roots) ? roots : [roots]).filter((r) => typeof r === 'string' && r.length > 0);
  const resolve  = typeof resolveCard === 'function' ? resolveCard : () => null;
  const readEndorsements = typeof endorsementsOf === 'function' ? endorsementsOf : () => [];
  const depthCap = Number.isInteger(maxDepth) && maxDepth > 0 ? maxDepth : DEFAULT_MAX_DEPTH;

  const visited    = new Set();                 // endorser pubKeys already expanded (cycle guard)
  const candidates = new Map();                 // subject → { subject, card, depth, endorsers:Set, tags:Set }
  const flagged    = new Set();                 // subject pubKeys a reachable curator flagged

  // BFS queue; uniform edge weight ⇒ first pop of a node is its shortest depth.
  const queue = rootList.map((pk) => ({ pk, depth: 0 }));

  while (queue.length > 0) {
    const { pk, depth } = queue.shift();
    if (visited.has(pk)) continue;              // cycle-safe: expand each node once
    visited.add(pk);
    if (depth >= depthCap) continue;            // its candidates would be depth+1 > maxDepth

    const recs = await readEndorsements(pk);
    for (const rec of Array.isArray(recs) ? recs : []) {
      if (!rec || rec.endorser !== pk) continue;          // integrity: only this endorser's own claims
      const card  = await resolve(rec.subject, rec);
      const actor = verifyEndorsement(rec, card, now ? { now } : undefined);
      if (!actor) continue;                                // invalid / expired / cardHash-mismatch → edge dropped

      const candDepth = depth + 1;

      if (actor.claim === 'flag') {
        flagged.add(actor.subject);                        // flag excludes outright (see header)
        continue;
      }

      // recommend — REACHABILITY: subject becomes a walkable node (endorser ∈ graph).
      if (!visited.has(actor.subject)) queue.push({ pk: actor.subject, depth: candDepth });

      // CANDIDACY: installable unless the card is a curator/community trust node.
      if (isCuratorCard(card)) continue;
      let bucket = candidates.get(actor.subject);
      if (!bucket) {
        bucket = { subject: actor.subject, card, depth: candDepth, endorsers: new Set(), tags: new Set() };
        candidates.set(actor.subject, bucket);
      }
      if (candDepth < bucket.depth) { bucket.depth = candDepth; bucket.card = card; }
      bucket.endorsers.add(pk);
      for (const t of actor.tags) bucket.tags.add(t);
    }
  }

  const ranked = [...candidates.values()]
    .filter((b) => !flagged.has(b.subject))                // flag precedence: absolute exclusion
    .map((b) => ({ subject: b.subject, card: b.card, depth: b.depth, endorsers: [...b.endorsers], tags: [...b.tags] }));

  ranked.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;                       // 1. proximity
    if (a.endorsers.length !== b.endorsers.length) return b.endorsers.length - a.endorsers.length; // 2. breadth
    return String(a.subject).localeCompare(String(b.subject));              // 3. stable
  });
  return ranked;
}
