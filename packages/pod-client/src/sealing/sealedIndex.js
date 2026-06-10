// sealedIndex.js — a small, queryable index over a container's resources, meant to be STORED SEALED
// (serialize → seal via SealedPodClient → one blob on the pod). The client fetches + decrypts that one
// blob (cheap), queries it in memory, then fetches + decrypts ONLY the matching content. Triple duty:
//   1. query        — filter by type / tag / free text (lexical), recent-first
//   2. pseudonym    — decode an opaque resource id (the host sees `01HXY…`) → its meaning
//   3. RAG          — optional per-entry embedding + cosine `semanticQuery` (caller supplies vectors)
// Shardable: `shardKeyFor` buckets ids by a stable hash so you decrypt only the shard you need.
//
// PORTABLE (no node:crypto / no deps): the index query runs CLIENT-SIDE (P2 local search) on web/mobile;
// the sealing (envelope.js, node) is applied only when the blob is written/read. The index itself is the
// bigger leak surface if a client is compromised — keep entries minimal (ids/type/ts/tags/short summary).

/** @typedef {{ id:string, type?:string, ts?:number, tags?:string[], text?:string, meaning?:string, vector?:number[] }} IndexEntry */

const FIELDS = ['type', 'ts', 'tags', 'text', 'meaning', 'vector'];

/** A fresh empty index. */
export function createSealedIndex() { return { v: 1, entries: {} }; }

/** Add or replace an entry (keyed by `id`). Returns a new index (immutable). */
export function upsertEntry(index, entry) {
  if (!entry || entry.id == null || entry.id === '') throw new Error('upsertEntry: entry.id required');
  const id = String(entry.id);
  const kept = { id };
  for (const f of FIELDS) if (entry[f] !== undefined) kept[f] = entry[f];
  return { ...index, entries: { ...index.entries, [id]: kept } };
}

/** Remove an entry. Returns a new index. */
export function removeEntry(index, id) {
  if (!(id in index.entries)) return index;
  const next = { ...index.entries };
  delete next[id];
  return { ...index, entries: next };
}

export function getEntry(index, id) { return index.entries[id] ?? null; }

/** Decode an opaque resource id → its human meaning (or null if unknown / not decoded). */
export function decodePseudonym(index, id) { return index.entries[id]?.meaning ?? null; }

function haystack(e) {
  return [e.text, e.meaning, ...(Array.isArray(e.tags) ? e.tags : [])]
    .filter((s) => typeof s === 'string').join(' ').toLowerCase();
}

/**
 * Lexical query — filter by type / tag / free text, newest first.
 * @returns {IndexEntry[]}
 */
export function queryIndex(index, { type, tag, text, limit } = {}) {
  let rows = Object.values(index.entries);
  if (type) rows = rows.filter((e) => e.type === type);
  if (tag) rows = rows.filter((e) => Array.isArray(e.tags) && e.tags.includes(tag));
  if (text) { const needle = String(text).toLowerCase(); rows = rows.filter((e) => haystack(e).includes(needle)); }
  rows = rows.slice().sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  return typeof limit === 'number' ? rows.slice(0, Math.max(0, limit)) : rows;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Semantic query — cosine similarity against per-entry embeddings (the RAG form). The caller supplies
 * the query embedding; only entries with a same-length `vector` are scored.
 * @returns {{ entry: IndexEntry, score: number }[]}
 */
export function semanticQuery(index, queryVector, { limit = 5, minScore = 0 } = {}) {
  if (!Array.isArray(queryVector) || queryVector.length === 0) return [];
  return Object.values(index.entries)
    .filter((e) => Array.isArray(e.vector) && e.vector.length === queryVector.length)
    .map((entry) => ({ entry, score: cosine(queryVector, entry.vector) }))
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit));
}

/** Serialize for sealing (then seal the result with a SealedPodClient strategy). */
export function serializeIndex(index) { return JSON.stringify({ v: index.v ?? 1, entries: index.entries ?? {} }); }

/** Parse an opened index blob back to an index (tolerant of an empty/garbled body). */
export function parseIndex(text) {
  if (!text || typeof text !== 'string') return createSealedIndex();
  let o;
  try { o = JSON.parse(text); } catch { return createSealedIndex(); }
  return { v: o.v ?? 1, entries: o && typeof o.entries === 'object' && o.entries ? o.entries : {} };
}

/** Stable shard bucket for an id (FNV-1a, portable). Same id → same shard, so you decrypt only one shard. */
export function shardKeyFor(id, numShards) {
  const n = Number.isInteger(numShards) && numShards > 0 ? numShards : 1;
  let h = 0x811c9dc5;
  const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return ((h >>> 0) % n);
}
