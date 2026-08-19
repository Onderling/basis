/**
 * scanLocal — walk a local directory recursively, returning one entry per
 * file (containers / dirs are not returned).
 *
 * Each entry:
 *   { relPath, absPath, mtimeMs, sha256, size }
 *
 * `relPath` is POSIX-style (forward slashes) so it can be compared against
 * pod URIs without platform normalization.  Hidden files / directories
 * and `.onderling/` are skipped via `pathMap.shouldSync` /
 * `pathMap.shouldSkipDir`.
 *
 * sha256 is computed over the raw bytes.  Streaming for very large files
 * is the obvious follow-up; v1 reads the whole file (memory-bounded by
 * the 100 MB convention threshold + pathMap.shouldSync filter — a Phase B
 * concern).
 *
 * Adapter-aware
 * ------------------------
 * The Node-only `node:fs/promises` + `node:crypto` calls are gone; the
 * helper now takes an `fs` adapter (default Node) and `hash` adapter
 * (default Node) so it can run on RN.  All `relPath` building uses
 * POSIX strings — no `node:path` import.
 */

import { sep as pathSep } from 'node:path';

import { PathMap }          from './PathMap.js';
import { fsNode }           from './adapters/fsNode.js';
import { hashNode }         from './adapters/hashNode.js';
import { joinPosix }        from './adapters/pathPosix.js';

/**
 * @param {string} rootPath
 * @param {{ pathMap?: PathMap, fs?: import('./adapters/index.js').FsAdapter, hash?: import('./adapters/index.js').HashAdapter }} [opts]
 * @returns {Promise<Array<{ relPath: string, absPath: string, mtimeMs: number, sha256: string, size: number }>>}
 */
export async function scanLocal(rootPath, opts = {}) {
  if (!rootPath) throw new Error('scanLocal: rootPath is required');
  const pathMap = opts.pathMap ?? new PathMap({ localRoot: rootPath, podRoot: 'urn:scan:' });
  const fs   = opts.fs   ?? fsNode;
  const hash = opts.hash ?? hashNode;

  // Bail-out: root doesn't exist → empty list.
  try {
    const st = await fs.stat(rootPath);
    if (!st.isDirectory()) {
      throw new Error(`scanLocal: not a directory: ${rootPath}`);
    }
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const out = [];
  await walk(rootPath, '', out, pathMap, fs, hash);
  return out;
}

async function walk(absDir, relDir, out, pathMap, fs, hash) {
  let dirents;
  try {
    dirents = await fs.readdir(absDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EACCES') return;
    throw err;
  }
  for (const ent of dirents) {
    const childRel = relDir === '' ? ent.name : `${relDir}/${ent.name}`;
    // Use POSIX joining for adapter-portable behaviour.  The Node fs
    // adapter accepts `/` paths fine on POSIX (and handles Windows-style
    // separators internally for the path-join call sites that still need
    // them, e.g. test setup).
    const childAbs = joinPosix(absDir, ent.name);
    if (ent.isDirectory()) {
      if (pathMap.shouldSkipDir(childRel)) continue;
      await walk(childAbs, childRel, out, pathMap, fs, hash);
      continue;
    }
    if (!ent.isFile()) continue;          // skip symlinks, sockets, etc. for v1
    if (!pathMap.shouldSync(childRel)) continue;
    const meta = await fileMeta(childAbs, fs, hash);
    if (meta == null) continue;           // race: file went away
    out.push({
      relPath: childRel,                  // POSIX-style
      absPath: childAbs,
      mtimeMs: meta.mtimeMs,
      sha256:  meta.sha256,
      size:    meta.size,
    });
  }
}

async function fileMeta(absPath, fs, hash) {
  let st;
  try { st = await fs.stat(absPath); }
  catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  // sha256 over file bytes.  v1 reads the whole file; large-file streaming
  // is a Phase B concern (the 100 MB convention is a soft cap).
  let buf;
  try { buf = await fs.readFile(absPath); }
  catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  const sha256 = await hash.sha256(buf);
  return { mtimeMs: Math.floor(st.mtimeMs), sha256, size: st.size };
}

// Re-export pathSep for tests that need to construct platform-correct paths.
export const _pathSep = pathSep;
