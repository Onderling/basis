/**
 * scanPod — walk a pod container via PodClient.list (recursive) +
 * PodClient.read.  Returns the same shape as scanLocal, plus `podUri`
 * and an optional `etag` for conflict detection.
 *
 * Cost note:  scanPod has to read each file to compute sha256.  On large
 * pods this is expensive.  The state file already caches sha256 per
 * (relPath, etag) — a future optimization is to skip the read when the
 * etag hasn't changed since the last sync.  v1 re-fetches everything for
 * simplicity; this is the documented hot spot for Phase B perf work.
 *
 * Adapter-aware: takes an optional `hash` adapter (default
 * Node).  No fs adapter needed — pod-side reads go through `podClient`,
 * which is already pluggable.
 */

import { PathMap }   from './PathMap.js';
import { hashNode }  from './adapters/hashNode.js';

/**
 * @param {object} podClient
 * @param {string} containerUri
 * @param {{ pathMap?: PathMap, hash?: import('./adapters/index.js').HashAdapter }} [opts]
 * @returns {Promise<Array<{ relPath: string, podUri: string, mtimeMs: number, sha256: string, size: number, etag?: string }>>}
 */
export async function scanPod(podClient, containerUri, opts = {}) {
  if (!podClient)    throw new Error('scanPod: podClient is required');
  if (!containerUri) throw new Error('scanPod: containerUri is required');
  const pathMap = opts.pathMap ?? new PathMap({ localRoot: '/__scan_pod__', podRoot: containerUri });
  const hash    = opts.hash ?? hashNode;

  const root = containerUri.endsWith('/') ? containerUri : `${containerUri}/`;
  const out = [];
  // Single-shot walk: BFS over containers; collect resources.
  const queue = [root];
  while (queue.length > 0) {
    const c = queue.shift();
    let res;
    try {
      res = await podClient.list(c, { recursive: false });
    } catch (err) {
      // 404 on the root container = empty pod; treat as no entries.
      if (err?.code === 'NOT_FOUND' && c === root) return [];
      throw err;
    }
    const entries = res?.entries ?? [];
    for (const ent of entries) {
      if (ent.type === 'container') {
        // Skip metadata containers / dotnames at the relative-path level.
        const relPath = pathMap.podToRel(ent.uri);
        // Trim trailing slash so shouldSkipDir sees a clean rel path.
        const rel = relPath.replace(/\/+$/, '');
        if (pathMap.shouldSkipDir(rel)) continue;
        queue.push(ent.uri);
        continue;
      }
      // Resource.
      const relPath = pathMap.podToRel(ent.uri);
      if (!pathMap.shouldSync(relPath)) continue;
      // Read to compute sha256; v1 always re-fetches.
      let r;
      try {
        r = await podClient.read(ent.uri, { decode: 'bytes' });
      } catch (err) {
        if (err?.code === 'NOT_FOUND') continue; // race: removed mid-scan
        throw err;
      }
      const bytes = toBytes(r.content);
      const sha = await hash.sha256(bytes);
      out.push({
        relPath,
        podUri:  ent.uri,
        mtimeMs: parseLastModified(r.lastModified),
        sha256:  sha,
        size:    typeof r.size === 'number' ? r.size : bytes.byteLength,
        etag:    r.etag,
      });
    }
  }
  return out;
}

function toBytes(content) {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (typeof content === 'string') {
    return new TextEncoder().encode(content);
  }
  // Fallback: stringify (shouldn't happen for well-typed PodClient.read).
  return new TextEncoder().encode(JSON.stringify(content ?? ''));
}

function parseLastModified(lm) {
  if (lm == null) return 0;
  if (typeof lm === 'number') return lm;
  const t = Date.parse(lm);
  return Number.isFinite(t) ? t : 0;
}
