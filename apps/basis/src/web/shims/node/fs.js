/**
 * Browser-safe shim for `node:fs` (and `node:fs/promises` — same module,
 * dual-aliased in vite.config.js).
 *
 * Aliased via vite.config.js → resolve.alias.  Static imports of the form
 * `import { promises as fs } from 'node:fs'` (sync-engine fsNode adapter,
 * folio CLI/server) AND `import { readFile, writeFile, ... } from
 * 'node:fs/promises'` (pinboard FilePersist, tasks-v0 FilePersist, pseudo-pod
 * NodeFsBackend) BOTH resolve here.  Two import shapes, one module.
 *
 * Browser code never executes these — the callers either:
 *   - inject `opts.fs` (folio autoShare, sync-engine SyncEngine)
 *   - swap the backend at composition time (browser apps use
 *     IndexedDBPersist / MemoryBackend instead of FilePersist /
 *     NodeFsBackend)
 *
 * Methods throw at runtime so accidentally executing them surfaces the
 * wiring bug instead of silently returning undefined. See.
 */

const browserOnlyAsync = (name) => async () => {
  throw new Error(`[node:fs/promises.${name}] called in the browser bundle — should be unreachable. ` +
                  `Inject a browser-safe FsAdapter via opts.fs.`);
};
const browserOnlySync = (name) => () => {
  throw new Error(`[node:fs.${name}] called in the browser bundle — should be unreachable. ` +
                  `Inject a browser-safe FsAdapter via opts.fs.`);
};

// Promise-based API — used by both `import { promises as fs } from 'node:fs'`
// AND the bare `import { readFile, ... } from 'node:fs/promises'` form.
export const readFile  = browserOnlyAsync('readFile');
export const writeFile = browserOnlyAsync('writeFile');
export const unlink    = browserOnlyAsync('unlink');
export const mkdir     = browserOnlyAsync('mkdir');
export const stat      = browserOnlyAsync('stat');
export const lstat     = browserOnlyAsync('lstat');
export const readdir   = browserOnlyAsync('readdir');
export const access    = browserOnlyAsync('access');
export const rm        = browserOnlyAsync('rm');
export const rmdir     = browserOnlyAsync('rmdir');
export const rename    = browserOnlyAsync('rename');
export const copyFile  = browserOnlyAsync('copyFile');
export const open      = browserOnlyAsync('open');
export const chmod     = browserOnlyAsync('chmod');
export const realpath  = browserOnlyAsync('realpath');
export const symlink   = browserOnlyAsync('symlink');
export const readlink  = browserOnlyAsync('readlink');
export const watch     = browserOnlySync('watch');

// `import { promises as fs } from 'node:fs'` — `promises` is a namespace
// object carrying every async method.
export const promises = {
  readFile, writeFile, unlink, mkdir, stat, lstat, readdir, access,
  rm, rmdir, rename, copyFile, open, chmod, realpath, symlink, readlink, watch,
};

// Sync API — some Node-only callers use these (relay/bin, folio CLI,
// archive); same throw-on-call behaviour.
export const readFileSync  = browserOnlySync('readFileSync');
export const writeFileSync = browserOnlySync('writeFileSync');
export const existsSync    = () => false;
export const mkdirSync     = browserOnlySync('mkdirSync');
export const unlinkSync    = browserOnlySync('unlinkSync');
export const statSync      = browserOnlySync('statSync');
export const lstatSync     = browserOnlySync('lstatSync');
export const readdirSync   = browserOnlySync('readdirSync');
export const rmSync        = browserOnlySync('rmSync');
export const rmdirSync     = browserOnlySync('rmdirSync');
export const renameSync    = browserOnlySync('renameSync');
export const copyFileSync  = browserOnlySync('copyFileSync');

// Stream-based — rarely used in our codebase, but include for the
// fs.createReadStream / fs.createWriteStream forms folio's static-share
// path historically called.
export const createReadStream  = browserOnlySync('createReadStream');
export const createWriteStream = browserOnlySync('createWriteStream');

// `constants` — file mode flags; some sync-engine call sites reference
// `fs.constants.F_OK` etc.  Provide a no-op stub so the property lookup
// doesn't crash; the actual fs methods will throw anyway.
export const constants = Object.freeze({
  F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1,
  O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_CREAT: 64, O_EXCL: 128,
  O_TRUNC: 512, O_APPEND: 1024,
});

export default {
  promises,
  readFile, writeFile, unlink, mkdir, stat, lstat, readdir, access,
  rm, rmdir, rename, copyFile, open, chmod, realpath, symlink, readlink, watch,
  readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync,
  statSync, lstatSync, readdirSync, rmSync, rmdirSync, renameSync, copyFileSync,
  createReadStream, createWriteStream,
  constants,
};
