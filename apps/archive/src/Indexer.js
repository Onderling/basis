/**
 * Indexer.js — walks a pod root via PodClient.list (BFS over containers),
 * downloads each resource, and inserts/updates rows in the Archive DB.
 *
 * Behaviour:
 *   - For each resource encountered:
 *       1. Read the resource (decode='bytes').
 *       2. Compute sha256.
 *       3. If a row already exists for (sourceId, podUri) AND its sha256
 *          matches AND --force was not set ⇒ skip (counts as `unchanged`).
 *       4. Otherwise upsert the row.  If the content-type is FTS-eligible
 *          (text/* or application/json or application/xml), decode the
 *          content as UTF-8 and write an FTS row (truncated at MAX_FTS_BYTES).
 *          For binary types, the row is recorded but no FTS row is written.
 *
 * The walker mirrors `apps/folio/src/scanPod.js` — single-shot BFS over
 * containers, calling PodClient.list with `recursive: false`.  This keeps
 * us compatible with both the real PodClient and the FsBackedMockPodClient
 * (the mock doesn't honour `recursive: true` for nested containers in the
 * way list-as-container-tree implementations do).
 */
import { createHash } from 'node:crypto';

const MAX_FTS_BYTES = 5 * 1024 * 1024;          // 5 MB — cap individual FTS row

/**
 * Content-types that get FTS-indexed.
 *
 * Match rules (case-insensitive on the prefix):
 *   - any  text/*
 *   - application/json
 *   - application/xml
 *   - application/*+json
 *   - application/*+xml
 *
 * Anything else is treated as binary: row recorded, content-not-indexed.
 */
export function isTextContentType(contentType) {
  if (!contentType) return false;
  // Strip parameters: "text/plain; charset=utf-8" → "text/plain".
  const base = String(contentType).split(';')[0].trim().toLowerCase();
  if (base.startsWith('text/'))                    return true;
  if (base === 'application/json')                 return true;
  if (base === 'application/xml')                  return true;
  if (base === 'application/javascript')           return true;
  if (/^application\/[\w.-]+\+json$/.test(base))   return true;
  if (/^application\/[\w.-]+\+xml$/.test(base))    return true;
  return false;
}

/**
 * Index every resource under a single source's pod root.
 *
 * @param {object} args
 * @param {import('./Db.js').Db} args.db
 * @param {{ id:number, name:string, podRoot:string }} args.source
 * @param {object} args.podClient
 * @param {boolean} [args.force=false]
 * @param {(evt: object) => void} [args.onProgress]
 * @returns {Promise<{ scanned:number, inserted:number, updated:number, unchanged:number, errors:number, ftsIndexed:number, ftsSkippedBinary:number, ftsTruncated:number }>}
 */
export async function indexSource({ db, source, podClient, force = false, onProgress }) {
  if (!db)        throw new Error('indexSource: db is required');
  if (!source)    throw new Error('indexSource: source is required');
  if (!podClient) throw new Error('indexSource: podClient is required');

  const stats = {
    scanned:          0,
    inserted:         0,
    updated:          0,
    unchanged:        0,
    errors:           0,
    ftsIndexed:       0,
    ftsSkippedBinary: 0,
    ftsTruncated:     0,
  };

  const root  = source.podRoot.endsWith('/') ? source.podRoot : `${source.podRoot}/`;
  const queue = [root];

  while (queue.length > 0) {
    const containerUri = queue.shift();
    let listing;
    try {
      listing = await podClient.list(containerUri, { recursive: false });
    } catch (err) {
      // Empty/missing root container — bail with zero work.
      if (err?.code === 'NOT_FOUND' && containerUri === root) break;
      stats.errors++;
      if (onProgress) onProgress({ kind: 'list-error', containerUri, err });
      continue;
    }
    const entries = listing?.entries ?? [];
    for (const ent of entries) {
      if (ent.type === 'container') {
        queue.push(ent.uri);
        continue;
      }
      stats.scanned++;
      try {
        const result = await indexOne({ db, source, podClient, entry: ent, force });
        if (result.inserted)        stats.inserted++;
        else if (result.updated)    stats.updated++;
        else                        stats.unchanged++;
        if (result.fts === 'indexed')   stats.ftsIndexed++;
        if (result.fts === 'binary')    stats.ftsSkippedBinary++;
        if (result.fts === 'truncated') { stats.ftsIndexed++; stats.ftsTruncated++; }
        if (onProgress) onProgress({ kind: 'resource', uri: ent.uri, ...result });
      } catch (err) {
        stats.errors++;
        if (onProgress) onProgress({ kind: 'resource-error', uri: ent.uri, err });
      }
    }
  }

  db.setSourceLastIndexed(source.id, Date.now());
  return stats;
}

/**
 * Read one resource and reconcile it with the DB.
 *
 * Internal — exported only for tests that want to drive a single file.
 *
 * @returns {Promise<{ inserted:boolean, updated:boolean, unchanged:boolean, fts:'indexed'|'binary'|'truncated'|'skip' }>}
 */
export async function indexOne({ db, source, podClient, entry, force = false }) {
  const podUri = entry.uri;
  const relPath = relPathFor(source.podRoot, podUri);

  // Read bytes (uniform for text + binary; we'll decode for FTS only when text).
  const r = await podClient.read(podUri, { decode: 'bytes' });
  const bytes = toBytes(r.content);
  const sha = createHash('sha256').update(bytes).digest('hex');

  const existing = db.getResource(source.id, podUri);
  if (existing && existing.sha256 === sha && !force) {
    return { inserted: false, updated: false, unchanged: true, fts: 'skip' };
  }

  const lastModifiedMs = parseLastModified(r.lastModified);
  const contentType = r.contentType ?? null;
  const size = typeof r.size === 'number' ? r.size : bytes.byteLength;

  let ftsContent = null;
  let ftsState   = 'binary';
  if (isTextContentType(contentType)) {
    if (bytes.byteLength > MAX_FTS_BYTES) {
      // Truncate to MAX_FTS_BYTES.  Decode the truncated slice; UTF-8
      // continuation bytes at the boundary are tolerated by TextDecoder
      // with `fatal: false` (the default) — they become U+FFFD.
      ftsContent = new TextDecoder('utf-8').decode(bytes.subarray(0, MAX_FTS_BYTES));
      ftsState   = 'truncated';
    } else {
      ftsContent = new TextDecoder('utf-8').decode(bytes);
      ftsState   = 'indexed';
    }
  }

  const { inserted } = db.upsertResource({
    sourceId:     source.id,
    podUri,
    relPath,
    contentType,
    size,
    sha256:       sha,
    lastModified: lastModifiedMs,
    ftsContent,
  });

  return {
    inserted,
    updated:   !inserted,
    unchanged: false,
    fts:       ftsState,
  };
}

// ── helpers ───────────────────────────────────────────────────────────────

function toBytes(content) {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (typeof content === 'string') return new TextEncoder().encode(content);
  return new TextEncoder().encode(JSON.stringify(content ?? ''));
}

function parseLastModified(lm) {
  if (lm == null) return null;
  if (typeof lm === 'number') return lm;
  const t = Date.parse(lm);
  return Number.isFinite(t) ? t : null;
}

/**
 * Compute the relative path of a pod URI under a pod root.
 * Falls back to the full URI if `podUri` doesn't start with `podRoot`.
 */
function relPathFor(podRoot, podUri) {
  const root = podRoot.endsWith('/') ? podRoot : `${podRoot}/`;
  if (podUri.startsWith(root)) return podUri.slice(root.length);
  return podUri;
}
