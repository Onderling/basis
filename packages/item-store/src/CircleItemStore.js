/**
 * CircleItemStore — a generic, per-circle, TYPE-INDEXED item store (cluster L · L1, the keystone).
 *
 * The data half of the dissolve: storage is keyed by **circle (scope) + data-type**, NOT by app-origin.
 * One store per circle (the `rootContainer` is the circle's routed pod path — `PodRouting` already keys the
 * pod by `circleId ≡ circleId`). Items are typed (`{id, type, …}`) and validated against the injected registry
 * (`@onderling/item-types`) on write. So ANY function over the registry's types can read/write here, and
 * `app-origin` is demoted to a capability/provenance TAG, not the storage key.
 *
 * Deliberately MINIMAL + generic: pure typed CRUD + a `type` index. Type-specific lifecycle (a task's
 * claim/submit/approve, a list's ordering, …) lives in FUNCTIONS over this store — NOT baked in here (that
 * coupling is exactly what the per-app `ItemStore` had, and what dissolve unwinds). Cross-peer propagation
 * (decentralised tier) + sealing are layered by the substrate (PodRouting + the SealedPodClient DataSource),
 * NOT this class — `dataSource` is injected, so a sealed/pod-backed source plugs in transparently.
 *
 * Isolation is preserved WITHOUT app-keyed storage: the per-circle SEAL + the capability boundary (cluster B)
 * gate access, so mixing apps' typed items in one circle store loses nothing. (See REMAINING-WORK.md cluster L.)
 *
 * @example
 *   const store = new CircleItemStore({ dataSource, rootContainer, registry });
 *   await store.put({ type: 'task', text: 'fix the tap' });   // validated, id assigned
 *   await store.listByType('task');                            // the type index
 */
import { ulid } from './ulid.js';
import { causalWinner, reconcileClaim, applyClaimOverlay, claimClusterEqual } from './causalMerge.js';

const ITEMS_DIR = 'items';

/**
 * Generic, per-circle, type-indexed item store over an injected `core.DataSource`: typed
 * `put` / `get` / `delete` / `list` / `listByType`, optional schema validation via an injected
 * item-types registry, causal inbound merge (`put` with `origin: true`), and an optional
 * publish-on-write sync hook (`setSyncHook`). Type-specific lifecycle lives in functions over this
 * store, not in the class. See the module doc for the design rationale.
 */
export class CircleItemStore {
  /** @type {import('@onderling/core').DataSource} */ #source;
  /** @type {string} */                            #root;
  /** @type {((item:object)=>{ok:boolean,errors?:Array})|null} */ #validate;
  /** @type {{publishItem?:(item:object)=>any, publishItemRemoved?:(id:string)=>any}|null} */ #syncHook = null;

  /**
   * @param {object} args
   * @param {import('@onderling/core').DataSource} args.dataSource  read/write/delete/list (routed to the circle's pod)
   * @param {string} args.rootContainer  the circle's store root (e.g. a PodRouting-resolved `…/<circleId>/`)
   * @param {{ validate?: (item:object)=>{ok:boolean,errors?:Array} }} [args.registry]  @onderling/item-types registry;
   *        when present, `put` rejects items that fail `validate`. Injected (no hard dep) — pass a fresh
   *        `createRegistry()` (with any third-party `registerType`d schemas) or the default canonical one.
   */
  constructor({ dataSource, rootContainer, registry } = {}) {
    if (!dataSource || typeof dataSource.read !== 'function' || typeof dataSource.write !== 'function') {
      throw new Error('CircleItemStore: dataSource (core.DataSource: read/write/delete/list) required');
    }
    if (typeof rootContainer !== 'string' || !rootContainer) {
      throw new Error('CircleItemStore: rootContainer required');
    }
    this.#source   = dataSource;
    this.#root     = rootContainer.endsWith('/') ? rootContainer : `${rootContainer}/`;
    this.#validate = registry && typeof registry.validate === 'function' ? registry.validate : null;
  }

  #uri(id) { return `${this.#root}${ITEMS_DIR}/${id}.json`; }

  /**
   * Register a SYNC HOOK — fired publish-on-write (cluster L3 / no-pod-sync-off-household). On every `put` the
   * stored item is handed to `publishItem`; on every `delete`, the id to `publishItemRemoved`. This is the seam
   * the household `InMemoryStore` had (`setSyncHook`) that let a peer mirror fan-out writes — now generic on the
   * per-circle store, so the no-pod cross-device sync can ride the CircleItemStore independent of the household
   * agent. Best-effort + non-blocking: a hook throw/rejection never fails the write. Pass `null` to detach.
   * @param {{publishItem?:(item:object)=>any, publishItemRemoved?:(id:string)=>any}|null} hook
   */
  setSyncHook(hook) { this.#syncHook = (hook && typeof hook === 'object') ? hook : null; }

  #emitWrite(item) {
    const fn = this.#syncHook && this.#syncHook.publishItem;
    if (typeof fn !== 'function') return;
    try { const r = fn(item); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch { /* best-effort */ }
  }

  #emitRemove(id) {
    const fn = this.#syncHook && this.#syncHook.publishItemRemoved;
    if (typeof fn !== 'function') return;
    try { const r = fn(id); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch { /* best-effort */ }
  }

  /**
   * Create or replace a typed item. Requires `item.type` (validated against the registry when one is
   * injected); assigns a ULID `id` when absent. Returns the stored item (with its `id`).
   *
   * `origin:true` — INBOUND CAUSAL INGEST (Objective L). Used by the sync inbound path for a peer's item so the
   * merge resolves by CAUSAL order, not arrival order:
   *   1. Origin metadata is PRESERVED, not re-stamped: `updatedAt`/`updatedBy` keep the payload's values (the
   *      origin's write clock + writer id) instead of being overwritten with the local ingest time — so the
   *      causal relationship survives transport. (Payload lacking them falls back to the local `ts`.)
   *   2. Before writing, the stored copy is compared via `causalWinner`: a causally-OLDER inbound item does NOT
   *      overwrite a newer local edit (it returns the existing item, no write, no fan-out); a causally-newer
   *      inbound wins; true concurrency resolves by a deterministic writer-id tiebreak. See `causalMerge.js`
   *      for the guarantees/limits (item-level last-writer-wins, not a field merge). Payloads with no parseable
   *      `updatedAt` fall back to last-received-wins, so pre-metadata peers still ingest (backward-compatible).
   * Default `origin:false` keeps today's behaviour: `updatedAt` is always the local write time.
   */
  async put(item, { by, now, sync = true, origin = false } = {}) {
    if (!item || typeof item !== 'object') throw new Error('CircleItemStore.put: an item object is required');
    if (typeof item.type !== 'string' || !item.type) throw new Error('CircleItemStore.put: item.type is required');
    const id = (typeof item.id === 'string' && item.id) ? item.id : ulid();
    // Stamp the base metadata (BASE_REQUIRED: type·id·createdAt·createdBy) so every item is well-formed +
    // validates against strict canonical schemas. createdAt/createdBy are PRESERVED on replace. For a LOCAL
    // write updatedAt is always the write time; for an `origin` (inbound) write it PRESERVES the payload's
    // origin clock/writer so causal order can be recovered (falls back to `ts` when the payload omits them).
    // `by` (the actor) is injectable; `now` (an ISO-string clock) for deterministic tests.
    const ts = (typeof now === 'function' ? now() : now) ?? new Date().toISOString();
    const stored = {
      ...item,
      id,
      createdAt: item.createdAt ?? ts,
      createdBy: item.createdBy ?? by ?? 'unknown',
      updatedAt: origin ? (item.updatedAt ?? ts) : ts,
      updatedBy: origin ? (item.updatedBy ?? by ?? item.createdBy ?? 'unknown') : (by ?? item.createdBy ?? 'unknown'),
    };
    if (this.#validate) {
      const res = this.#validate(stored);
      if (res && res.ok === false) {
        const msg = (res.errors || []).map((e) => e?.message || JSON.stringify(e)).join('; ');
        throw new Error(`CircleItemStore.put: invalid "${stored.type}": ${msg || 'unknown type / schema error'}`);
      }
    }
    if (origin) {
      // Causal guard: keep the causally-newer side for CONTENT. Compare against the RAW payload (its real origin
      // clock) so a payload without `updatedAt` correctly falls back to last-received-wins rather than tying on
      // the fallback `ts`.
      const existing = await this.get(id);
      if (existing) {
        const keepLocalContent = causalWinner(existing, item) === 'local';
        // The CLAIM cluster resolves on its OWN immutable-once-set rule (first-come wins), independent of the
        // content LWW — otherwise the causally-LATER claimant would win, the opposite of first-come. See
        // `reconcileClaim`. Non-task items carry no claim → overlay is null → pure content LWW as before.
        const overlay = reconcileClaim(existing, item);
        if (keepLocalContent) {
          // Content stays local; but a CONTENDED claim may still have to change hands even though the content
          // is older. Resolve just the claim cluster onto the local copy.
          if (!overlay) return existing;                                   // no claim anywhere → drop stale inbound
          const merged = applyClaimOverlay(existing, overlay);
          if (claimClusterEqual(existing, merged)) return existing;        // local claim already won → no churn
          await this.#source.write(this.#uri(id), JSON.stringify(merged));
          if (sync !== false) this.#emitWrite(merged);
          return merged;
        }
        // Content winner is the inbound item; overlay the WINNING claim (which may be the LOCAL one — first-come)
        // onto it so a causally-newer content edit cannot drop an earlier claim.
        if (overlay) {
          const merged = applyClaimOverlay(stored, overlay);
          await this.#source.write(this.#uri(id), JSON.stringify(merged));
          if (sync !== false) this.#emitWrite(merged);
          return merged;
        }
        // no claim on either side → fall through to write the plain content winner (`stored`)
      }
    }
    await this.#source.write(this.#uri(id), JSON.stringify(stored));
    // `sync:false` suppresses the fan-out — used for INBOUND writes (a peer's item we just received) so a sync
    // ingest never re-publishes the same item back to the mesh (the echo loop). Local writes default sync:true.
    if (sync !== false) this.#emitWrite(stored);
    return stored;
  }

  /**
   * CAS (compare-and-set) AUTHORITATIVE write — the single-writer path for
   * ops that must be winner-take-all (claim / reassign / approve), distinct
   * from `put`'s causal/CRDT path.
   *
   * **Authoritative single-writer ops (claim/reassign/approve) use CAS;
   * replicated content uses `put()`'s causal path.** `put` resolves
   * concurrent writes with `causalWinner` (last-causally-newer-wins): correct
   * for mesh content, but NOT winner-take-all — two peers can each "win" and
   * the store converges. Claiming a task is winner-take-all: exactly ONE
   * writer may succeed. This method gives that guarantee by threading an
   * `If-Match: <etag>` precondition, so a racing second writer is REJECTED
   * (surfaced as a conflict) rather than silently merged. It does NOT touch
   * the causal path — it is an ADDITIONAL authoritative-write path.
   *
   * Mechanism — mirrors `ItemStore.#casWriteOrConflict` (both wrap the SAME
   * `core.DataSource`, and etag support is DataSource-level):
   *   1. Resolve the base etag: `expectedEtag` when the caller passes the etag
   *      it read (the genuine race — both racers share one base), else
   *      `readEtag(uri)` (duck-typed via `typeof src.readEtag === 'function'`).
   *   2. `write(uri, data, { ifMatch: baseEtag })` — a `null`/absent base
   *      (a fresh item with no prior version) writes unconditionally.
   *   3. A precondition failure (`err.code === 'CONFLICT'` / HTTP 409 / 412)
   *      → re-read the winner and RETURN `{ error:'conflict', current }`
   *      (never thrown), mirroring ItemStore's `{ error, current }` conflict
   *      shape. Lifecycle verbs map this to their own tag (claim →
   *      `'already-claimed'`). Any other error propagates.
   *
   * **FALLBACK — non-CAS DataSource** (`readEtag` absent, e.g. `MemorySource`):
   * a plain guarded write with a documented WEAKER guarantee — last-write-wins
   * with no cross-process race protection. A single-process / synchronous
   * source still serialises awaited calls (a second in-process write sees the
   * first), so a caller that needs the conflict surfaced on a non-CAS source
   * must read-check first before calling (as `ItemStore.claim` does).
   *
   * @param {object} item  a fully-formed typed item (needs `type`; `id` assigned if absent)
   * @param {object} [opts]
   * @param {string} [opts.expectedEtag]  base etag the caller read; overrides `readEtag`
   * @param {string} [opts.by]            actor id (stamped onto `updatedBy`)
   * @param {string|(()=>string)} [opts.now]  ISO clock (deterministic tests)
   * @param {boolean} [opts.sync=true]    `false` = inbound write; suppress fan-out (matches `put`)
   * @returns {Promise<object | {error:'conflict', current: object|null}>}
   *   the stored item on success; the conflict result on a precondition failure.
   */
  async putIfMatch(item, { expectedEtag, by, now, sync = true } = {}) {
    if (!item || typeof item !== 'object') throw new Error('CircleItemStore.putIfMatch: an item object is required');
    if (typeof item.type !== 'string' || !item.type) throw new Error('CircleItemStore.putIfMatch: item.type is required');
    const id = (typeof item.id === 'string' && item.id) ? item.id : ulid();
    // Authoritative write: `updatedAt` is always the write time (no origin/causal
    // preservation — that is `put`'s job). createdAt/createdBy are PRESERVED.
    const ts = (typeof now === 'function' ? now() : now) ?? new Date().toISOString();
    const stored = {
      ...item,
      id,
      createdAt: item.createdAt ?? ts,
      createdBy: item.createdBy ?? by ?? 'unknown',
      updatedAt: ts,
      updatedBy: by ?? item.updatedBy ?? item.createdBy ?? 'unknown',
    };
    if (this.#validate) {
      const res = this.#validate(stored);
      if (res && res.ok === false) {
        const msg = (res.errors || []).map((e) => e?.message || JSON.stringify(e)).join('; ');
        throw new Error(`CircleItemStore.putIfMatch: invalid "${stored.type}": ${msg || 'unknown type / schema error'}`);
      }
    }
    const uri = this.#uri(id);
    const src = this.#source;
    // Resolve the base etag: caller-supplied wins (the genuine race); else read
    // it (CAS-capable sources only). A null/absent etag → unconditional write.
    let baseEtag = expectedEtag ?? null;
    if (baseEtag == null && typeof src.readEtag === 'function') {
      try { baseEtag = await src.readEtag(uri); } catch { baseEtag = null; }
    }
    try {
      await src.write(uri, JSON.stringify(stored), baseEtag != null ? { ifMatch: baseEtag } : undefined);
    } catch (err) {
      const conflict = err && (err.code === 'CONFLICT' || err.status === 409 || err.status === 412);
      if (conflict) return { error: 'conflict', current: await this.get(id) };
      throw err;
    }
    // Successful authoritative write fans out like `put` (unless it's inbound).
    if (sync !== false) this.#emitWrite(stored);
    return stored;
  }

  /** Read one item by id, or `null` if absent. */
  async get(id) {
    const raw = await this.#source.read(this.#uri(id));
    if (raw === null || raw === undefined) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }

  /** Delete one item by id (no-op if absent, mirroring DataSource.delete). */
  async delete(id, { sync = true } = {}) {
    if (typeof this.#source.delete === 'function') await this.#source.delete(this.#uri(id));
    if (sync !== false) this.#emitRemove(id);   // `sync:false` = inbound delete (don't re-publish the removal)
  }

  /** Every item in the circle (all types). */
  async list() {
    const keys = await this.#source.list(`${this.#root}${ITEMS_DIR}/`);
    const out = [];
    for (const k of (keys || [])) {
      const raw = await this.#source.read(k);
      if (raw === null || raw === undefined) continue;
      try { out.push(typeof raw === 'string' ? JSON.parse(raw) : raw); } catch { /* skip malformed */ }
    }
    return out;
  }

  /**
   * Items of a given canonical `type` — the type index ("all tasks in this circle", "all offers").
   * v0 filters on `list()`; a maintained per-type index (e.g. `byType/<type>/<id>` markers) is a later
   * optimisation once write volume warrants it.
   */
  async listByType(type) {
    const all = await this.list();
    return all.filter((it) => it && it.type === type);
  }
}
