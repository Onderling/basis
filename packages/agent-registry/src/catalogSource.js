/**
 * catalogSource — the endorsement-backed curated catalog (commons-governance).
 *
 * Fills the `{ list, get }` seam that 's `createStubCatalog` stubbed. It is a
 * CQRS read-view: it never stores a canonical list — it DERIVES the catalog by
 * WALKING the web-of-trust of signed endorsements from a set of curator roots,
 * resolving each endorsed agent's Agent Card, and keeping only the ones whose
 * signed `recommend` verifies (`verifyEndorsement` — Ed25519 sig + expiry +
 * cardHash-binding). A `flag` (or an invalid/expired/mismatched endorsement)
 * excludes the card.
 *
 * ── G2 scope: MULTIPLE roots + TRANSITIVE walk + proximity ranking ──────────
 * G1 was single-root + flat (an endorsement counted only if its endorser was a
 * root). G2 generalises: `roots` is an array; the catalog is the union of what
 * is reachable from ANY root along a bounded transitive endorsement walk
 * (`walkTrustGraph` — see trustGraph.js for the walk, the curator-vs-agent
 * rule, flag precedence, and cycle safety). Ranking is by trust-path proximity
 * (closer to a root = higher), breadth (more distinct reachable endorsers) as a
 * tiebreak, then id for determinism.
 *
 * ── Reading the graph: two seams ────────────────────────────────────────────
 * The walk needs each curator's OWN published endorsements. Provide either:
 *   • `resolveEndorsements(endorserPubKey) → endorsement[]` — the general seam:
 *     each curator publishes their endorsement list at their own pod resource,
 *     resolved by pubKey. This is the real multi-pod web-of-trust.
 *   • `endorsementResource` (G1 back-compat) — a single shared `{ list() }` pool
 *     of endorsements from many endorsers; the walk derives each endorser's
 *     records by filtering the pool. `roots = [one]` over this pool reproduces
 *     G1's single-root semantics exactly (a valid special case).
 *
 * ── Offline cache (optional) ────────────────────────────────────────────────
 * Pass `cache: { read(): entries|null, write(entries): void }` and the derived,
 * ranked catalog is written on every successful build and READ BACK when a
 * build throws (endorsement resources / network unreachable) — the surface
 * survives offline. Same `{ list, get }` shape; entries are the ranked cards.
 *
 * The returned entries are plain Agent Cards (the SAME shape createStubCatalog
 * returned) with additive `x-onderling.endorsement` ranking metadata — so 's
 * installCores (`cardId`/`declaredSkills`/`cardToEntry`) consumes them
 * unchanged and the install still runs through the capability-security grant
 * path. cardHash is re-verified inside the walk on every `get`, so a card
 * swapped between list and install fails re-verify → `get` returns null →
 * install can't proceed (endorse-then-escalate defeated end-to-end).
 */

import { walkTrustGraph, DEFAULT_MAX_DEPTH } from './trustGraph.js';

/**
 * createCatalogSource — a `{ list, get }` source over the endorsement graph.
 *
 * @param {object} opts
 * @param {(endorser: string) => (object[]|Promise<object[]>)} [opts.resolveEndorsements]
 *   — per-curator endorsement lists (the general web-of-trust seam).
 * @param {{ list: () => Promise<object[]> }} [opts.endorsementResource]
 *   — G1 back-compat: one shared endorsement pool. Ignored if
 *     `resolveEndorsements` is given.
 * @param {string[]|string|(() => (string[]|Promise<string[]>))} opts.roots
 *   — curator root pubKey(s) (depth 0). A THUNK is resolved on every derive, so
 *     a live subscription set (subscribe/unsubscribe) takes effect immediately
 *     (commons-governance G3 — subscribed-community admins are the roots).
 * @param {(subject: string, endorsement: object) => (object|null|Promise<object|null>)} opts.resolveCard
 *   — resolves an endorsed agent's Agent Card by its subject pubKey.
 * @param {number} [opts.maxDepth=DEFAULT_MAX_DEPTH]  — bounded walk depth.
 * @param {{ read: () => (object[]|null), write: (entries: object[]) => void }} [opts.cache]
 *   — optional offline read-through cache.
 * @param {() => number} [opts.now]  — injectable clock (expiry; tests)
 * @returns {{ list: () => Promise<object[]>, get: (id: string) => Promise<object|null> }}
 */
export function createCatalogSource({
  resolveEndorsements,
  endorsementResource,
  roots,
  resolveCard,
  maxDepth = DEFAULT_MAX_DEPTH,
  cache,
  now,
} = {}) {
  const hasResolver = typeof resolveEndorsements === 'function';
  const hasResource = endorsementResource && typeof endorsementResource.list === 'function';
  if (!hasResolver && !hasResource) {
    throw Object.assign(
      new Error('createCatalogSource: resolveEndorsements(pubKey) or endorsementResource with list() required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  // roots may be a static array/string OR a thunk (live subscription set). A
  // thunk is resolved on every derive (see _resolveRoots), so subscribe/
  // unsubscribe is reflected without rebuilding the source (G3).
  const rootsThunk = typeof roots === 'function' ? roots : null;
  const staticRoots = rootsThunk ? [] : (Array.isArray(roots) ? roots : [roots]).filter((r) => typeof r === 'string' && r.length > 0);
  async function _resolveRoots() {
    const raw = rootsThunk ? await rootsThunk() : staticRoots;
    return (Array.isArray(raw) ? raw : [raw]).filter((r) => typeof r === 'string' && r.length > 0);
  }
  const resolve  = typeof resolveCard === 'function' ? resolveCard : () => null;
  const cacheOk  = cache && typeof cache.read === 'function' && typeof cache.write === 'function';

  const idOf = (card) => card?.['x-onderling']?.id ?? card?.agentId ?? card?.['x-onderling']?.pubKey ?? card?.pubKey ?? null;

  /**
   * Build the per-endorser lookup the walk consumes. With `resolveEndorsements`
   * it delegates directly; with the back-compat pool it reads the pool ONCE per
   * derive and groups by endorser (so each node's records are one filter away).
   */
  async function _endorsementsOf() {
    if (hasResolver) return resolveEndorsements;
    const records = await endorsementResource.list();
    const byEndorser = new Map();
    for (const rec of Array.isArray(records) ? records : []) {
      if (!rec || typeof rec.endorser !== 'string') continue;
      let arr = byEndorser.get(rec.endorser);
      if (!arr) { arr = []; byEndorser.set(rec.endorser, arr); }
      arr.push(rec);
    }
    return (endorser) => byEndorser.get(endorser) ?? [];
  }

  /**
   * Derive the verified, ranked catalog as a Map keyed by card id (so `list`
   * and `get` share one build and one card can't appear twice). Ordered by the
   * deterministic ranking: proximity (depth asc), breadth (count desc), id asc.
   */
  async function _derive() {
    const endorsementsOf = await _endorsementsOf();
    const rootList = await _resolveRoots();
    const ranked = await walkTrustGraph({ roots: rootList, endorsementsOf, resolveCard: resolve, maxDepth, now });

    const projected = [];
    for (const cand of ranked) {
      const id = idOf(cand.card);
      if (typeof id !== 'string' || id.length === 0) continue;
      projected.push({ id, entry: _rank(cand.card, cand) });
    }
    // Authoritative deterministic order (id is the observable, stable tiebreak).
    projected.sort((a, b) => {
      const ea = a.entry['x-onderling'].endorsement;
      const eb = b.entry['x-onderling'].endorsement;
      if (ea.depth !== eb.depth) return ea.depth - eb.depth;          // proximity
      if (eb.count !== ea.count) return eb.count - ea.count;          // breadth
      return String(a.id).localeCompare(String(b.id));               // stable
    });

    const byId = new Map();
    for (const { id, entry } of projected) if (!byId.has(id)) byId.set(id, entry);
    return byId;
  }

  /** Derive; on failure fall back to the offline cache. On success, refresh it. */
  async function _entries() {
    try {
      const byId    = await _derive();
      const entries = [...byId.values()];
      if (cacheOk) { try { cache.write(entries); } catch { /* cache is best-effort */ } }
      return entries;
    } catch (err) {
      if (cacheOk) {
        const cached = cache.read();
        if (Array.isArray(cached)) return cached;
      }
      throw err;
    }
  }

  return {
    async list() {
      return _entries();
    },
    async get(id) {
      const entries = await _entries();
      return entries.find((c) => idOf(c) === id) ?? null;
    },
  };
}

/**
 * Attach additive endorsement/ranking metadata under `x-onderling.endorsement`
 * without disturbing any A2A/x-onderling field reads. `count` = distinct
 * reachable endorsers (G1-compatible); `depth` = shortest trust-path proximity.
 */
function _rank(card, { depth, endorsers, tags }) {
  const xc = card?.['x-onderling'] ?? {};
  const ranked = {
    ...xc,
    endorsement: {
      count:     endorsers.length,
      endorsers: [...endorsers],
      tags:      [...tags],
      depth,
    },
  };
  return { ...card, 'x-onderling': ranked };
}
