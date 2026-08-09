/**
 * PodSearch — substrate version.
 *
 * V0: pure-JS in-memory backend with the same public API as the
 * eventual FTS5-backed implementation.  Consumer apps integrate
 * against the API; switching to FTS5 (better-sqlite3 / expo-sqlite)
 * is a backend swap.
 *
 * Per L1i sketch +: existing Archive CLI lib's FTS5 schema +
 * indexer logic informs the schema shape; the substrate ships the
 * pure-JS V0; FTS5 backend is V1.
 *
 * ── Vector layer V0 (Phase 52.22, PLAN-podsearch-v2-embeddings) ──
 * When an `embedder` (an EmbeddingProvider-shaped object, §3.1) is
 * injected and one or more fields carry `embed: true`, PodSearch also
 * maintains an in-memory cosine index and exposes semantic + hybrid
 * query modes, `similar()`, and `semanticReady`.  The embedder is
 * **injected, duck-typed** — pod-search never imports `@onderling/llm-client`
 * (substrates don't import each other; §1 layering).  Absent embedder ⇒
 * lexical-only, byte-compatible with the pre-52.22 surface.
 *
 * In-memory here; **persistence, restart-safe caches, tombstone
 * eviction, and backfill are Phases 52.23/52.24** — the `vectorStore`,
 * `hash`, and `chunking` deps are accepted and threaded as seams, but
 * this phase keeps the whole index (and the content-hash → vector cache)
 * in process memory only.
 *
 * Schema:
 *   {
 *     fields: {
 *       <field>: { primary?, fts?, weight?, facet?, sortable?, multi?, embed? }
 *     }
 *   }
 */

import { VectorIndex } from './VectorIndex.js';
import { chunkText, resolveChunking } from './chunking.js';
import { codedError } from './errors.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';

// Parameter register (#36) — default search result limit (scope:device, kind:internal; caller overrides per query).
const DEFAULT_LIMIT = param({ key: 'podSearch.defaultLimit', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 50 });
const RRF_K = 60; // reciprocal rank fusion constant (pre-decided)

export class PodSearch {
  /** @type {object} */ #schema;
  /** @type {Map<string, object>} */ #items = new Map();
  /** @type {string} */ #primaryField;
  /** @type {Array<{name: string, weight: number}>} */ #ftsFields;
  /** @type {string[]} */ #facetFields;
  /** @type {string[]} */ #sortableFields;

  // ── vector layer (52.22) ──
  /** @type {string[]} fields flagged `embed: true` */ #embedFields;
  /** @type {import('./chunking.js').ChunkingConfig} */ #chunking;
  /** @type {{ id: string, dim?: number, embed: (t: string[]) => Promise<Float32Array[]> } | null} */ #embedder;
  /** @type {((text: string) => Promise<string>) | null} */ #hash;
  /** @type {object | null} StorageBackend-shaped — seam for 52.23 persistence */ #vectorStore;
  /** @type {((event: object) => void) | null} */ #audit;
  /** @type {VectorIndex} */ #vectorIndex = new VectorIndex();
  /** @type {Map<string, Float32Array>} content-hash cache key → vector (restart-safe via #vectorStore since 52.23) */ #vecCache = new Map();
  /** @type {string | null} modelId the current index was built with */ #indexModelId = null;

  // ── persistence (52.23) ── §3.4 on-store layout:
  //   private/state/search-index/<scope>/manifest
  //   private/state/search-index/<scope>/items/<itemId>
  /** @type {string} store key for the manifest */ #manifestKey;
  /** @type {string} store key prefix for item records */ #itemsPrefix;
  /** @type {Promise<void> | null} memoised hydrate promise (reload runs once) */ #loadPromise = null;

  /**
   * @param {object} args
   * @param {object} args.schema
   * @param {{ id: string, dim?: number, embed: (texts: string[]) => Promise<Float32Array[]> }} [args.embedder]
   *        optional EmbeddingProvider-shaped object (duck-typed, injected). Absent ⇒ lexical-only.
   * @param {(text: string) => Promise<string>} [args.hash]
   *        optional platform-wired SHA-256; used for the content-hash cache key. Absent ⇒ raw text is the key.
   * @param {object} [args.vectorStore]     optional StorageBackend-shaped store — enables 52.23 persistence
   * @param {string} [args.scope='default'] index scope — namespaces the on-store layout under
   *        `private/state/search-index/<scope>/`. Distinct scopes may share one `vectorStore`.
   * @param {object} [args.chunking]        optional { version, maxChars, splitAt, overlap } — defaults to chunkingV1
   * @param {(event: object) => void} [args.audit]  optional audit hook (degradation + invalidation events)
   * @param {object} [args.podClient]       optional — V1 will use this to read items from the pod
   * @param {string} [args.rootContainer]   optional — V1
   */
  constructor({ schema, embedder, hash, vectorStore, scope, chunking, audit } = {}) {
    if (!schema || typeof schema.fields !== 'object') {
      throw new TypeError('PodSearch: schema.fields required');
    }
    this.#schema = schema;
    this.#primaryField = Object.entries(schema.fields)
      .find(([, def]) => def.primary)?.[0];
    if (!this.#primaryField) throw new Error('PodSearch: schema must mark one field as primary');

    this.#ftsFields = Object.entries(schema.fields)
      .filter(([, def]) => def.fts)
      .map(([name, def]) => ({ name, weight: def.weight ?? 1 }));
    this.#facetFields = Object.entries(schema.fields)
      .filter(([, def]) => def.facet)
      .map(([name]) => name);
    this.#sortableFields = Object.entries(schema.fields)
      .filter(([, def]) => def.sortable)
      .map(([name]) => name);

    // Vector layer wiring (all optional / additive).
    this.#embedFields = Object.entries(schema.fields)
      .filter(([, def]) => def.embed)
      .map(([name]) => name);
    this.#chunking = resolveChunking(chunking);
    this.#embedder = embedder ?? null;
    this.#hash = hash ?? null;
    this.#vectorStore = vectorStore ?? null;
    this.#audit = audit ?? null;

    // §3.4 on-store layout keys (owner-only derived data).
    const base = `private/state/search-index/${scope ?? 'default'}/`;
    this.#manifestKey = `${base}manifest`;
    this.#itemsPrefix = `${base}items/`;
  }

  /** Store key for one item's persisted vector record. */
  #itemKey(id) {
    return `${this.#itemsPrefix}${encodeURIComponent(String(id))}`;
  }

  // ── indexing ────────────────────────────────────────────────────

  /**
   * Index a batch of items.  Each must have the primary field.
   *
   * When an embedder + `embed: true` fields are present, this also
   * chunks each item's embeddable text, consults the content-hash cache,
   * embeds only the misses (one batched call), and updates the vector
   * index.  Absent embedder ⇒ lexical-only, no embed call.
   *
   * @param {object[]} items
   */
  async indexBatch(items) {
    if (!Array.isArray(items)) return;
    await this.#ensureLoaded(); // warm the restart-safe cache + vector index first
    for (const it of items) {
      const id = it[this.#primaryField];
      if (id === undefined || id === null) {
        throw new Error(`PodSearch.indexBatch: item missing primary field '${this.#primaryField}'`);
      }
      this.#items.set(id, JSON.parse(JSON.stringify(it)));
    }
    if (this.#semanticEnabled()) await this.#embedItems(items);
  }

  async deleteById(id) {
    await this.#ensureLoaded();
    this.#items.delete(id);
    this.#vectorIndex.delete(id); // clear the vector side too
    // Tombstone: evict the persisted vectors so no orphan survives a restart.
    if (this.#vectorStore) {
      await this.#vectorStore.delete(this.#itemKey(id));
      if (this.#semanticEnabled()) await this.#persistManifest();
    }
  }

  /**
   * Wipe + rebuild the index — clears the in-memory vector index + cache
   * AND purges the persisted `items/*` records and manifest so a rebuild
   * starts from a clean store (no orphan vectors).
   *
   * @param {object} [scope]  V1+ — selective rebuild
   */
  async reindex(/* scope */) {
    this.#items.clear();
    this.#vectorIndex.clear();
    this.#vecCache.clear();
    this.#indexModelId = null;
    if (this.#vectorStore) {
      for (const k of await this.#vectorStore.list(this.#itemsPrefix)) {
        await this.#vectorStore.delete(k);
      }
      await this.#vectorStore.delete(this.#manifestKey);
    }
    // Store is now empty; mark hydration done so we don't re-read it.
    this.#loadPromise = Promise.resolve();
  }

  // ── query ───────────────────────────────────────────────────────

  /**
   * Run a search.
   *
   * The lexical surface (`mode` omitted / `'lexical'`) is unchanged and
   * byte-compatible with the pre-52.22 V0.  `'semantic'` and `'hybrid'`
   * are additive.
   *
   * @param {object} args
   * @param {string} [args.text]                  free-text query
   * @param {object} [args.filters]              {field: value | array | range}
   * @param {'relevance'|'date-desc'|'date-asc'|string} [args.rank='relevance']
   * @param {number} [args.limit=50]
   * @param {number} [args.offset=0]
   * @param {'lexical'|'semantic'|'hybrid'} [args.mode='lexical']
   * @param {number} [args.minScore]             optional semantic cosine floor
   * @returns {Promise<{items: object[], total: number, facets: object, code?: string}>}
   */
  async query({
    text,
    filters,
    rank = 'relevance',
    limit = DEFAULT_LIMIT,
    offset = 0,
    mode = 'lexical',
    minScore,
  } = {}) {
    await this.#ensureLoaded();
    let candidates = [...this.#items.values()];

    // Filter-then-rank: facet filters apply BEFORE ranking in every path.
    if (filters) candidates = this.#applyFilters(candidates, filters);

    let ordered;
    let code;

    if (mode === 'semantic') {
      const res = await this.#semanticRank(candidates, text, minScore);
      ordered = res.ordered;
      code = res.code;
    } else if (mode === 'hybrid') {
      ordered = await this.#hybridRank(candidates, text, rank, minScore);
    } else {
      ordered = this.#lexicalRank(candidates, text, rank);
    }

    const total  = ordered.length;
    const facets = this.#computeFacets(ordered);
    const page   = ordered.slice(offset, offset + limit).map((it) => JSON.parse(JSON.stringify(it)));

    return code ? { items: page, total, facets, code } : { items: page, total, facets };
  }

  /**
   * "More like this" — ranks other items by cosine to `id`'s STORED
   * chunk vectors.  Makes **no** embed call (the vector is already
   * indexed).  Empty result if the item has no vectors / semantic off.
   *
   * @param {string} id
   * @param {object} [opts]
   * @param {number} [opts.limit=50]
   * @returns {Promise<{items: object[], total: number, facets: object}>}
   */
  async similar(id, { limit = DEFAULT_LIMIT } = {}) {
    await this.#ensureLoaded();
    const vecs = this.#vectorIndex.getVectors(id);
    if (!vecs || vecs.length === 0) return { items: [], total: 0, facets: {} };
    const hits = this.#vectorIndex.search(vecs, { excludeId: id });
    const ordered = hits.map((h) => this.#items.get(h.id)).filter(Boolean);
    const facets = this.#computeFacets(ordered);
    const page = ordered.slice(0, limit).map((it) => JSON.parse(JSON.stringify(it)));
    return { items: page, total: ordered.length, facets };
  }

  /** @returns {boolean} embedder present AND the vector index is warm */
  get semanticReady() {
    return this.#semanticEnabled() && this.#vectorIndex.size > 0;
  }

  // ── ranking paths ───────────────────────────────────────────────

  /** Lexical relevance ranking — the original V0 behaviour, extracted verbatim. */
  #lexicalRank(candidates, text, rank) {
    let out = candidates;
    if (text && text.trim().length > 0) {
      const terms = this.#tokenise(text);
      out = out
        .map((item) => ({ item, score: this.#scoreItem(item, terms) }))
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((c) => c.item);
    }
    if (rank === 'date-desc' || rank === 'date-asc') {
      out = this.#applyDateRank(out, rank);
    }
    return out;
  }

  /** IDs of the lexical ranking (relevance order) — the input to RRF. */
  #lexicalOrderIds(candidates, text) {
    return this.#lexicalRank(candidates, text, 'relevance').map((it) => it[this.#primaryField]);
  }

  /**
   * Semantic ranking: embed the query text ONCE → cosine over the
   * (filtered) indexed vectors.  Degrades gracefully:
   *   - semantic disabled → E_SEMANTIC_UNAVAILABLE-coded empty result
   *   - no query text     → empty result (nothing to embed)
   *   - embedder throws    → fall back to lexical + audit event
   */
  async #semanticRank(candidates, text, minScore) {
    if (!this.semanticReady) {
      return { ordered: [], code: 'E_SEMANTIC_UNAVAILABLE' };
    }
    if (!text || text.trim().length === 0) return { ordered: [] };

    const filterIds = new Set(candidates.map((c) => c[this.#primaryField]));
    let qvec;
    try {
      const vecs = await this.#embedder.embed([text]);
      qvec = vecs?.[0];
    } catch (err) {
      this.#audit?.({ type: 'semantic-fallback', code: 'E_EMBED_PROVIDER', error: err });
      return { ordered: this.#lexicalRank(candidates, text, 'relevance') };
    }
    if (!qvec) return { ordered: [] };

    const hits = this.#vectorIndex.search([qvec], { minScore, filterIds });
    return { ordered: hits.map((h) => this.#items.get(h.id)).filter(Boolean) };
  }

  /**
   * Hybrid ranking: reciprocal rank fusion (k=60) over the lexical
   * ranking and the cosine ranking.  Parameter-free, no score
   * normalisation.  When semantic is unavailable, hybrid silently
   * equals lexical (graceful degradation).
   */
  async #hybridRank(candidates, text, rank, minScore) {
    if (!this.semanticReady) return this.#lexicalRank(candidates, text, rank);

    const lexIds = this.#lexicalOrderIds(candidates, text);

    let semIds = [];
    if (text && text.trim().length > 0) {
      const filterIds = new Set(candidates.map((c) => c[this.#primaryField]));
      try {
        const vecs = await this.#embedder.embed([text]);
        const qvec = vecs?.[0];
        if (qvec) {
          semIds = this.#vectorIndex
            .search([qvec], { minScore, filterIds })
            .map((h) => h.id);
        }
      } catch (err) {
        this.#audit?.({ type: 'semantic-fallback', code: 'E_EMBED_PROVIDER', error: err });
        return this.#lexicalRank(candidates, text, rank);
      }
    }

    const fusedIds = rrf([lexIds, semIds], RRF_K);
    return fusedIds.map((id) => this.#items.get(id)).filter(Boolean);
  }

  // ── vector indexing ─────────────────────────────────────────────

  /** @returns {boolean} embedder injected AND at least one embeddable field */
  #semanticEnabled() {
    return !!this.#embedder && this.#embedFields.length > 0;
  }

  /**
   * Chunk each item's embeddable text, embed cache-misses in one batch,
   * and update the vector index.  Content-hash cache guarantees an
   * unchanged chunk is never re-embedded.
   */
  async #embedItems(items) {
    const modelId = this.#embedder.id;
    if (this.#indexModelId && this.#indexModelId !== modelId && this.#vectorIndex.size > 0) {
      throw codedError(
        'E_INDEX_MODEL_MISMATCH',
        `PodSearch: index built with '${this.#indexModelId}', embedder is '${modelId}'`,
      );
    }

    // Chunk every item + compute its cache keys; collect the misses.
    const perItem = [];
    const missTexts = [];
    const missKeys = [];
    const seenMiss = new Set();
    for (const it of items) {
      const id = it[this.#primaryField];
      const text = this.#embeddableText(it);
      const contentHash = await this.#chunkHash(text);
      const chunks = chunkText(text, this.#chunking);
      const keyed = [];
      for (const chunk of chunks) {
        const h = await this.#chunkHash(chunk);
        const key = this.#cacheKey(modelId, h);
        keyed.push({ chunk, key, hash: h });
        if (!this.#vecCache.has(key) && !seenMiss.has(key)) {
          seenMiss.add(key);
          missTexts.push(chunk);
          missKeys.push(key);
        }
      }
      perItem.push({ id, keyed, contentHash });
    }

    // Embed only the misses — one batched call.
    if (missTexts.length > 0) {
      const vecs = await this.#embedder.embed(missTexts);
      if (!Array.isArray(vecs) || vecs.length !== missTexts.length) {
        throw codedError('E_EMBED_PROVIDER', 'PodSearch: embedder returned wrong vector count');
      }
      for (let i = 0; i < vecs.length; i += 1) {
        const v = vecs[i];
        if (this.#embedder.dim !== undefined && v.length !== this.#embedder.dim) {
          throw codedError(
            'E_INDEX_MODEL_MISMATCH',
            `PodSearch: embedder returned dim ${v.length}, declared ${this.#embedder.dim}`,
          );
        }
        this.#vecCache.set(missKeys[i], v);
      }
    }

    // Assign vectors to items (VectorIndex enforces a consistent dim).
    for (const { id, keyed } of perItem) {
      const vecs = keyed.map(({ key }) => this.#vecCache.get(key));
      this.#vectorIndex.replace(id, vecs);
    }
    this.#indexModelId = modelId;

    // Persist (§3.4). Absent vectorStore ⇒ pure in-memory (52.22 behaviour).
    if (this.#vectorStore) {
      for (const { id, keyed, contentHash } of perItem) {
        if (keyed.length === 0) {
          // No embeddable text → tombstone any stale persisted record.
          await this.#vectorStore.delete(this.#itemKey(id));
          continue;
        }
        const chunks = keyed.map(({ key, hash }, seq) => ({
          field: null, // chunkingV1 concatenates embed fields before splitting
          seq,
          hash,
          vecB64: f32ToB64(this.#vecCache.get(key)),
        }));
        await this.#putJson(this.#itemKey(id), { itemId: id, contentHash, chunks });
      }
      await this.#persistManifest();
    }
  }

  /** Concatenation of the item's `embed: true` fields (skips empties). */
  #embeddableText(item) {
    return this.#embedFields
      .map((f) => item[f])
      .filter((v) => v !== undefined && v !== null && String(v).trim().length > 0)
      .map((v) => String(v))
      .join('\n\n');
  }

  /**
   * Content hash of a chunk (or the item's embeddable text).  `hash` is
   * optional — absent, the raw text is the hash (still deterministic).
   * The persistence layer stores this per chunk so the restart-safe cache
   * key can be reconstructed on reload.
   */
  async #chunkHash(text) {
    return this.#hash ? await this.#hash(text) : text;
  }

  /**
   * Cache key for "may I reuse this vector?": `${modelId}:${chunkingV}:${contentHash}`.
   * Restart-safe since 52.23 — the same key is reconstructed on reload
   * from the persisted manifest + per-chunk hash.
   */
  #cacheKey(modelId, hash) {
    return `${modelId}:${this.#chunking.version}:${hash}`;
  }

  // ── persistence lifecycle (52.23) ───────────────────────────────

  /**
   * Hydrate the vector index + restart-safe cache from `vectorStore`
   * exactly once (memoised).  No embed calls: restart ≠ re-embed.
   * When the persisted manifest's model or chunking version no longer
   * matches the current embedder/chunking, the stale index is purged and
   * rebuilt lazily (never served as if it were the current model).
   */
  #ensureLoaded() {
    if (!this.#vectorStore) return Promise.resolve();
    if (!this.#loadPromise) this.#loadPromise = this.#hydrate();
    return this.#loadPromise;
  }

  async #hydrate() {
    const manifest = await this.#getJson(this.#manifestKey);
    if (!manifest) return; // nothing persisted → fresh index

    // Invalidation: model or chunking swap ⇒ persisted vectors are stale.
    const staleModel = !!this.#embedder && manifest.modelId !== this.#embedder.id;
    const staleChunk = manifest.chunkingV !== this.#chunking.version;
    if (staleModel || staleChunk) {
      this.#audit?.({
        type: 'index-invalidated',
        reason: staleModel ? 'model' : 'chunking',
        persisted: { modelId: manifest.modelId, chunkingV: manifest.chunkingV },
        current: { modelId: this.#embedder?.id ?? null, chunkingV: this.#chunking.version },
      });
      // Purge so the rebuild starts clean — no wrong-model orphan vectors.
      for (const k of await this.#vectorStore.list(this.#itemsPrefix)) {
        await this.#vectorStore.delete(k);
      }
      await this.#vectorStore.delete(this.#manifestKey);
      return;
    }

    // Compatible: rebuild the vector index + cache from the store.
    for (const k of await this.#vectorStore.list(this.#itemsPrefix)) {
      const rec = await this.#getJson(k);
      if (!rec || !Array.isArray(rec.chunks)) continue;
      const vecs = [];
      for (const ch of rec.chunks) {
        const v = b64ToF32(ch.vecB64);
        vecs.push(v);
        this.#vecCache.set(this.#cacheKey(manifest.modelId, ch.hash), v);
      }
      if (vecs.length) this.#vectorIndex.replace(rec.itemId, vecs);
    }
    this.#indexModelId = manifest.modelId;
  }

  /** Write/update the `manifest` (§3.4). */
  async #persistManifest() {
    if (!this.#vectorStore) return;
    const count = (await this.#vectorStore.list(this.#itemsPrefix)).length;
    await this.#putJson(this.#manifestKey, {
      modelId: this.#embedder?.id ?? this.#indexModelId,
      dim: this.#vectorIndex.dim,
      chunkingV: this.#chunking.version,
      count,
      builtAt: new Date().toISOString(),
    });
  }

  /** JSON put — serialise so string- and object-backed stores both work. */
  async #putJson(key, obj) {
    await this.#vectorStore.put(key, JSON.stringify(obj));
  }

  /** JSON get — tolerate stores that hand back the raw object or a string. */
  async #getJson(key) {
    const rec = await this.#vectorStore.get(key);
    if (!rec || rec.bytes == null) return null;
    return typeof rec.bytes === 'string' ? JSON.parse(rec.bytes) : rec.bytes;
  }

  // ── helpers ─────────────────────────────────────────────────────

  #applyDateRank(items, rank) {
    const dateField = this.#sortableFields.find((f) => f.toLowerCase().includes('time') || f.toLowerCase().includes('date'))
      ?? this.#sortableFields[0];
    if (!dateField) return items;
    return [...items].sort((a, b) =>
      rank === 'date-desc'
        ? (b[dateField] ?? 0) - (a[dateField] ?? 0)
        : (a[dateField] ?? 0) - (b[dateField] ?? 0),
    );
  }

  #applyFilters(items, filters) {
    return items.filter((item) => {
      for (const [field, spec] of Object.entries(filters)) {
        if (spec === undefined) continue;
        const value = item[field];
        if (Array.isArray(spec)) {
          // Multi-value match: include if item value (or any element of multi-value field) intersects.
          const wanted = new Set(spec);
          if (Array.isArray(value)) {
            if (!value.some((v) => wanted.has(v))) return false;
          } else {
            if (!wanted.has(value)) return false;
          }
        } else if (spec && typeof spec === 'object' && ('from' in spec || 'to' in spec)) {
          if (spec.from !== undefined && (value ?? -Infinity) < spec.from) return false;
          if (spec.to   !== undefined && (value ??  Infinity) > spec.to)   return false;
        } else {
          if (Array.isArray(value)) {
            if (!value.includes(spec)) return false;
          } else {
            if (value !== spec) return false;
          }
        }
      }
      return true;
    });
  }

  #tokenise(text) {
    return text
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.replace(/[^\p{L}\p{N}]+/gu, ''))
      .filter(Boolean);
  }

  #scoreItem(item, terms) {
    const matchedTerms = new Set();
    let score = 0;
    for (const { name, weight } of this.#ftsFields) {
      const haystack = (item[name] ?? '').toString().toLowerCase();
      if (!haystack) continue;
      let fieldAllMatched = true;
      for (const term of terms) {
        if (haystack.includes(term)) {
          matchedTerms.add(term);
          score += weight;
        } else {
          fieldAllMatched = false;
        }
      }
      // Bonus for matching all terms in one field (boosts "whole
      // phrase in title" over "spread across fields").
      if (fieldAllMatched) score += weight * 0.5;
    }
    // AND semantics: every query term must match in some fts field.
    if (matchedTerms.size < terms.length) return 0;
    return score;
  }

  #computeFacets(items) {
    const facets = {};
    for (const field of this.#facetFields) {
      const counts = {};
      for (const item of items) {
        const value = item[field];
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const v of value) counts[v] = (counts[v] ?? 0) + 1;
        } else {
          counts[value] = (counts[value] ?? 0) + 1;
        }
      }
      facets[field] = counts;
    }
    return facets;
  }

  /** @returns {number} number of indexed items */
  get size() { return this.#items.size; }

  /**
   * @returns {object|null} the injected StorageBackend-shaped vector store.
   * Exposed (read-only) so the 52.24 backfill orchestrator can persist its
   * resumable cursor in the same store as the index, without a separate wire.
   */
  get vectorStore() { return this.#vectorStore; }
}

/**
 * Reciprocal rank fusion.  score(id) = Σ 1/(k + rank) over the rankings
 * the id appears in (rank is 1-based).  Parameter-free fusion of the
 * lexical and cosine orderings — no score normalisation.
 *
 * @param {string[][]} rankings  each an ordered id list (best first)
 * @param {number} k
 * @returns {string[]}  fused id order (best first)
 */
// ── vector ↔ base64 codec (§3.4 `vecB64`) ──────────────────────────
// Portable across web / RN / Node: prefer the platform btoa/atob, fall
// back to Buffer. Vectors are stored little-endian Float32 as base64.

/** @param {string} bin binary string @returns {string} base64 */
function b64encode(bin) {
  if (typeof btoa === 'function') return btoa(bin);
  return Buffer.from(bin, 'binary').toString('base64');
}

/** @param {string} b64 @returns {string} binary string */
function b64decode(b64) {
  if (typeof atob === 'function') return atob(b64);
  return Buffer.from(b64, 'base64').toString('binary');
}

/** @param {Float32Array} vec @returns {string} base64 of the raw bytes */
function f32ToB64(vec) {
  const f = vec instanceof Float32Array ? vec : Float32Array.from(vec);
  const bytes = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return b64encode(bin);
}

/** @param {string} b64 @returns {Float32Array} */
function b64ToF32(b64) {
  const bin = b64decode(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

function rrf(rankings, k = RRF_K) {
  const scores = new Map();
  for (const ids of rankings) {
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
    }
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
