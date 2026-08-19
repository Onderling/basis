/**
 * Adapter shim layer — Folio's "one engine, three drivers" design.
 *
 * SyncEngine + the diff/conflict/versioning/auto-share helpers all delegate
 * the platform-specific bits (filesystem, watcher, hash) to objects that
 * implement these adapter interfaces.  Defaults point at the Node-backed
 * adapters so the CLI + web driver work with no code changes; the RN
 * driver supplies its own adapters that wrap `expo-file-system`,
 * `expo-crypto`, etc.
 *
 * Why this file is JSDoc-only
 * ---------------------------
 * Folio is vanilla JS (per the monorepo's CLAUDE.md).  We can't enforce
 * the adapter contract via TypeScript interfaces, so we document it
 * exhaustively here and let the test suite verify the shape on real
 * implementations.  Importing this module is cheap (just type metadata
 * and re-exports of the Node default adapters).
 *
 * Adapter contract — high level
 * -----------------------------
 *   FsAdapter      — promise-based file IO, modeled on `node:fs/promises`
 *                    but only the subset Folio actually uses.  All paths
 *                    are absolute strings; on RN they're `expo-file-system`
 *                    URIs (which start with `file://...`), but the engine
 *                    treats them opaquely — it just hands what `fs.join`
 *                    produced to `fs.readFile`.
 *   WatcherAdapter — `start({ root, onEvent, onError })` → `{ stop }`.
 *                    Emits `{ event: 'add'|'change'|'unlink', absPath }`
 *                    for individual file changes.  Node uses chokidar; RN
 *                    polls every N seconds.
 *   HashAdapter    — `sha256(bytesOrString) → Promise<hexString>`.  Async
 *                    so `expo-crypto.digestStringAsync` fits cleanly; the
 *                    Node default is async too (returns a resolved promise
 *                    of the synchronously computed digest).
 *
 * Implementations live in:
 *   - `./fsNode.js`      — Node default
 *   - `./fsRN.js`        — `expo-file-system` wrapper (mocked in tests)
 *   - `./watcherNode.js` — chokidar default
 *   - `./watcherRN.js`   — interval-poll watcher
 *   - `./hashNode.js`    — `node:crypto` default
 *   - `./hashRN.js`      — `expo-crypto` wrapper
 *
 * @typedef {object} FsAdapter
 * @property {(absPath: string) => Promise<Uint8Array | Buffer>} readFile
 *   Read the whole file as bytes.  Returns `Buffer` on Node, `Uint8Array`
 *   on RN.  Callers that need a string convert via `TextDecoder` or
 *   `Buffer.toString`.  Throws an error with `.code === 'ENOENT'` on
 *   missing file (RN adapter normalizes this from `expo-file-system`).
 *
 * @property {(absPath: string, encoding?: 'utf8') => Promise<string>} readFileText
 *   Read the file as a UTF-8 string.  Same ENOENT contract as `readFile`.
 *
 * @property {(absPath: string, content: string|Uint8Array|Buffer, opts?: { encoding?: 'utf8' }) => Promise<void>} writeFile
 *   Write `content` to `absPath`, creating parent directories implicitly
 *   on RN.  On Node the caller is expected to `mkdir(dirname)` first
 *   (matches existing SyncEngine behaviour).
 *
 * @property {(absPath: string) => Promise<void>} unlink
 *   Delete a file.  ENOENT MUST throw an error with `.code === 'ENOENT'`
 *   so callers can swallow it idiomatically.
 *
 * @property {(absPath: string) => Promise<void>} rmdir
 *   Remove an empty directory.  ENOENT throws `.code === 'ENOENT'`.
 *   ENOTEMPTY behaviour is platform-defined; callers shouldn't rely on it.
 *
 * @property {(absPath: string, opts?: { recursive?: boolean }) => Promise<void>} mkdir
 *   Create a directory.  `{ recursive: true }` is the default mode used
 *   by SyncEngine; callers pass `{ recursive: false }` explicitly when
 *   they want to fail fast on existing directories.
 *
 * @property {(absPath: string, opts?: { withFileTypes?: boolean }) => Promise<Array<string | DirEnt>>} readdir
 *   List directory entries.  When `withFileTypes` is `true`, returns an
 *   array of objects with `{ name, isFile(), isDirectory() }` — matches
 *   `node:fs/promises.readdir`'s shape.  ENOENT MUST throw an error with
 *   `.code === 'ENOENT'`.
 *
 * @property {(absPath: string) => Promise<{ size: number, mtimeMs: number, isFile(): boolean, isDirectory(): boolean }>} stat
 *   File metadata.  ENOENT throws `.code === 'ENOENT'`.
 *
 * @property {(srcPath: string, destPath: string) => Promise<void>} rename
 *   Rename / move a file.  Used for atomic write (tmp-then-rename) by
 *   SyncEngine + autoShare + versions.  On RN, `expo-file-system.moveAsync`
 *   handles this.
 *
 * @typedef {object} DirEnt
 * @property {string} name
 * @property {() => boolean} isFile
 * @property {() => boolean} isDirectory
 *
 * @typedef {object} WatcherAdapter
 * @property {(opts: { root: string, ignored?: (path: string) => boolean, onEvent: (ev: { event: 'add'|'change'|'unlink', absPath: string }) => void, onError?: (err: Error) => void }) => Promise<{ stop: () => Promise<void> }>} start
 *   Begin watching `root`.  Each FS event invokes `onEvent`.  `ignored`
 *   is an optional predicate that, when it returns `true`, suppresses
 *   the event.  `stop()` halts the watcher and releases resources.
 *
 * @typedef {object} HashAdapter
 * @property {(input: string | Uint8Array | Buffer) => Promise<string>} sha256
 *   Hex-encoded sha256 digest of the input.  Always async; the Node
 *   adapter wraps a synchronous `createHash().digest('hex')` for shape
 *   parity with the RN adapter (which has to call `digestStringAsync`).
 */

// Re-export the Node defaults so callers that just want a plug-and-play
// "give me Node" don't have to import 3 modules.
export { fsNode }      from './fsNode.js';
export { watcherNode } from './watcherNode.js';
export { hashNode }    from './hashNode.js';
export {
  joinPosix,
  dirnamePosix,
  basenamePosix,
  extnamePosix,
} from './pathPosix.js';

// RN adapter factories.  These are NOT imported eagerly because they
// depend on Expo libs (`expo-file-system`, `expo-crypto`) that are
// peerDependencies — pulling them into the module graph would break the
// CLI/web build.  Callers on RN explicitly import them via
// `apps/folio/src/rn/serviceFactory.js`.
//   import { createFsRN }      from './fsRN.js';
//   import { createWatcherRN } from './watcherRN.js';
//   import { createHashRN }    from './hashRN.js';
