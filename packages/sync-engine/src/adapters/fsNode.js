/**
 * fsNode — the default `FsAdapter` for SyncEngine + helpers.
 *
 * Wraps `node:fs/promises` 1:1 so behaviour across Folio's existing tests
 * is byte-for-byte identical.  The purpose of the wrapper is purely to
 * satisfy the adapter contract (so the engine code can swap in the RN
 * adapter at runtime) — there is no transformation here.
 *
 * Exported as a singleton (`fsNode`) so `new SyncEngine()` with no `fs`
 * passed gets the Node implementation for free.  Use `createFsNode()` if
 * you need a fresh instance for tests (the singleton is fine for prod).
 *
 * See `./index.js` for the FsAdapter contract.
 */

import { promises as fs } from 'node:fs';

/**
 * Build a fresh Node `FsAdapter`.  In practice the same singleton can be
 * reused everywhere; this factory exists for symmetry with `createFsRN`.
 *
 * @returns {import('./index.js').FsAdapter}
 */
export function createFsNode() {
  return {
    async readFile(absPath) {
      return fs.readFile(absPath);
    },
    async readFileText(absPath, encoding = 'utf8') {
      return fs.readFile(absPath, encoding);
    },
    async writeFile(absPath, content, opts = {}) {
      if (typeof content === 'string') {
        return fs.writeFile(absPath, content, opts.encoding ?? 'utf8');
      }
      return fs.writeFile(absPath, content);
    },
    async unlink(absPath) {
      return fs.unlink(absPath);
    },
    async rmdir(absPath) {
      return fs.rmdir(absPath);
    },
    async mkdir(absPath, opts = {}) {
      return fs.mkdir(absPath, { recursive: opts.recursive ?? true });
    },
    async readdir(absPath, opts = {}) {
      return fs.readdir(absPath, { withFileTypes: !!opts.withFileTypes });
    },
    async stat(absPath) {
      const st = await fs.stat(absPath);
      return {
        size: st.size,
        mtimeMs: st.mtimeMs,
        isFile: () => st.isFile(),
        isDirectory: () => st.isDirectory(),
      };
    },
    async rename(srcPath, destPath) {
      return fs.rename(srcPath, destPath);
    },
  };
}

/** Default singleton.  Importable for direct use without invoking the factory. */
export const fsNode = createFsNode();
