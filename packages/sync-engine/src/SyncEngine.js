/**
 * SyncEngine — the heart of Folio's library.
 *
 * Responsibilities:
 *   - One-shot sync: scanLocal + scanPod + diff + apply (uploads, downloads,
 *     conflict markers).
 *   - Continuous sync: chokidar for FS events + interval polling for the pod.
 *   - State persistence: `.onderling/notes-sync-state.json` records the
 *     last-known-common sha256 per relPath, used by `diff` to disambiguate
 *     "local edited" vs "pod edited" vs "both edited".
 *   - Tombstone integration: SyncEngine.deleteLocal forwards to PodClient,
 *     so subsequent runs skip that URI.
 *
 * Design notes:
 *   - SyncEngine extends @onderling/core's `Emitter` so consumers (CLI, web
 *     UI, tray bar) can subscribe to `synced` / `conflict` / `error`.
 *   - FS events are coalesced with a 500ms debounce — a burst of edits in
 *     an editor's "atomic save" pattern triggers a single runOnce.
 *   - State is written atomically via tmp-then-rename.
 */

import { Emitter } from '@onderling/core';

import { PathMap }       from './PathMap.js';
import { scanLocal }     from './scanLocal.js';
import { scanPod }       from './scanPod.js';
import { diff }          from './diff.js';
// applyConflict / ensureShares / listShares are app-shaped concerns —
// passed in via constructor hooks (defaults below are no-ops).

// Time-machine versioning now rides the shared @onderling/versioning
// substrate (— the last legacy version store,./versions.js,
// retired). One `createVersionStore` per engine instance stores each
// snapshot as an opaque record in a StorageBackend (Node fs by default)
// instead of a browsable `.folio/versions/<rel>/<ts>.<ext>` tree.
import { createVersionStore }  from '@onderling/versioning';
// Node-only persistent backend (dedicated `/node` subpath so browser/RN
// bundles that only import the portable surface aren't poisoned — RN's
// Metro shims `node:fs` to empty, so a NON-Node consumer must inject its
// own `versionBackend`; see the constructor's `versionBackend` option).
import { createFsAdapterBackend } from './fsAdapterBackend.js';

// Pluggable adapters (Folio.C1).  Default to Node singletons; RN callers
// pass their own adapters.
import { fsNode }      from './adapters/fsNode.js';
import { hashNode }    from './adapters/hashNode.js';
import { watcherNode } from './adapters/watcherNode.js';
import { joinPosix, dirnamePosix } from './adapters/pathPosix.js';

// Default hooks — no-ops for substrate consumers that don't need
// conflict-marker writing or auto-share semantics.  When applyConflict
// is missing, the engine still emits 'conflict' events, leaving the
// file untouched (the consumer decides resolution).
const NOOP_APPLY_CONFLICT = async () => { /* substrate default: emit-only */ };
const NOOP_ENSURE_SHARES  = async () => ({ minted: 0, renewed: 0, errors: [] });
const NOOP_LIST_SHARES    = async () => [];

const STATE_FILE_RELPATH = '.onderling/notes-sync-state.json';
const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_POLL_MS     = 60_000;

// Folio v2.6 — sha-stable watcher hardening.
// Some editors save in two writes; some atomic-save patterns rename a temp
// over the target — chokidar fires for both events.  Reading too eagerly
// computes a sha over partial content and produces a false-positive conflict
// on the next tick.  Wait for the file's sha to settle for `stableMs` before
// triggering runOnce.  Cap total wait at `maxStableWaitMs` so an
// ever-changing file (e.g. a downloader streaming bytes) eventually fires.
const DEFAULT_STABLE_MS          = 250;
const DEFAULT_MAX_STABLE_WAIT_MS = 5_000;

// Folio v2.10 — copy-rename grace window.
// After the v2.6 sha-stable check passes, defer `runOnce()` for `graceMs` so a
// short-lived intermediate (e.g. `A (Copy).md` that the user is about to
// rename to `B.md`) never gets pushed to the pod.  If the path is deleted
// (e.g. by a rename that fires unlink+add) within the grace window, we drop
// the path entirely.  `graceMs: 0` disables grace and reverts to v2.6
// behaviour (fire runOnce as soon as the sha is stable).
const DEFAULT_GRACE_MS = 3_000;

/**
 * Folio's versionable predicate (ported verbatim from the retired
 * `versions.js`): reject empty, absolute, or any path with a dotted
 * segment (`.folio/`, `.onderling/`, `.git/`, …), plus `.`/`..`.  Injected
 * into the version store as `retention.shouldVersion` — the substrate's
 * own `versionable` only rejects the versions-root prefix, so this is the
 * HARD INVARIANT that keeps dotfiles + the versions dir out of history.
 */
function isVersionableRel(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) return false;
  const norm = relPath.replace(/\\/g, '/');
  if (norm.startsWith('/')) return false;
  const segs = norm.split('/');
  if (segs.some((s) => s === '' || s === '..' || s === '.' || s.startsWith('.'))) return false;
  return true;
}

export class SyncEngine extends Emitter {
  #podClient;
  #pathMap;
  #localRoot;
  #podRoot;
  #pollIntervalMs;
  #debounceMs;
  #stateFilePath;
  #identity = null;
  #knownState = {};
  #stateLoaded = false;
  #watcher = null;
  #pollTimer = null;
  #debounceTimer = null;
  #running = false;
  #runChain = Promise.resolve();
  #stats = { uploads: 0, downloads: 0, deletes: 0, conflicts: 0, lastSyncAt: null };

  #versionsOpts;
  /** @type {ReturnType<typeof createVersionStore>} */
  #versionStore;

  // Folio.C1 — adapter handles (default to Node singletons).
  #fs;
  #hash;
  #watcherFactory;

  // Folio v2.6 — sha-stable hardening.
  #stableMs;
  #maxStableWaitMs;
  /** @type {Set<string>} paths reported by chokidar within the current debounce window */
  #pendingPaths = new Set();
  /** Pending runOnce queued because of a poll-tick (no path). */
  #pendingPollRun = false;
  /**
   * Per-path stability tracker.  Keys are absolute paths (chokidar's `path` arg).
   * `timer` is the setTimeout handle for the next stability re-check; cleared
   * on stop() and on path eviction.
   * `firstSeenAt` is when we first started the stability vigil for this path
   *   (Date.now() at that moment) — used to enforce `maxStableWaitMs`.
   * `lastSha` is the most-recently-computed sha; matches across two passes
   *   ⇒ stable.  `null` means the file did not exist on the last pass
   *   (we treat sustained ENOENT as "deleted; drop the entry").
   * @type {Map<string, { firstSeenAt: number, lastSha: string|null, timer: any }>}
   */
  #stability = new Map();
  /** A spy hook for tests — fires after a stability decision (settled / unstable / deleted). */
  #onStabilityDecisionForTest = null;

  // Folio v2.10 — grace window after stability.
  #graceMs;
  /**
   * Per-path grace tracker.  Keys are absolute paths.  When a path's
   * stability vigil decides `stable`, we enter a grace phase rather than
   * firing runOnce immediately.  If the path is unlinked (delete or rename)
   * inside the grace window, the entry is dropped and runOnce never fires
   * for that intermediate.  If the grace timer elapses untouched, runOnce
   * fires and the entry is dropped.
   *
   * `armedAt` is when the grace timer was started (Date.now()).
   * `timer` is the setTimeout handle.
   *
   * @type {Map<string, { armedAt: number, timer: any }>}
   */
  #grace = new Map();
  /** A spy hook for tests — fires after a grace decision (`fired` / `dropped` / `restarted`). */
  #onGraceDecisionForTest = null;

  // App-shaped hooks injected at construction.  Substrate consumers that
  // don't need conflict-marker writing or auto-share behaviour leave them
  // unset and get no-op defaults.
  #applyConflictHook;
  #ensureSharesHook;
  #listSharesHook;

  /**
   * @param {object} opts
   * @param {object} opts.podClient                     — @onderling/pod-client PodClient (or any compatible mock)
   * @param {string} opts.localRoot                     — absolute path to local folder
   * @param {string} opts.podRoot                       — pod URI root, e.g. 'https://alice.example/notes/'
   * @param {object} [opts.identity]                    — AgentIdentity (enables Q-Folio.3 auto-share)
   * @param {number} [opts.pollIntervalMs=60_000]       — pod-side scan interval (until LDN ships)
   * @param {number} [opts.debounceMs=500]              — coalesce window for FS events
   * @param {{perFile?:number, budgetMb?:number}} [opts.versions]
   *        Folio.B4 retention.  `perFile` (default 50) is the per-series cap
   *        (mapped to `@onderling/versioning`'s `retention.perSeries`).:
   *        `budgetMb` is IGNORED — the legacy 100 MB whole-tree byte budget was
   *        dropped when the store moved to opaque per-series records.
   * @param {object} [opts.versionBackend]
   *        A `@onderling/versioning` StorageBackend `{get,put,delete,list}` for the
   *        version store.  Defaults to a Node fs backend under
   *        `<localRoot>/.folio/versions`.  Non-Node hosts (RN — Metro shims
   *        `node:fs` to empty) MUST inject their own backend for versioning to
   *        work at runtime.
   * @param {{stableMs?:number, maxStableWaitMs?:number, graceMs?:number}} [opts.watcher]
   *        Folio v2.6 sha-stable hardening.  After the standard `debounceMs`
   *        window, each touched path is re-hashed; we only fire `runOnce()`
   *        once the sha is unchanged for `stableMs` (default 250ms).
   *        After `maxStableWaitMs` (default 5000ms) the run fires anyway and
   *        a `'warning'` event with `phase: 'unstable-write'` is emitted.
   *
   *        Folio v2.10 copy-rename grace window: after the sha-stable check
   *        passes, wait an additional `graceMs` (default 3000ms) before
   *        firing `runOnce()`.  If the file is deleted/renamed within the
   *        grace window, the intermediate is skipped — the rename of
   *        `A (Copy).md` → `B.md` then never pushes the intermediate to the
   *        pod.  Set `graceMs: 0` to disable the grace phase and revert to
   *        v2.6 behaviour (fire as soon as sha is stable).
   * @param {import('./adapters/index.js').FsAdapter}      [opts.fs]
   *        Folio.C1 — filesystem adapter.  Defaults to a Node-backed
   *        adapter wrapping `node:fs/promises`.  RN callers (see
   *        `apps/folio/src/rn/serviceFactory.js`) pass an `expo-file-system`
   *        wrapper.  Threaded into `scanLocal`, `applyConflict`,
   *        `versions`, and `autoShare` for every read/write.
   * @param {import('./adapters/index.js').HashAdapter}    [opts.hash]
   *        Folio.C1 — hash adapter.  Defaults to a Node-backed
   *        `createHash('sha256')` wrapper.  RN callers pass an
   *        `expo-crypto` wrapper.
   * @param {import('./adapters/index.js').WatcherAdapter} [opts.watcherFactory]
   *        Folio.C1 — watcher adapter.  Defaults to a chokidar wrapper.
   *        RN callers pass an interval-poll watcher.  This is a SEPARATE
   *        knob from the legacy `watcher` parameter (above) which
   *        configures stability / grace timings.
   *
   * ─── hook surface (Folio app-side concerns) ────────────────
   * Slice G #5 (2026-05-20) — substrate's app-glue seam.  Each hook
   * defaults to a no-op so non-Folio consumers (stoop-mobile, tasks-
   * mobile) work without configuration.  Folio's subclass pre-binds
   * its own implementations via `super({ ...hooks })`.
   *
   * @param {(localRel: string) => {sharer: string} | null} [opts.parseSharePath]
   *        Forwarded into the internal `PathMap`.  Recognizes a local
   *        relative path as belonging to a shared folder (e.g. Folio's
   *        `with-<webid>/<file>` convention) and returns `{sharer}` so
   *        the PathMap can route the file to the sharer's pod root
   *        rather than the local user's.  Returns `null` for paths
   *        outside any share folder.  Default: no-op (treats all paths
   *        as own-pod).
   *
   * @param {(args: {
   *   relPath: string,
   *   localBytes: Uint8Array,
   *   podBytes: Uint8Array,
   *   localEtag: string|null,
   *   podEtag: string|null,
   * }) => Promise<{merged: Uint8Array} | null>} [opts.applyConflictHook]
   *        Called when `runOnce` detects a divergent edit (different
   *        SHA on both sides since last sync).  Folio's hook writes
   *        a git-style `<<<<<<< MINE / ======= / >>>>>>> THEIRS` merge
   *        marker and returns the marked-up content as `merged`; the
   *        engine then writes that as the resolved file.  Return
   *        `null` to bypass merging (the substrate's default — emits
   *        a `conflict` event and leaves both copies for the
   *        caller).  Forward-additive: extra args may be added in
   *        future minor versions.
   *
   * @param {(args: {
   *   identity: import('./types.js').AgentIdentity | null,
   *   pathMap: PathMap,
   *   podClient: object,
   *   shares: Array<{relPath: string, sharer: string}>,
   * }) => Promise<{minted: number, renewed: number, errors: Error[]}>} [opts.ensureSharesHook]
   *        Called once per `runOnce` AFTER the diff is applied.  Folio
   *        uses this to mint / renew per-folder `PodCapabilityToken`s
   *        for any `with-<webid>/` folder discovered in this sync —
   *        the Q-Folio.3 auto-share convention.  Substrate's default
   *        is a no-op (returns `{minted: 0, renewed: 0, errors: []}`).
   *        Identity rotation: when `identity.pubKey` differs from a
   *        token's `issuer`, the hook should re-issue (see Folio's
   *        `autoShare.js`).
   *
   * @param {() => Promise<Array<{
   *   relPath: string, sharer: string, token: string, issuer: string,
   * }>>} [opts.listSharesHook]
   *        Returns the current share-token state for observability
   *        (the engine's `shares()` method delegates to this).  Folio
   *        reads its `.folio/shares.json` sidecar.  Default: returns
   *        `[]`.
   */
  constructor({
    podClient,
    localRoot,
    podRoot,
    identity,
    pollIntervalMs = DEFAULT_POLL_MS,
    debounceMs     = DEFAULT_DEBOUNCE_MS,
    versions       = null,
    watcher        = null,
    fs             = null,
    hash           = null,
    watcherFactory = null,
    versionBackend = null,
    // hook surface (Folio app-side concerns):
    parseSharePath    = null,                 // forwarded into the internal PathMap
    applyConflictHook = NOOP_APPLY_CONFLICT,
    ensureSharesHook  = NOOP_ENSURE_SHARES,
    listSharesHook    = NOOP_LIST_SHARES,
  } = {}) {
    super();
    if (!podClient) throw new Error('SyncEngine: podClient is required');
    if (!localRoot) throw new Error('SyncEngine: localRoot is required');
    if (!podRoot)   throw new Error('SyncEngine: podRoot is required');
    this.#podClient      = podClient;
    this.#localRoot      = String(localRoot).replace(/[\/\\]+$/, '');
    this.#podRoot        = String(podRoot).endsWith('/') ? String(podRoot) : `${podRoot}/`;
    this.#pathMap        = new PathMap({ localRoot: this.#localRoot, podRoot: this.#podRoot, parseSharePath });
    this.#identity       = identity ?? null;
    this.#pollIntervalMs = pollIntervalMs;
    this.#debounceMs     = debounceMs;
    this.#fs             = fs   ?? fsNode;
    this.#hash           = hash ?? hashNode;
    this.#watcherFactory = watcherFactory ?? watcherNode;
    this.#applyConflictHook = typeof applyConflictHook === 'function' ? applyConflictHook : NOOP_APPLY_CONFLICT;
    this.#ensureSharesHook  = typeof ensureSharesHook  === 'function' ? ensureSharesHook  : NOOP_ENSURE_SHARES;
    this.#listSharesHook    = typeof listSharesHook    === 'function' ? listSharesHook    : NOOP_LIST_SHARES;
    this.#stateFilePath  = joinPosix(this.#localRoot, STATE_FILE_RELPATH);
    this.#versionsOpts   = versions ?? {};

    // one version store per engine instance, over @onderling/versioning.
    //   backend    : a PORTABLE fs-adapter store over the engine's OWN `#fs`
    //                adapter (records under <localRoot>/.folio/versions) — the
    //                same adapter the retired versions.js used, so it runs on
    //                Node AND RN with one code path (NodeFsBackend hard-wires
    //                node:fs → a silent no-op on RN). A consumer may still inject
    //                its own `versionBackend`.
    //   hash       : the engine's injected hash adapter (RN-safe).
    //   readLive/  : read + write the LIVE working file so restore snapshots the
    //   writeLive    current content first (undoable) then writes the target back —
    //                the existing watcher/sync loop then propagates to the pod.
    //   shouldVersion: Folio's dotted-segment reject (HARD INVARIANT).
    //   writerId   : OMITTED — Folio's working-file sync is single-writer.
    //   retention  : per-series cap = the 50/file (perFile) knob. HONEST DROP —
    //                the legacy 100 MB whole-tree byte budget goes away (the
    //                substrate is per-series-cap only); re-add via an index
    //                record only if wanted (see PLAN-folio-as-file-agent).
    const backend = versionBackend
      ?? createFsAdapterBackend({
        fs:      this.#fs,
        hashHex: (s) => this.#hash.sha256(s),
        dir:     joinPosix(this.#localRoot, '.folio', 'versions'),
      });
    this.#versionStore = createVersionStore({
      backend,
      hash:      (content) => this.#hash.sha256(content),
      readLive:  (uri) => this.#readLiveForVersion(uri),
      writeLive: (uri, content) => this.#writeLiveForVersion(uri, content),
      retention: {
        perSeries:     this.#versionsOpts.perFile,   // undefined → substrate default (50)
        shouldVersion: isVersionableRel,
      },
      versionsRoot: '.folio/versions/',
    });
    const w = watcher ?? {};
    this.#stableMs        = Number.isFinite(w.stableMs)        ? Math.max(0, w.stableMs)        : DEFAULT_STABLE_MS;
    this.#maxStableWaitMs = Number.isFinite(w.maxStableWaitMs) ? Math.max(0, w.maxStableWaitMs) : DEFAULT_MAX_STABLE_WAIT_MS;
    this.#graceMs         = Number.isFinite(w.graceMs)         ? Math.max(0, w.graceMs)         : DEFAULT_GRACE_MS;
    // Public accessor so consumers can read the configured retention.
    this.options = {
      versions: { ...this.#versionsOpts },
      watcher:  {
        stableMs:        this.#stableMs,
        maxStableWaitMs: this.#maxStableWaitMs,
        graceMs:         this.#graceMs,
      },
    };
  }

  /**
   * Adapter introspection — useful for autoShare/ensureShares so it can
   * thread the SyncEngine's `fs` adapter through to its own helpers.
   * @returns {import('./adapters/index.js').FsAdapter}
   */
  get fs() { return this.#fs; }
  /** @returns {import('./adapters/index.js').HashAdapter} */
  get hash() { return this.#hash; }

  get stats()     { return { ...this.#stats }; }
  get pathMap()   { return this.#pathMap; }
  get localRoot() { return this.#localRoot; }
  get podRoot()   { return this.#podRoot; }
  get identity()  { return this.#identity; }
  /**
   * The per-engine @onderling/versioning store. Exposed so the
   * Folio REST routes can serve `list`/`read`/`listSeries`/`isVersionable`
   * without a second store instance.  PRIVILEGED `drop`/`prune` are on it
   * too — route handlers must never wire those into a grantable op.
   */
  get versionStore() { return this.#versionStore; }

  /**
   * public observability for watch state.
   *
   * Returns `true` once the watcher adapter has actually attached
   * (async — `start()` is fire-and-forget, so there's a brief window
   * where `#running` is set but `#watcher` is still being constructed).
   *
   * Distinct from app-level "intent" flags (e.g. folio's
   * `engine.__watching`, set synchronously when `start()` is called):
   *
   *   - `isWatching` = the *fact* the watcher is attached.
   *   - app-side intent flag = the *decision* to watch.
   *
   * Apps that want a UI signal that doesn't blink during the attach
   * race should stay on their intent flag; apps that need to know the
   * substrate is genuinely armed (e.g. to skip a redundant `start()`)
   * should use `isWatching`.
   */
  get isWatching() { return !!this.#watcher; }

  /**
   * Slice G #6 (2026-05-20) — public observability for run state.
   *
   * Returns `true` while `start()` has been called and `stop()` hasn't,
   * regardless of whether the watcher has actually attached.  Mirrors
   * `isWatching` but for the synchronous decision rather than the
   * async attach.
   *
   * UI usage: disable "Sync now" / "Force re-push" buttons while
   * `isRunning` is true to prevent overlapping runs (the substrate's
   * `#runChain` already serialises, but UI feedback matters too).
   */
  get isRunning() { return !!this.#running; }

  /**
   * Set or replace the signing identity used for the Q-Folio.3 auto-share
   * convention.  Pass `null` to disable auto-share until a new identity is set.
   * On the next `runOnce`, any token whose `issuer` differs from the new
   * identity's pubKey will be re-issued (per the rotation rule).
   */
  setIdentity(identity) {
    this.#identity = identity ?? null;
  }

  /**
   * Hot-swap the live PodClient (Folio v2.1).
   *
   * Replaces `#podClient` atomically.  Any in-flight runOnce keeps using the
   * old client until it resolves — we deliberately do NOT touch `#runChain`,
   * so currently-in-flight reads/writes against the OLD client are allowed
   * to finish.  The NEXT scheduled / explicit `runOnce` picks up the new
   * client.
   *
   * `#stateLoaded` is reset so the state file is re-read on the next run —
   * the new pod's view of state may differ from the old one's.
   *
   * Emits a private `pod-client-swapped` event for internal subscribers
   * (intentionally NOT mirrored to the public WS API).
   *
   * @param {object} newClient — a PodClient (or compatible mock).
   */
  setPodClient(newClient) {
    if (!newClient) throw new Error('SyncEngine.setPodClient: newClient is required');
    this.#podClient = newClient;
    this.#stateLoaded = false;
    this.emit('pod-client-swapped', { ts: Date.now() });
  }

  /**
   * Return the live list of auto-share tokens, suitable for CLI / UI display.
   * Each entry: `{ webid, path, podUri, issuer, issuedAt, expires }`.
   *
   * @returns {Promise<Array<object>>}
   */
  async shares() {
    return this.#listSharesHook(this.#localRoot, { fs: this.#fs });
  }

  /**
   * One-shot sync: scan both sides, compute diff, apply, persist state.
   *
   * @param {object} [opts]
   * @param {'both'|'push'|'pull'} [opts.direction='both']
   * @returns {Promise<{ uploads:number, downloads:number, deletes:number, conflicts:number }>}
   */
  async runOnce({ direction = 'both' } = {}) {
    // Serialize concurrent runOnce calls to keep state file writes consistent.
    const next = this.#runChain.then(() => this.#runOnceInternal({ direction }));
    this.#runChain = next.catch(() => {}); // never let the chain reject permanently
    return next;
  }

  async #runOnceInternal({ direction }) {
    await this.#loadState();

    // Ensure local root exists so chokidar / scanLocal don't blow up.
    await this.#fs.mkdir(this.#localRoot, { recursive: true });

    // Folio v2.1 — snapshot the podClient ref once at the start of the
    // internal run.  setPodClient() may replace `#podClient` mid-flight; the
    // contract is that an already-started run continues against the OLD
    // client (so in-flight writes don't get re-routed).  All subsequent
    // reads/writes in this run go through `podClient` (the local snapshot).
    const podClient = this.#podClient;

    const localScan = await scanLocal(this.#localRoot, { pathMap: this.#pathMap, fs: this.#fs, hash: this.#hash });
    const podScan   = await scanPod(podClient, this.#podRoot, { pathMap: this.#pathMap, hash: this.#hash });

    // Phase D — pre-list pod-side tombstones into a sync predicate so a
    // deliberately-deleted file isn't resurrected by the local-only
    // re-upload branch. The tombstone store lives on the PodClient
    // (`tombstoneStore` getter); when the client is the pseudo-pod
    // adapter the real client is reachable via `_podClient`. Best-effort
    // and non-fatal: any failure ⇒ no predicate ⇒ legacy behaviour.
    let isTombstoned;
    try {
      const tombStore = podClient?.tombstoneStore ?? podClient?._podClient?.tombstoneStore ?? null;
      if (tombStore && typeof tombStore.list === 'function') {
        const entries = await tombStore.list();
        const tombSet = new Set((entries ?? []).map((t) => (typeof t === 'string' ? t : t?.uri)).filter(Boolean));
        if (tombSet.size > 0) {
          // Mirror SyncEngine.deleteLocal's pod-URI derivation (the
          // tombstone creator) so the keys line up.
          isTombstoned = (rel) =>
            tombSet.has(`${this.#podRoot}${rel.split('/').map(encodeURIComponent).join('/')}`);
        }
      }
    } catch { /* no tombstone source / list failed → legacy behaviour */ }

    const d = diff(localScan, podScan, this.#knownState, isTombstoned ? { isTombstoned } : {});

    let uploads = 0, downloads = 0, deletes = 0, conflicts = 0;

    if (direction === 'both' || direction === 'push') {
      // Some pod servers (notably Inrupt's storage.inrupt.com) don't
      // auto-create parent containers on PUT — we have to create them
      // explicitly or the first write to a fresh subdir 404s.  Collect
      // every unique parent container the upload set needs (including
      // the pod root itself) and ensure each exists once before writing.
      const containersToEnsure = new Set();
      for (const f of d.toUpload) {
        const podUri = this.#pathMap.localToPod(f.absPath);
        for (const c of parentContainersOf(podUri, this.#podRoot)) {
          containersToEnsure.add(c);
        }
      }
      for (const c of containersToEnsure) {
        try {
          if (typeof podClient.createContainer === 'function') {
            await podClient.createContainer(c);
          }
        } catch (err) {
          // 412 / CONFLICT means the container already exists — that's
          // exactly what `ensure-container` wants.  Inrupt's
          // createContainerAt sends `If-None-Match: *` and returns 412
          // for existing containers; treat as success.
          if (err?.code === 'CONFLICT' || err?.status === 412) continue;
          this.emit('error', { phase: 'ensure-container', uri: c, err });
        }
      }

      for (const f of d.toUpload) {
        try {
          const podUri = this.#pathMap.localToPod(f.absPath);
          const content = await this.#fs.readFile(f.absPath);
          const ct = guessContentType(f.relPath);
          await podClient.write(podUri, content, { contentType: ct });
          this.#knownState[f.relPath] = { sha256: f.sha256, syncedAt: Date.now() };
          uploads++;
          // Folio.B4: snapshot the just-uploaded content.  Skip dotted paths
          // (which would feed back into .folio/versions/ itself).
          await this.#captureVersionSafe(f.relPath, content);
        } catch (err) {
          this.emit('error', { phase: 'upload', relPath: f.relPath, err });
        }
      }
    }

    if (direction === 'both' || direction === 'pull') {
      for (const f of d.toDownload) {
        try {
          const r = await podClient.read(f.podUri, { decode: 'string' });
          const absPath = this.#pathMap.podToLocal(f.podUri);
          await this.#fs.mkdir(dirnamePosix(absPath), { recursive: true });
          // Write content as-is.  PodClient.read with decode:'string' returns a string;
          // for binary content, callers can switch to bytes — v1 Folio is markdown.
          if (typeof r.content === 'string') {
            await this.#fs.writeFile(absPath, r.content, { encoding: 'utf8' });
          } else {
            await this.#fs.writeFile(absPath, r.content);
          }
          this.#knownState[f.relPath] = { sha256: f.sha256, syncedAt: Date.now() };
          downloads++;
          // Folio.B4: snapshot the just-downloaded content.
          await this.#captureVersionSafe(f.relPath, r.content);
        } catch (err) {
          if (err?.code === 'NOT_FOUND') {
            // 404-on-read GC'd the tombstone (per A6); ignore.
          } else {
            this.emit('error', { phase: 'download', relPath: f.relPath, err });
          }
        }
      }
    }

    for (const f of d.conflicts) {
      try {
        const localText = await this.#fs.readFileText(f.absPath, 'utf8');
        const remote    = await podClient.read(f.podUri, { decode: 'string' });
        await this.#applyConflictHook(f.absPath, localText, String(remote.content ?? ''), {
          localTimestamp:  f.localMtimeMs,
          remoteTimestamp: f.remoteMtimeMs,
          fs:              this.#fs,
        });
        // Folio.B4: snapshot the conflicted-state content too — it's the
        // intermediate state the user sees, and rolling back a botched
        // resolve to the marker form is genuinely useful.
        try {
          const conflictedText = await this.#fs.readFileText(f.absPath, 'utf8');
          await this.#captureVersionSafe(f.relPath, conflictedText);
        } catch { /* swallow — captureVersion is best-effort */ }
        // Don't update knownState — file is in conflict until user resolves.
        conflicts++;
        this.emit('conflict', { relPath: f.relPath, absPath: f.absPath, podUri: f.podUri });
      } catch (err) {
        this.emit('error', { phase: 'conflict', relPath: f.relPath, err });
      }
    }

    // Evict state for files that vanished from both sides.
    for (const f of d.toDelete) {
      delete this.#knownState[f.relPath];
      deletes++;
    }

    await this.#saveState();
    // Q-Folio.3 — ensure `with-<webid>/` folders have current capability tokens.
    // Runs after a successful sync so any newly-pushed share folder has its
    // pod resources in place when we mint the token.  No-op when no identity
    // is configured (existing tests + CLI v1 path).
    await this.#ensureSharesSafe();
    this.#stats.uploads   += uploads;
    this.#stats.downloads += downloads;
    this.#stats.deletes   += deletes;
    this.#stats.conflicts += conflicts;
    this.#stats.lastSyncAt = Date.now();
    this.emit('synced', { uploads, downloads, deletes, conflicts });
    return { uploads, downloads, deletes, conflicts };
  }

  /**
   * Force re-push (Folio v2.5).  Re-uploads EVERY file in `localScan`,
   * ignoring `knownState` and ignoring whether `localSha === podSha`.
   *
   * Useful when local and pod have drifted (manual edits in the pod, server
   * reset, knownState corruption) and the user wants a guaranteed push.
   *
   * Contract:
   *   - Push only — never pulls or deletes.
   *   - Iterates every file in `localScan` and uploads each one.
   *   - After upload, knownState is rewritten with the new sha for every
   *     file so subsequent `runOnce()` calls see "in sync".
   *   - Errors on individual files don't abort the run — others still attempt.
   *   - Uses the same `#runChain` as `runOnce()` so an in-flight sync waits
   *     its turn.
   *
   * Emits:
   *   - 'sync.force.start' { ts }
   *   - 'sync.force.done'  { ts, uploads, errors }
   *
   * @returns {Promise<{ uploads:number, errors:number }>}
   */
  async forcePush() {
    const next = this.#runChain.then(() => this.#forcePushInternal());
    this.#runChain = next.catch(() => {});
    return next;
  }

  async #forcePushInternal() {
    await this.#loadState();
    await this.#fs.mkdir(this.#localRoot, { recursive: true });

    // Snapshot the live podClient so a hot-swap mid-flight doesn't reroute
    // in-flight writes (mirrors the `runOnce` contract).
    const podClient = this.#podClient;

    this.emit('sync.force.start', { ts: Date.now() });

    const localScan = await scanLocal(this.#localRoot, { pathMap: this.#pathMap, fs: this.#fs, hash: this.#hash });

    let uploads = 0, errors = 0;

    // Ensure every parent container exists before writing (same path as
    // `runOnce` push).
    const containersToEnsure = new Set();
    for (const f of localScan) {
      const podUri = this.#pathMap.localToPod(f.absPath);
      for (const c of parentContainersOf(podUri, this.#podRoot)) {
        containersToEnsure.add(c);
      }
    }
    for (const c of containersToEnsure) {
      try {
        if (typeof podClient.createContainer === 'function') {
          await podClient.createContainer(c);
        }
      } catch (err) {
        this.emit('error', { phase: 'ensure-container', uri: c, err });
      }
    }

    for (const f of localScan) {
      try {
        const podUri = this.#pathMap.localToPod(f.absPath);
        const content = await this.#fs.readFile(f.absPath);
        const ct = guessContentType(f.relPath);
        // `force: true` skips PodClient's If-Match handshake — we explicitly
        // want to overwrite remote with local content regardless of etag.
        await podClient.write(podUri, content, { contentType: ct, force: true });
        // Update knownState with the just-pushed sha so subsequent runOnce
        // calls don't re-push the same content.
        this.#knownState[f.relPath] = { sha256: f.sha256, syncedAt: Date.now() };
        uploads++;
        // Snapshot like runOnce does.
        await this.#captureVersionSafe(f.relPath, content);
      } catch (err) {
        errors++;
        this.emit('error', { phase: 'force-push', relPath: f.relPath, err });
      }
    }

    await this.#saveState();
    this.#stats.uploads += uploads;
    this.#stats.lastSyncAt = Date.now();
    this.emit('sync.force.done', { ts: Date.now(), uploads, errors });
    return { uploads, errors };
  }

  /**
   * Verify the pod's view of one file (Folio v2.5).
   *
   * Returns a structured result describing whether `relPath` exists in the
   * pod and whether its size + sha256 match the local file.
   *
   * Uses the cheapest path:
   *   1. `podClient.exists(uri)` if available — pure HEAD, no body read.
   *   2. Fallback to `podClient.read(uri, { decode: 'bytes' })` — reads
   *      content but lets us compute exact size + sha matches.
   *
   * No state mutation; this is a snapshot, not a sync.
   *
   * @param {string} relPath POSIX-style relative path
   * @returns {Promise<{
   *   relPath: string,
   *   podUri:  string,
   *   exists:  boolean,
   *   sizeMatches?: boolean,
   *   shaMatches?:  boolean,
   *   localSize?:   number,
   *   podSize?:     number,
   *   podEtag?:     string,
   * }>}
   */
  async verifyPodState(relPath) {
    if (typeof relPath !== 'string' || relPath.length === 0) {
      throw new Error('verifyPodState: relPath is required');
    }
    const podUri = `${this.#podRoot}${relPath.split('/').map(encodeURIComponent).join('/')}`;
    const podClient = this.#podClient;

    // Read local first (cheap) — if it doesn't exist locally we can still
    // report on the pod side.
    const absPath = this.#pathMap.podToLocal(podUri);
    let localSize, localSha256;
    try {
      const buf = await this.#fs.readFile(absPath);
      localSize = buf.byteLength;
      localSha256 = await this.#hash.sha256(buf);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Surface but don't abort — we can still verify pod existence.
      }
    }

    // Step 1 — try cheapest: HEAD-only via podClient.exists().
    if (typeof podClient.exists === 'function') {
      let exists = false;
      try {
        exists = !!(await podClient.exists(podUri));
      } catch {
        exists = false;
      }
      if (!exists) {
        return { relPath, podUri, exists: false };
      }
      // Try to get metadata without a body read; not every PodClient has a
      // dedicated head().  If we can't get size/etag cheaply, fall through
      // to the read() path so size/sha verification is still possible.
      if (typeof podClient.head === 'function') {
        try {
          const meta = await podClient.head(podUri);
          const out = { relPath, podUri, exists: true };
          if (meta?.etag) out.podEtag = meta.etag;
          if (typeof meta?.size === 'number') {
            out.podSize = meta.size;
            if (typeof localSize === 'number') {
              out.sizeMatches = meta.size === localSize;
            }
          }
          // No content available → can't verify sha.  Caller can decide
          // whether to fall back to a full read.
          return out;
        } catch {
          // fall through to read()
        }
      }
      // No head() — fall through to read().
    }

    // Step 2 — fall back to read().  Captures size + (with content) sha.
    try {
      const r = await podClient.read(podUri, { decode: 'bytes' });
      const bytes = r.content instanceof Uint8Array
        ? r.content
        : (typeof r.content === 'string' ? new TextEncoder().encode(r.content) : new Uint8Array());
      const podSize = typeof r.size === 'number' ? r.size : bytes.byteLength;
      const podSha = await this.#hash.sha256(bytes);
      const out = {
        relPath,
        podUri,
        exists:  true,
        podSize,
        podEtag: r.etag,
      };
      if (typeof localSize === 'number') {
        out.localSize    = localSize;
        out.sizeMatches  = podSize === localSize;
        out.shaMatches   = !!localSha256 && podSha === localSha256;
      }
      return out;
    } catch (err) {
      if (err?.code === 'NOT_FOUND') {
        return { relPath, podUri, exists: false };
      }
      throw err;
    }
  }

  async #ensureSharesSafe() {
    if (!this.#identity) return;
    try {
      const r = await this.#ensureSharesHook(this, this.#identity, { fs: this.#fs });
      if (r.minted > 0 || r.renewed > 0) {
        this.emit('shares', { minted: r.minted, renewed: r.renewed, errors: r.errors });
      }
      for (const e of r.errors ?? []) {
        this.emit('error', { phase: 'auto-share', code: e.code, message: e.message, name: e.name });
      }
    } catch (err) {
      this.emit('error', { phase: 'auto-share', err });
    }
  }

  /**
   * Continuous mode: starts the watcher (Node default = chokidar; RN =
   * interval poll) plus an interval-poll-the-pod timer.  An initial
   * `runOnce()` fires once the watcher's `start()` resolves.
   *
   * Starts async-fire-and-forget so callers don't have to await; tests
   * give chokidar a brief attach window before exercising events.
   */
  start() {
    if (this.#running) return;
    this.#running = true;

    const ignored = (p) => {
      // chokidar/RN-walker may pass abs path or rel; normalize.
      const pp = String(p);
      if (pp === this.#localRoot) return false;
      // Quick reject: any path segment that begins with '.'.
      const tail = pp.startsWith(this.#localRoot)
        ? pp.slice(this.#localRoot.length).replace(/^[\/\\]+/, '')
        : pp;
      const segs = tail.split(/[\/\\]/);
      return segs.some((s) => s.startsWith('.'));
    };

    // Start the watcher via the adapter.  The handle is stored on
    // `#watcher` so `stop()` can shut it down.  Uses a fire-and-forget
    // .then() so `start()` stays synchronous (matches the v1 contract).
    this.#watcherFactory.start({
      root:    this.#localRoot,
      ignored,
      onEvent: ({ event, absPath }) => { this.#scheduleRun(absPath, event); },
      onError: (err) => { this.emit('error', { phase: 'watcher', err }); },
    }).then((handle) => {
      // If stop() ran between start() and the watcher attaching, shut
      // the freshly-started watcher down immediately.
      if (!this.#running) {
        try { handle.stop(); } catch { /* swallow */ }
        return;
      }
      this.#watcher = handle;
    }).catch((err) => {
      this.emit('error', { phase: 'watcher', err });
    });

    this.#pollTimer = setInterval(() => { this.#scheduleRun(); }, this.#pollIntervalMs);
    if (typeof this.#pollTimer.unref === 'function') this.#pollTimer.unref();

    // Initial sync.
    this.runOnce().catch((err) => this.emit('error', { phase: 'initial', err }));
  }

  /** Stop watcher + timer; safe to call multiple times. */
  async stop() {
    this.#running = false;
    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }
    if (this.#pollTimer) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = null;
    }
    // Folio v2.6 — drop any pending stability vigils.
    for (const entry of this.#stability.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.#stability.clear();
    // Folio v2.10 — drop any pending grace timers.
    for (const entry of this.#grace.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.#grace.clear();
    this.#pendingPaths.clear();
    this.#pendingPollRun = false;
    if (this.#watcher) {
      try { await this.#watcher.stop(); } catch { /* swallow */ }
      this.#watcher = null;
    }
    // Drain any in-flight runOnce so callers can rely on no further state writes.
    try { await this.#runChain; } catch { /* swallow */ }
  }

  /**
   * Local-only delete (tombstone via PodClient).  Subsequent runOnce calls
   * skip this URI.  Folio.B4 — also drops the version history under
   * `.folio/versions/<relPath>/` (so `folio rm` is a true forget).
   *
   * @param {string} relPath  POSIX-style relative path
   */
  async deleteLocal(relPath) {
    const podUri = `${this.#podRoot}${relPath.split('/').map(encodeURIComponent).join('/')}`;
    if (typeof this.#podClient.deleteLocal === 'function') {
      await this.#podClient.deleteLocal(podUri);
    }
    // Also drop from local known state so we don't try to push a phantom.
    delete this.#knownState[relPath];
    await this.#saveState();
    // Drop version history so `folio rm` is a complete forget.  Best-effort.
    try { await this.dropVersions(relPath); } catch { /* swallow */ }
  }

  /**
   * Permanent delete (Folio v2.11).  Removes the file from the pod and the
   * local working copy, drops knownState, and wipes the time-machine
   * history for the file — "fully forget this file, everywhere".
   *
   * Contract:
   *   - Resolves the pod URI from `relPath` via the engine's PathMap.
   *   - Calls `podClient.deleteCompletely(podUri)` — pod-side resource is
   *     gone for everyone after this returns.  NOT_FOUND is treated as a
   *     success (the resource is already gone).
   *   - Removes the local file (best-effort; ENOENT is fine).
   *   - Drops the file's entry from `#knownState` and persists.
   *   - Drops the file's version history (`dropVersions(relPath)`) so a
   *     restore via the time-machine is impossible after this call.
   *   - Emits `sync.delete.done` with `{ ts, relPath, podUri }`.
   *
   * Errors from the pod client (other than NOT_FOUND) propagate to the
   * caller; the route handler turns them into a 500.  knownState + version
   * history are NOT touched on a pod-side failure (the resource still
   * exists; the user can retry).
   *
   * @param {string} relPath  POSIX-style relative path
   * @returns {Promise<{ relPath: string, podUri: string }>}
   */
  async deleteCompletely(relPath) {
    if (typeof relPath !== 'string' || relPath.length === 0) {
      throw new Error('deleteCompletely: relPath is required');
    }
    const podUri = this.#pathMap.localToPod(joinPosix(this.#localRoot, ...relPath.split('/')));
    const podClient = this.#podClient;
    try {
      if (typeof podClient.deleteCompletely === 'function') {
        await podClient.deleteCompletely(podUri);
      } else if (typeof podClient.delete === 'function') {
        await podClient.delete(podUri);
      }
    } catch (err) {
      if (err?.code !== 'NOT_FOUND') throw err;
      // Already gone from the pod — proceed with local cleanup.
    }
    // Best-effort local file removal — the file may be absent (e.g. the
    // user deleted it from the OS file manager already).
    const absPath = joinPosix(this.#localRoot, ...relPath.split('/'));
    try { await this.#fs.unlink(absPath); } catch (err) {
      if (err && err.code !== 'ENOENT') {
        this.emit('error', { phase: 'delete-local-file', relPath, err });
      }
    }
    await this.#loadState();
    delete this.#knownState[relPath];
    await this.#saveState();
    // Wipe the time-machine history — pod-delete is "permanent."
    try { await this.dropVersions(relPath); } catch { /* swallow */ }
    this.emit('sync.delete.done', { ts: Date.now(), relPath, podUri });
    return { relPath, podUri };
  }

  // ── Folio.B4 — time-machine versioning ────────────────────────────────────

  /**
   * List all versions of `relPath`, newest-first.
   *
   * @param {string} relPath POSIX-style path (matches the SyncEngine convention).
   * @returns {Promise<Array<{ts:number, id:string, sha256:string, size:number}>>}
   *   NOTE: the legacy on-disk `path` field is GONE — snapshots are opaque
   *   records now. Consumers read content via the store's
   *   `read(relPath, ts)` (routes) rather than a filesystem path.
   */
  async versions(relPath) {
    return this.#versionStore.list(relPath);
  }

  /**
   * Restore the version at `ts` to the live file.  Captures the CURRENT
   * content as a fresh version FIRST (so the user can undo).  Returns
   * `{ relPath, restoredFromMs, snapshotMsBeforeRestore }`.
   */
  async restoreVersion(relPath, ts) {
    const r = await this.#versionStore.restore(relPath, ts);
    // Emit so UIs (history pane) can refresh.  Same shape as the capture
    // event so the WS layer can fan both out cleanly.
    if (r.snapshotMsBeforeRestore != null) {
      this.emit('version.new', {
        relPath,
        ts: r.snapshotMsBeforeRestore,
      });
    }
    // Preserve the retired module's return shape (`uri` → `relPath`).
    return {
      relPath,
      restoredFromMs:          r.restoredFromMs,
      snapshotMsBeforeRestore: r.snapshotMsBeforeRestore,
    };
  }

  /**
   * Drop ALL version history for `relPath`.
   * @returns {Promise<number>} count deleted
   */
  async dropVersions(relPath) {
    return this.#versionStore.drop(relPath);
  }

  /**
   * Run the per-series retention cap for `relPath`.  Called automatically
   * on every capture; exposed for tests + manual cleanup.
   *
   * NOTE: the legacy whole-tree walk + 100 MB byte budget are GONE — the
   * substrate enforces the per-series cap only (honest drop), so
   * this now prunes a single series (no-op when `relPath` is omitted).
   */
  async pruneVersions(relPath) {
    return this.#versionStore.prune({ uri: relPath });
  }

  /**
   * Capture a brand-new snapshot for `relPath` with the given content.
   * Used by route handlers (e.g. POST /conflicts/:id/resolve) to log the
   * resolved content as a version.  No-op when relPath is dotted.
   *
   * @param {string} relPath
   * @param {string|Uint8Array|Buffer} content
   * @returns {Promise<{captured:boolean, ts?:number, sha256?:string, reason?:string}>}
   */
  async captureVersion(relPath, content) {
    return this.#captureVersionSafe(relPath, content);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * Capture a version for `relPath` with the given content.  Internal
   * wrapper that:
   *   - skips dotted paths (would feedback into .folio/versions/),
   *   - swallows capture failures (versioning must never break sync),
   *   - emits `version.new` on a successful capture.
   */
  async #captureVersionSafe(relPath, content) {
    if (!this.#versionStore.isVersionable(relPath)) return { captured: false, reason: 'NOT_VERSIONABLE' };
    let r;
    try {
      r = await this.#versionStore.capture(relPath, content);
    } catch (err) {
      // HARD INVARIANT — capture is BEST-EFFORT: a store throw must NEVER
      // break the sync loop (swallow, as the retired module did).
      this.emit('error', { phase: 'version', relPath, err });
      return { captured: false, reason: 'CAPTURE_FAILED' };
    }
    if (r.captured) {
      this.emit('version.new', { relPath, ts: r.ts, sha256: r.sha256, size: r.size });
    }
    return r;
  }

  /**
   * Read the LIVE working file for a version `uri` (= relPath).  Returns
   * its bytes; tolerates a missing file (→ '') so restore's undoable
   * pre-snapshot of a deleted file captures an empty baseline (matches the
   * retired module's `Buffer.alloc(0)` behaviour).
   */
  async #readLiveForVersion(uri) {
    const abs = joinPosix(this.#localRoot, ...String(uri).split('/'));
    try {
      return await this.#fs.readFile(abs);
    } catch (err) {
      if (err && err.code === 'ENOENT') return '';
      throw err;
    }
  }

  /**
   * Write restored content back to the LIVE working file for `uri`.  The
   * existing watcher/sync loop then propagates it to the pod (as today).
   */
  async #writeLiveForVersion(uri, content) {
    const abs = joinPosix(this.#localRoot, ...String(uri).split('/'));
    await this.#fs.mkdir(dirnamePosix(abs), { recursive: true });
    if (typeof content === 'string') {
      await this.#fs.writeFile(abs, content, { encoding: 'utf8' });
    } else {
      await this.#fs.writeFile(abs, content);
    }
  }

  /**
   * Schedule a run after the standard `debounceMs` coalesce window.
   *
   * Folio v2.6: when invoked with a `path` (chokidar event), the path is
   * accumulated into `#pendingPaths` and gates a sha-stability check before
   * `runOnce()` actually fires.  Path-less calls (poll tick) still fire
   * `runOnce()` after the debounce window, but they ALSO clear any
   * stability vigils in flight — a poll tick is a coarse "settle and run"
   * signal that should subsume any pending per-path waits.
   *
   * @param {string} [path]   chokidar absolute path (when present)
   * @param {string} [_event] chokidar event name (add/change/unlink/...) — currently unused but logged
   */
  #scheduleRun(path, event) {
    if (!this.#running) return;
    if (typeof path === 'string' && path.length > 0) {
      // Folio v2.10 — intercept events for paths currently inside the grace
      // window.  An `unlink` (delete or the delete-half of a rename) drops
      // the grace entry so the intermediate is never synced.  A re-armed
      // `add` / `change` cancels the grace timer and restarts the stability
      // vigil from scratch via the normal pendingPaths flow.
      if (this.#grace.has(path)) {
        const entry = this.#grace.get(path);
        if (entry?.timer) clearTimeout(entry.timer);
        this.#grace.delete(path);
        if (event === 'unlink') {
          // Pure delete inside grace — no sync of the intermediate, no new
          // stability vigil.  Skip pendingPaths add for this event so the
          // unlink doesn't itself trigger a vigil that would re-discover the
          // missing file and decide 'deleted' (harmless but noisy).
          this.#emitGraceDecisionForTest({ absPath: path, decision: 'dropped' });
          // Still arm the debounce so any OTHER pendingPaths get processed.
          this.#armDebounce();
          return;
        }
        // Edit / re-add inside grace → fall through to the normal vigil
        // restart so the latest content settles + grace re-arms.
        this.#emitGraceDecisionForTest({ absPath: path, decision: 'restarted' });
      }
      this.#pendingPaths.add(path);
    } else {
      this.#pendingPollRun = true;
    }
    this.#armDebounce();
  }

  #armDebounce() {
    if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null;
      if (!this.#running) return;
      this.#onDebounceFire();
    }, this.#debounceMs);
    if (typeof this.#debounceTimer.unref === 'function') this.#debounceTimer.unref();
  }

  /**
   * The 500ms debounce just elapsed.  Drain `#pendingPaths` into per-path
   * stability vigils.  When all vigils settle (or the maxWait cap fires),
   * a single `runOnce()` is dispatched.  A path-less `pendingPollRun` short-
   * circuits the vigils — runOnce fires immediately and pending vigils are
   * cancelled.
   */
  #onDebounceFire() {
    // Poll tick subsumes pending per-path waits.
    if (this.#pendingPollRun) {
      this.#pendingPollRun = false;
      // Cancel any in-flight stability vigils — runOnce is about to cover them.
      for (const entry of this.#stability.values()) {
        if (entry.timer) clearTimeout(entry.timer);
      }
      this.#stability.clear();
      // Folio v2.10 — also drop in-flight grace timers; the imminent runOnce
      // covers their pending paths.
      for (const entry of this.#grace.values()) {
        if (entry.timer) clearTimeout(entry.timer);
      }
      this.#grace.clear();
      this.#pendingPaths.clear();
      this.#fireRunOnce('scheduled');
      return;
    }
    if (this.#pendingPaths.size === 0) {
      // Nothing to do — likely a stop() between the schedule and fire.
      return;
    }
    const paths = [...this.#pendingPaths];
    this.#pendingPaths.clear();
    // Each path runs its own stability vigil; the first one to "decide" that
    // produces a need-to-run schedules a single shared runOnce.  We don't
    // batch by waiting for ALL paths — each settled path is an independent
    // signal that "something is now stable enough to sync", so we fire on
    // each.  runOnce serializes via #runChain, so even rapid-fire decisions
    // don't double-run real work.
    for (const p of paths) {
      this.#startStabilityVigil(p);
    }
  }

  /**
   * Begin (or restart) the sha-stability vigil for `absPath`.
   *
   * Phase A (this method): hash now, store the sha as the "candidate", and
   * arm a timer for `stableMs`.  When the timer fires we re-hash and
   * compare (Phase B).  ENOENT clears the entry without firing runOnce
   * (file was deleted before we got there).
   */
  #startStabilityVigil(absPath) {
    if (!this.#running) return;
    // Cancel any in-flight vigil for this path; we restart fresh.
    const prior = this.#stability.get(absPath);
    if (prior?.timer) clearTimeout(prior.timer);

    const firstSeenAt = prior?.firstSeenAt ?? Date.now();

    // Hash now (best-effort).  We tolerate ENOENT: a deleted-while-pending
    // file simply drops the entry.
    const hashAndArm = async () => {
      let sha;
      try {
        sha = await this.#sha256OfFile(absPath);
      } catch (err) {
        // Unexpected I/O failure — surface and bail without firing.
        this.emit('error', { phase: 'watcher-stability', absPath, err });
        this.#stability.delete(absPath);
        this.#emitStabilityDecisionForTest({ absPath, decision: 'error' });
        return;
      }
      if (sha === null) {
        // ENOENT — file vanished.  Drop the tracker; do NOT fire runOnce.
        this.#stability.delete(absPath);
        this.#emitStabilityDecisionForTest({ absPath, decision: 'deleted' });
        return;
      }
      const entry = this.#stability.get(absPath) ?? { firstSeenAt, lastSha: null, timer: null };
      entry.firstSeenAt = firstSeenAt;
      entry.lastSha = sha;
      const elapsed = Date.now() - firstSeenAt;
      // Cap on total wait — fire even if not yet stable, but warn loudly.
      if (elapsed >= this.#maxStableWaitMs) {
        this.#stability.delete(absPath);
        this.emit('warning', { phase: 'unstable-write', absPath, elapsedMs: elapsed });
        this.#emitStabilityDecisionForTest({ absPath, decision: 'capped' });
        this.#fireRunOnce('scheduled');
        return;
      }
      // Arm the next pass.  When it fires we'll re-hash and compare.
      entry.timer = setTimeout(() => { void this.#stabilityRecheck(absPath); }, this.#stableMs);
      if (typeof entry.timer.unref === 'function') entry.timer.unref();
      this.#stability.set(absPath, entry);
    };
    void hashAndArm();
  }

  async #stabilityRecheck(absPath) {
    if (!this.#running) return;
    const entry = this.#stability.get(absPath);
    if (!entry) return; // dropped (deleted, or stop()).
    let sha;
    try {
      sha = await this.#sha256OfFile(absPath);
    } catch (err) {
      this.emit('error', { phase: 'watcher-stability', absPath, err });
      this.#stability.delete(absPath);
      this.#emitStabilityDecisionForTest({ absPath, decision: 'error' });
      return;
    }
    if (sha === null) {
      // File was deleted during the vigil.  Drop the tracker — no runOnce
      // for the deletion path; chokidar's unlink event would itself fire a
      // poll-style scheduleRun if it mattered.
      this.#stability.delete(absPath);
      this.#emitStabilityDecisionForTest({ absPath, decision: 'deleted' });
      return;
    }
    if (sha === entry.lastSha) {
      // STABLE — content has not changed across a `stableMs` window.
      // Folio v2.10: do NOT fire runOnce yet.  Hand the path off to the
      // grace tracker; runOnce fires only after `graceMs` elapses without
      // a delete/rename arriving for this path.
      this.#stability.delete(absPath);
      this.#emitStabilityDecisionForTest({ absPath, decision: 'stable', sha });
      this.#armGrace(absPath);
      return;
    }
    // UNSTABLE — content changed.  Restart the vigil with the new sha
    // (firstSeenAt remains the same so maxStableWaitMs is global).
    const elapsed = Date.now() - entry.firstSeenAt;
    if (elapsed >= this.#maxStableWaitMs) {
      this.#stability.delete(absPath);
      this.emit('warning', { phase: 'unstable-write', absPath, elapsedMs: elapsed });
      this.#emitStabilityDecisionForTest({ absPath, decision: 'capped' });
      this.#fireRunOnce('scheduled');
      return;
    }
    entry.lastSha = sha;
    entry.timer = setTimeout(() => { void this.#stabilityRecheck(absPath); }, this.#stableMs);
    if (typeof entry.timer.unref === 'function') entry.timer.unref();
    this.#stability.set(absPath, entry);
    this.#emitStabilityDecisionForTest({ absPath, decision: 'changed', sha });
  }

  /**
   * Folio v2.10 — arm the grace timer for `absPath`.
   *
   * After v2.6's sha-stable check has passed, we wait `graceMs` before
   * firing `runOnce()`.  If the path is unlinked (delete or rename) within
   * that window, `#scheduleRun` clears the grace entry and we never sync
   * the intermediate.  If the timer elapses untouched, we fire `runOnce()`
   * exactly as v2.6 did.
   *
   * `graceMs: 0` disables grace entirely — fire immediately.
   */
  #armGrace(absPath) {
    if (!this.#running) return;
    if (this.#graceMs <= 0) {
      // Grace disabled — preserve v2.6 behaviour (fire as soon as stable).
      this.#fireRunOnce('scheduled');
      return;
    }
    // Cancel any prior grace for this path (defensive — should be cleared
    // by `#scheduleRun` already).
    const prior = this.#grace.get(absPath);
    if (prior?.timer) clearTimeout(prior.timer);

    const entry = { armedAt: Date.now(), timer: null };
    entry.timer = setTimeout(() => {
      // Grace elapsed untouched — fire runOnce.
      if (!this.#running) {
        this.#grace.delete(absPath);
        return;
      }
      // Re-check membership: stop()/_disarm could have cleared us.
      if (!this.#grace.has(absPath)) return;
      this.#grace.delete(absPath);
      this.#emitGraceDecisionForTest({ absPath, decision: 'fired' });
      this.#fireRunOnce('scheduled');
    }, this.#graceMs);
    if (typeof entry.timer.unref === 'function') entry.timer.unref();
    this.#grace.set(absPath, entry);
    this.#emitGraceDecisionForTest({ absPath, decision: 'armed' });
  }

  /**
   * Hash a file.  Returns the hex sha256 string, or `null` if the file does
   * not exist (ENOENT).  Other errors propagate.
   */
  async #sha256OfFile(absPath) {
    let buf;
    try {
      buf = await this.#fs.readFile(absPath);
    } catch (err) {
      if (err && err.code === 'ENOENT') return null;
      throw err;
    }
    return this.#hash.sha256(buf);
  }

  /** Internal: actually dispatch a runOnce, forwarding errors to `error` events. */
  #fireRunOnce(phase) {
    if (!this.#running) return;
    this.runOnce().catch((err) => this.emit('error', { phase, err }));
  }

  /**
   * Test-only spy hook.  Receives `{ absPath, decision, sha? }` after each
   * stability decision (`stable`, `changed`, `deleted`, `capped`, `error`).
   * Production code never reads this; it's `null` unless tests installed it.
   */
  _onStabilityDecision(fn) {
    this.#onStabilityDecisionForTest = typeof fn === 'function' ? fn : null;
  }

  /**
   * Test-only spy hook (Folio v2.10).  Receives `{ absPath, decision }`
   * after each grace-window decision: `armed`, `fired`, `dropped`,
   * `restarted`.  Production code never reads this.
   */
  _onGraceDecision(fn) {
    this.#onGraceDecisionForTest = typeof fn === 'function' ? fn : null;
  }

  /**
   * Test-only — clear all pending grace timers (mirrors `_disarmForTest`'s
   * stability cleanup but isolated).  Useful for tests that want to
   * inspect grace state then teardown without touching `#running`.
   */
  _disarmForGraceTest() {
    for (const entry of this.#grace.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.#grace.clear();
  }

  /**
   * Test-only entry point — feed a synthetic chokidar event without standing
   * up a real watcher.  Equivalent to what `start()`'s `'all'` handler does.
   * Requires `start()` to have been called (so `#running` is true) — tests
   * can also flip `#running` via `_armForStabilityTest()`.
   *
   * @param {string} absPath  absolute path
   * @param {string} [event]  chokidar event name (default 'change')
   */
  _injectWatchEventForTest(absPath, event = 'change') {
    this.#scheduleRun(absPath, event);
  }

  /**
   * Test-only — flip `#running` true without starting a real watcher / poll
   * timer / initial runOnce.  Use this when you want to exercise the
   * stability path in isolation.  Pair with `_disarmForTest()` (or `stop()`).
   */
  _armForStabilityTest() {
    this.#running = true;
  }

  _disarmForTest() {
    this.#running = false;
    if (this.#debounceTimer) { clearTimeout(this.#debounceTimer); this.#debounceTimer = null; }
    for (const entry of this.#stability.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.#stability.clear();
    // Folio v2.10 — drop any pending grace timers.
    for (const entry of this.#grace.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.#grace.clear();
    this.#pendingPaths.clear();
    this.#pendingPollRun = false;
  }

  #emitStabilityDecisionForTest(payload) {
    if (this.#onStabilityDecisionForTest) {
      try { this.#onStabilityDecisionForTest(payload); } catch { /* swallow */ }
    }
  }

  #emitGraceDecisionForTest(payload) {
    if (this.#onGraceDecisionForTest) {
      try { this.#onGraceDecisionForTest(payload); } catch { /* swallow */ }
    }
  }

  async #loadState() {
    if (this.#stateLoaded) return;
    try {
      const raw = await this.#fs.readFileText(this.#stateFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.#knownState = parsed?.files ?? {};
    } catch (err) {
      if (err.code !== 'ENOENT') {
        this.emit('error', { phase: 'load-state', err });
      }
      this.#knownState = {};
    }
    this.#stateLoaded = true;
  }

  async #saveState() {
    const dir = dirnamePosix(this.#stateFilePath);
    await this.#fs.mkdir(dir, { recursive: true });
    const tmp = `${this.#stateFilePath}.tmp`;
    const payload = JSON.stringify({
      version: 1,
      writtenAt: Date.now(),
      files: this.#knownState,
    }, null, 2);
    await this.#fs.writeFile(tmp, payload, { encoding: 'utf8' });
    await this.#fs.rename(tmp, this.#stateFilePath);
  }
}

function guessContentType(relPath) {
  const p = String(relPath ?? '').toLowerCase();
  if (p.endsWith('.md') || p.endsWith('.markdown')) return 'text/markdown';
  if (p.endsWith('.txt')) return 'text/plain';
  if (p.endsWith('.json')) return 'application/json';
  if (p.endsWith('.html') || p.endsWith('.htm')) return 'text/html';
  if (p.endsWith('.css')) return 'text/css';
  return 'application/octet-stream';
}

/**
 * Return the chain of parent containers (closest-first) for a resource URI,
 * stopping at — and including — `podRoot`.  e.g. for
 *   resource = https://pod/notes/recipes/cake.md
 *   podRoot  = https://pod/notes/
 * yields ['https://pod/notes/recipes/', 'https://pod/notes/'] (closest first
 * so callers create the deepest container last; LDP servers handle this
 * order fine since `createContainerAt` is idempotent).
 *
 * Returns just `[podRoot]` when the resource sits directly under the root.
 * Always trailing-slashed.
 */
function parentContainersOf(resourceUri, podRoot) {
  const root = podRoot.endsWith('/') ? podRoot : `${podRoot}/`;
  if (!resourceUri.startsWith(root)) return [root];
  const tail = resourceUri.slice(root.length);
  const segs = tail.split('/').filter(Boolean);
  segs.pop(); // drop the file name
  const out = [];
  let cursor = root;
  for (const seg of segs) {
    cursor = `${cursor}${seg}/`;
    out.unshift(cursor); // closest-to-resource first
  }
  out.push(root); // and the root itself last
  return out;
}
