/**
 * circleRetriever — the circle bot's RAG retriever (shared web + mobile).
 *
 * This is the `retrieve` hook the token gate (`tokenGate.js`) calls on the
 * `via:'llm'` path: given the user's message, return the few circle items most
 * relevant to it, which `interpretCommand.withContext` then weaves into the LLM
 * prompt so the model answers grounded in THIS circle's actual tasks/posts —
 * with far fewer tokens than dumping the whole circle.  Retrieval only fires
 * when a turn is already headed to the model (rules/skip never call it).
 *
 * TIER 1 (this file) — LEXICAL: token-overlap ranking over the circle's items.
 * No model, no embeddings, no network beyond the item load, no privacy leak.
 * Good enough to ground references like "is that ladder thing still open?".
 *
 * TIER 2 — SEMANTIC: cosine over embeddings (better recall — synonyms/paraphrase).
 * `makeSemanticRetriever` embeds the query + candidate items via an injected
 * `embed(texts)→vectors` (an `@onderling/llm-client` `EmbeddingClient`, pointed at
 * the Privatemode enclave / Ollama / any `/v1/embeddings` route — see
 * `circleEmbedProviders` + `embedPicker`), ranks by cosine, and GRACEFULLY FALLS
 * BACK to lexical if the embedder is absent or errors (enclave unreachable).
 * The gate/dispatch/interpret are unchanged — same `retrieve` seam.
 *
 * Placement (invariant #7): embeddings go in the SAME trust boundary as the chat
 * LLM — enclave for sealed circles, NOT a plain remote.
 *
 * ── L RAG-wiring (this file, feature/l-rag-semantic-retrieve) ──
 * `makeCircleRetriever` now backs retrieval with a PERSISTENT `@onderling/pod-search`
 * hybrid index (`makePodSearchRetriever`) instead of re-embedding the whole
 * candidate set on every query. Each circle's items are indexed ONCE into a
 * per-circle `PodSearch` (content-hash cache ⇒ an unchanged item is never
 * re-embedded; a `vectorStore` ⇒ vectors survive a restart, under
 * `private/state/search-index/` by construction — never `sharing/`), and each
 * `retrieve()` runs `query({mode:'hybrid'})` (RRF k=60 of the lexical + cosine
 * rankings — a synonym/paraphrase match a pure-lexical query misses). The
 * embedder is resolved from the circle's embed policy exactly as folio `/zoek`
 * does (`resolveCircleEmbedder`, `llmTool`/`embedTool` gate): NO embedder /
 * `llmTool:'off'` ⇒ hybrid silently degrades to LEXICAL with ZERO embed calls.
 * The retriever's OUTPUT SHAPE is unchanged (`{id,type,text}` context entries the
 * token gate + `interpret.contextLine` consume) — the PodSearch backing is an
 * internal upgrade. The on-the-fly `makeSemanticRetriever`/`lexicalRank` path is
 * kept as a graceful fallback behind the same gate (a PodSearch build error).
 *
 * DEFERRED SEAM: the feedback token-gate (a separate branch) can reuse this same
 * `makePodSearchRetriever` for its corpus; wire it there, not here.
 */

import { PodSearch, hash as defaultHash } from '@onderling/pod-search';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/**
 * Default semantic cosine floor for circle RAG retrieval. pod-search stores
 * vectors unit-normalised, so a hybrid/semantic hit's score is a cosine in
 * roughly [0..1]; anything below this floor is an ≈orthogonal, near-noise match
 * that gets DROPPED before it can pollute the RRF fusion (better no context than
 * irrelevant context). `0.1` is the same conservative floor the pod-search
 * vector-layer tests and the existing circle-RAG tests exercise, and is
 * consistent with folio `/zoek`'s `minScore` units (folio hardcodes no default —
 * it forwards a caller-supplied value — so there is no folio default to match;
 * 0.1 is the shared, defensible convention). Overridable per call via
 * `makeCircleRetriever({ minScore })` (pass `0` to disable the floor).
 */
export const DEFAULT_CIRCLE_RAG_MIN_SCORE = param({ key: 'circleRag.minScore', scope: PARAM_SCOPE.CIRCLE, kind: PARAM_KIND.INTERNAL, default: 0.1 });

// Minimal bilingual stop-word set (EN + NL) so common glue words don't inflate
// the overlap score. Kept tiny on purpose — it's a relevance nudge, not an NLP
// pipeline; the deferred semantic tier handles real paraphrase.
const STOP_WORDS = new Set([
  // EN
  'the', 'a', 'an', 'is', 'are', 'was', 'be', 'to', 'of', 'and', 'or', 'in', 'on',
  'for', 'do', 'did', 'does', 'i', 'you', 'it', 'that', 'this', 'my', 'me', 'we',
  'with', 'at', 'as', 'still', 'open', 'any', 'some', 'about',
  // NL
  'de', 'het', 'een', 'zijn', 'en', 'of', 'op', 'voor', 'ik', 'jij', 'je', 'dat',
  'dit', 'mijn', 'we', 'nog', 'er', 'om', 'met', 'aan', 'als', 'wat', 'wie',
]);

/** Lowercase → alphanumeric tokens, dropping 1-char tokens + stop-words. */
function tokenize(s) {
  return String(s ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/** The text a candidate item is matched against (tolerant of several shapes). */
function searchableText(it) {
  if (it == null) return '';
  if (typeof it === 'string') return it;
  return it.label ?? it.text ?? it.title ?? it.name ?? it.summary ?? '';
}

/** Project a ranked item → the context-entry shape `interpret.contextLine` reads. */
function toContextEntry(it) {
  if (typeof it === 'string') return { text: it };
  const kind = it.kind ?? it.type ?? null;
  const label = searchableText(it) || (it.id != null ? String(it.id) : '');
  return {
    id: it.id ?? null,
    type: kind,
    // `kind: label` reads well in the prompt ("task: Return the ladder") and
    // contextLine falls through meaning/label → text, so it surfaces this string.
    text: kind ? `${kind}: ${label}` : label,
  };
}

/**
 * Rank `items` by lexical overlap with `query`; return the top `limit` as
 * context entries. Pure + synchronous + side-effect-free (unit-testable).
 * Score = count of DISTINCT query tokens that appear in the item; ties keep the
 * input order (callers pass items recent-first, so recent wins a tie). Items
 * with zero overlap are dropped — better no context than irrelevant context.
 *
 * @param {Array<object|string>} items
 * @param {string} query
 * @param {{limit?:number}} [opts]
 * @returns {Array<{id?:any,type?:any,text:string}>}
 */
export function lexicalRank(items, query, { limit = 5 } = {}) {
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0 || !Array.isArray(items)) return [];
  const scored = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const tokens = tokenize(searchableText(it));
    if (tokens.length === 0) continue;
    let overlap = 0;
    const counted = new Set();
    for (const tok of tokens) {
      if (qTokens.has(tok) && !counted.has(tok)) { overlap += 1; counted.add(tok); }
    }
    if (overlap > 0) scored.push({ it, overlap, i });
  }
  scored.sort((a, b) => (b.overlap - a.overlap) || (a.i - b.i)); // score desc, stable on input order
  return scored.slice(0, Math.max(0, limit)).map(({ it }) => toContextEntry(it));
}

/**
 * Build the gate's `retrieve(text, ctx)` from an injected item loader. The shell
 * supplies `loadItems(ctx)` (its dispatch + current circle) so the ranking logic
 * stays one shared copy; web and mobile differ only in that adapter. Best-effort:
 * a failing/empty load contributes no context (the LLM still runs, ungrounded).
 *
 * @param {{loadItems:(ctx:object)=>Promise<Array>|Array, limit?:number}} a
 * @returns {(text:string, ctx?:object)=>Promise<Array>}
 */
export function makeLexicalRetriever({ loadItems, limit = 5 } = {}) {
  return async (text, ctx = {}) => {
    if (typeof loadItems !== 'function') return [];
    let items = [];
    try { items = (await loadItems(ctx)) || []; } catch { return []; }
    return lexicalRank(items, text, { limit });
  };
}

/** Cosine similarity of two equal-length numeric vectors (0 if degenerate). */
export function cosineSim(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * TIER-2 SEMANTIC retriever. Embeds the query + candidate items via the injected
 * `embed(texts)→Promise<vectors>` (one batched call), ranks by cosine, returns
 * the top `limit` as context entries. Degrades GRACEFULLY: no embedder, or an
 * embed error (enclave unreachable), falls back to `lexicalRank` over the same
 * already-loaded items — so semantic is a strict upgrade, never a regression.
 *
 * @param {{embed?:(texts:string[])=>Promise<number[][]>, loadItems:Function, limit?:number, minScore?:number}} a
 * @returns {(text:string, ctx?:object)=>Promise<Array>}
 */
export function makeSemanticRetriever({ embed, loadItems, limit = 5, minScore = 0 } = {}) {
  return async (text, ctx = {}) => {
    if (typeof loadItems !== 'function') return [];
    let items = [];
    try { items = (await loadItems(ctx)) || []; } catch { return []; }
    if (typeof embed !== 'function') return lexicalRank(items, text, { limit });

    const candidates = items.filter((it) => searchableText(it));
    if (candidates.length === 0) return [];

    let vectors;
    try {
      vectors = await embed([String(text ?? ''), ...candidates.map(searchableText)]);
    } catch {
      return lexicalRank(items, text, { limit });   // embedder down → graceful lexical fallback
    }
    const qVec = Array.isArray(vectors) ? vectors[0] : null;
    if (!Array.isArray(qVec)) return lexicalRank(items, text, { limit });

    const scored = [];
    for (let i = 0; i < candidates.length; i++) {
      const v = vectors[i + 1];
      if (!Array.isArray(v) || v.length !== qVec.length) continue;
      const score = cosineSim(qVec, v);
      if (score > minScore) scored.push({ it: candidates[i], score, i });
    }
    scored.sort((a, b) => (b.score - a.score) || (a.i - b.i));   // score desc, recent (input order) tie-break
    return scored.slice(0, Math.max(0, limit)).map(({ it }) => toContextEntry(it));
  };
}

/* ─── PodSearch-backed retriever (L RAG-wiring) ─────────────────────────────
 *
 * The circle-item corpus wired onto `@onderling/pod-search` — the persistent,
 * hybrid sibling of the on-the-fly tiers above. Mirrors folio's `/zoek`
 * consumer (`apps/folio/src/folioSearch.js`): a tiny schema, an embedder
 * normaliser, a row projector, then index-once + `query({mode:'hybrid'})`.
 */

/**
 * The circle-item schema. `id` is the primary key; `text` (the item's label) is
 * the lexically-searchable AND embeddable surface; `kind` is a facet. `oid`
 * (the item's ORIGINAL id, possibly null) rides along as a stored passthrough so
 * the context entry round-trips to the exact `toContextEntry` shape.
 */
export const CIRCLE_ITEM_SCHEMA = {
  fields: {
    id:   { primary: true },
    text: { fts: true, weight: 1, embed: true },
    kind: { facet: true },
  },
};

/**
 * Project a loaded circle item (the `{id,label,kind,…}` `loadCircleItems`
 * returns — tolerant of plain strings / other shapes too) onto a PodSearch row.
 * A missing id is synthesised (from the text, else the batch index) so the row
 * is always indexable; the ORIGINAL id is preserved in `oid` for round-trip.
 *
 * @param {object|string} row
 * @param {number} i  batch index (id-of-last-resort)
 */
export function circleItemFromRow(row, i = 0) {
  const text = searchableText(row);
  const isObj = row != null && typeof row === 'object';
  const oid = isObj ? (row.id ?? null) : null;
  const kind = isObj ? (row.kind ?? row.type ?? null) : null;
  const id = oid != null ? String(oid) : (text ? `t:${text}` : `i:${i}`);
  const item = { id, text, oid };
  if (kind != null) item.kind = String(kind);
  return item;
}

/**
 * Rebuild the `{id,type,text}` context entry from a PodSearch result row —
 * byte-identical to `toContextEntry` for a normalised object item, so the token
 * gate / `interpret.contextLine` contract is unchanged.
 */
function indexedToContextEntry(item) {
  const kind = item?.kind ?? null;
  const label = item?.text || (item?.oid != null ? String(item.oid) : '');
  return { id: item?.oid ?? null, type: kind, text: kind ? `${kind}: ${label}` : label };
}

/**
 * Normalise an injected embedder to the shape PodSearch reads (`{id, dim?, embed}`).
 * Same adapter folio uses: a mock provider already carries `.id`; an
 * `@onderling/llm-client` `EmbeddingClient` exposes `.model`/`.providerId` instead,
 * so the resolved circle embedder can be handed in RAW. Anything without an
 * `embed()` ⇒ `undefined` (lexical-only, no embed call).
 */
function normalizeEmbedder(e) {
  if (!e || typeof e.embed !== 'function') return undefined;
  if (typeof e.id === 'string') return e;
  const id = e.model ?? e.providerId ?? e.modelId ?? 'circle-embedder';
  return { id, ...(e.dim !== undefined ? { dim: e.dim } : {}), embed: (t, o) => e.embed(t, o) };
}

/**
 * PodSearch-backed circle retriever. Keeps a per-circle `PodSearch` (keyed by
 * `ctx.circleId`, scoped `<scope>/<circleId>` on the store so circles never
 * bleed into each other), indexes that circle's loaded items into it, and runs a
 * `hybrid` query. Restart-safe when a `vectorStore` is injected; embed-once via
 * the content-hash cache regardless. Degrades GRACEFULLY: a null/absent embedder
 * ⇒ lexical-only hybrid, NO embed call; a PodSearch failure ⇒ the on-the-fly
 * `makeSemanticRetriever`/`lexicalRank` fallback (same gate, same output shape).
 *
 * `embedder` may be an embedder OBJECT, or a resolver `(ctx)=>embedder|null`
 * (sync/async) — the latter re-checks the circle's embed policy per turn and
 * rebuilds the circle's index when the resolved embedder identity changes
 * (mirrors folio's `setNoteEmbedder`).
 *
 * @param {{embedder?:object|Function, loadItems:Function, limit?:number,
 *          hash?:Function, vectorStore?:object, scope?:string, minScore?:number,
 *          audit?:Function}} a
 * @returns {(text:string, ctx?:object)=>Promise<Array>}
 */
export function makePodSearchRetriever({
  embedder, loadItems, limit = 5,
  hash = defaultHash, vectorStore, scope = 'circle-rag', minScore, audit,
} = {}) {
  const resolve = typeof embedder === 'function' ? embedder : () => embedder;
  const cache = new Map(); // circleKey → { search, embedderRef }

  return async (text, ctx = {}) => {
    if (typeof loadItems !== 'function') return [];
    let items = [];
    try { items = (await loadItems(ctx)) || []; } catch { return []; }

    let resolved;
    try { resolved = await resolve(ctx); } catch { resolved = null; }
    const emb = normalizeEmbedder(resolved);

    const circleKey = ctx?.circleId != null ? String(ctx.circleId) : '__default__';
    let entry = cache.get(circleKey);
    if (!entry || entry.embedderRef !== (emb ?? null)) {
      entry = {
        embedderRef: emb ?? null,
        search: new PodSearch({
          schema: CIRCLE_ITEM_SCHEMA,
          embedder: emb, hash, vectorStore,
          scope: `${scope}/${circleKey}`, audit,
        }),
      };
      cache.set(circleKey, entry);
    }

    const rows = items.map((it, i) => circleItemFromRow(it, i)).filter((r) => r.text);
    try {
      if (rows.length) await entry.search.indexBatch(rows);
      const res = await entry.search.query({ text: String(text ?? ''), mode: 'hybrid', limit, minScore });
      return (res?.items || []).map(indexedToContextEntry);
    } catch {
      // PodSearch build/index/query failed → graceful on-the-fly fallback, same
      // gate + same output shape. Reuse the already-loaded items (no re-load).
      if (emb) {
        return makeSemanticRetriever({ embed: emb.embed, loadItems: () => items, limit, minScore: minScore ?? 0 })(text, ctx);
      }
      return lexicalRank(items, text, { limit });
    }
  };
}

/**
 * The gate-facing retriever factory. Backed by the persistent `@onderling/pod-search`
 * hybrid index (`makePodSearchRetriever`): SEMANTIC + lexical fused when an
 * embedder is configured (resolved from the circle's embed policy via
 * `resolveCircleEmbedder`), else LEXICAL-only with zero embed calls. One call
 * site for the shells; the `retrieve` seam + `{id,type,text}` output are the same.
 *
 * Back-compat: a bare `embed(texts)→vectors` fn is still accepted (wrapped into
 * an embedder object) so the existing shell wiring / tests keep working; prefer
 * passing `embedder` (an object or a policy resolver) for per-turn gating +
 * persistence seams (`vectorStore`, `scope`, `hash`, `minScore`, `audit`).
 *
 * `minScore` DEFAULTS to `DEFAULT_CIRCLE_RAG_MIN_SCORE` (a semantic cosine floor
 * that drops near-noise hybrid matches) so EVERY shell gets the floor by
 * construction — web ≡ mobile, no per-shell literal to drift. Override per call
 * (pass `0` to disable). The floor only bites the semantic/hybrid path; lexical-
 * only retrieval (no embedder) is unaffected, so the graceful fallback is intact.
 *
 * @param {{embed?:Function, embedder?:object|Function, loadItems:Function,
 *          limit?:number, hash?:Function, vectorStore?:object, scope?:string,
 *          minScore?:number, audit?:Function}} a
 */
export function makeCircleRetriever({
  embed, embedder, loadItems, limit = 5,
  hash, vectorStore, scope, minScore = DEFAULT_CIRCLE_RAG_MIN_SCORE, audit,
} = {}) {
  const resolvedEmbedder = embedder ?? (typeof embed === 'function' ? { id: 'circle-embed', embed } : undefined);
  return makePodSearchRetriever({ embedder: resolvedEmbedder, loadItems, limit, hash, vectorStore, scope, minScore, audit });
}
