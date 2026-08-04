/**
 * InMemoryStore — adapter over @onderling/item-store (L1b substrate).
 *
 * As of 2026-05-02 (Plan B sub-task B.1) the implementation is the
 * substrate's ItemStore + InMemoryBackend.  This file is a thin
 * adapter that exposes the legacy `{addItem, listOpen, markComplete,
 * remove, getById}` interface H2's existing skill handlers + tests
 * expect, translating into L1b's bulk + actor-context API.
 *
 * Why an adapter and not a direct port: keeps every existing import
 * site + test unchanged; the substrate is the source of truth.  Future
 * cleanup can update skill handlers to call L1b directly and retire
 * this adapter.
 *
 * Translation summary:
 *   - addItem(args)         → itemStore.addItems([args], {actor})
 *   - listOpen(filter)      → itemStore.listOpen(filter)
 *   - markComplete(id)      → itemStore.markComplete([{id}], {actor})
 *   - remove(id)            → itemStore.removeItems([{id}], {actor})
 *   - getById(id)           → itemStore.getById(id)
 *
 * Result shape: the substrate's rich task item is returned DIRECTLY — the
 * household `Item` shape IS the shared task shape (`assignee` for the owner,
 * `completedAt` absent while open). `publicItem()` below only takes a
 * defensive shallow copy and drops the substrate-internal `_etag`; it does
 * NOT rename or re-null any field, so there is one task shape, not two.
 *
 * The `ulid` export is preserved for any caller that imports it
 * directly (one test does); re-exported from L1b's ULID helper.
 */

import { CircleItemStore, createTaskStore } from '@onderling/item-store';
import { MemorySource } from '@onderling/core';
import { ulid as l1bUlid }             from '@onderling/item-store';

export const ulid = l1bUlid;

const SYSTEM_ACTOR = '__household-store__';

/**
 * Adapter — exposes L1b's ItemStore through H2's legacy Store
 * interface.
 *
 * OBJ-2 S1e — the constructor now accepts an optional injected
 * `dataSource`.  `new InMemoryStore()` (no args) is unchanged: it
 * builds a fresh `MemorySource` and is purely in-memory (lost on
 * reload).  `new InMemoryStore({ dataSource })` backs the underlying
 * ItemStore with the caller's DataSource — e.g. a
 * `@onderling/local-store` `CachingDataSource` wired to a persist adapter
 * (see `./persist.js`) — so household state survives a reload.
 *
 * @implements {import('./Store.js').Store}
 */
export class InMemoryStore {
  /** @type {ReturnType<typeof createTaskStore>} the ItemStore-compatible task surface over a CircleItemStore. */
  #store;
  /** @type {Map<string, number>}  itemId → insertion sequence */
  #insertionOrder = new Map();
  #seq = 0;
  /** @type {{publishItem?:Function, publishItemRemoved?:Function}|null} OBJ-2 S1d sync hook */
  #syncHook = null;

  /**
   * @param {object} [opts]
   * @param {import('@onderling/core').DataSource} [opts.dataSource]
   *   OBJ-2 S1e — optional injected DataSource (e.g. a persistent
   *   `CachingDataSource`).  Default: a fresh in-memory `MemorySource`
   *   (unchanged legacy behaviour — `new InMemoryStore()` still works).
   */
  constructor({ dataSource, rootContainer = 'mem://household/' } = {}) {
    // Per-circle scoping (no-pod): a distinct `rootContainer` per circle (e.g.
    // `mem://household/circles/<id>/`) partitions reads/writes — the store lists
    // by the root prefix, so one shared DataSource serves all circles without leaks.
    //
    // migration step 4 (2026-07-18, the FINAL ItemStore consumer): the store is
    // now the converged `CircleItemStore` (generic typed CRUD + causal/CAS writes),
    // with the task lifecycle/CRUD supplied by the ported functions-over-store and
    // exposed through `createTaskStore` — the thin ItemStore-compatible surface
    // (Emitter + audit + inbound-sync) this adapter's methods already speak. No
    // rolePolicy / enforceDependencies is threaded: household never built one (the
    // prior store was constructed with only `{dataSource, rootContainer}`), and createTaskStore's
    // gate treats a missing policy as allow — exact parity with the old class-based store.
    // No registry is injected either: household stores its own non-canonical types
    // (shopping/errand/repair/schedule), so validation-on-write stays off (parity).
    const circleStore = new CircleItemStore({
      dataSource:    dataSource ?? new MemorySource(),
      rootContainer,
    });
    this.#store = createTaskStore(circleStore);
  }

  /** the underlying @onderling/item-store task surface (addItems/applySync/removeSync/listOpen/listClosed) — used by the substrate mirror. */
  get substrate() { return this.#store; }

  /**
   * OBJ-2 (S1d) — publish-on-write. Register a sync hook so every LOCAL mutation
   * fans the RAW item out to the circle's peers. Best-effort + fire-and-forget;
   * a null hook (the default) is a no-op, so the store works standalone (CLI,
   * tests). The mirror writes back via `.substrate` directly (NOT these adapter
   * methods), so sync-originated writes never re-fire the hook — no echo loop.
   *
   * @param {{publishItem?:(rawItem:object)=>any, publishItemRemoved?:(itemId:string)=>any}|null} hook
   */
  setSyncHook(hook) { this.#syncHook = hook ?? null; }

  #emitWrite(rawItem) {
    if (!this.#syncHook?.publishItem || !rawItem?.id) return;
    try { const r = this.#syncHook.publishItem(rawItem); if (r?.catch) r.catch(() => {}); }
    catch { /* best-effort — local write is the source of truth */ }
  }

  #emitRemove(itemId) {
    if (!this.#syncHook?.publishItemRemoved || !itemId) return;
    try { const r = this.#syncHook.publishItemRemoved(itemId); if (r?.catch) r.catch(() => {}); }
    catch { /* best-effort */ }
  }

  /**
   * @param {import('./Store.js').AddItemArgs} args
   * @returns {Promise<import('../types.js').Item>}
   */
  async addItem({ type, text, addedBy, source, dueAt }) {
    const partial = {
      type,
      text,
      ...(source !== undefined ? { source } : {}),
      ...(dueAt  !== undefined ? { dueAt }  : {}),
    };
    const [item] = await this.#store.addItems([partial], {
      actor: addedBy ?? SYSTEM_ACTOR,
    });
    this.#insertionOrder.set(item.id, ++this.#seq);
    this.#emitWrite(item);                 // OBJ-2 S1d — fan out to peers
    return publicItem(item);
  }

  /**
   * @param {import('./Store.js').ListFilter} [filter]
   * @returns {Promise<Array<import('../types.js').Item>>}
   */
  async listOpen(filter) {
    const items = await this.#store.listOpen({
      ...(filter?.type  !== undefined ? { type:  filter.type  } : {}),
      ...(filter?.since !== undefined ? { since: filter.since } : {}),
    });
    // L1b returns newest-first; H2's legacy contract is insertion order
    // (oldest-first).  Sort by our own insertion-sequence counter —
    // ULID's random component within the same millisecond doesn't
    // preserve insertion order, so id-as-tiebreak is wrong.
    const order = this.#insertionOrder;
    return items
      .slice()
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .map((it) => publicItem(it));
  }

  /**
   * @param {string} itemId
   * @returns {Promise<import('../types.js').Item>}
   */
  async markComplete(itemId) {
    const [item] = await this.#store.markComplete(
      [{ id: itemId }],
      { actor: SYSTEM_ACTOR },
    );
    this.#emitWrite(item);                 // OBJ-2 S1d
    return publicItem(item);
  }

  /**
   * @param {string} itemId
   * @returns {Promise<void>}
   */
  async remove(itemId) {
    await this.#store.removeItems(
      [{ id: itemId }],
      { actor: SYSTEM_ACTOR },
    );
    this.#emitRemove(itemId);              // OBJ-2 S1d — fan out hard-delete
  }

  /**
   * claim a task (assignee:= actor). Returns the updated item, or — if
   * the item is already claimed by someone else — the L1b ItemStore's
   * `{error: 'already-claimed', current}` shape passed through.
   *
   * @param {string} itemId
   * @param {string} [actor]
   * @returns {Promise<import('../types.js').Item | {error: 'already-claimed', current: import('../types.js').Item}>}
   */
  async claim(itemId, actor) {
    const result = await this.#store.claim(itemId, { actor: actor ?? SYSTEM_ACTOR });
    if (result && result.error === 'already-claimed') {
      return { error: 'already-claimed', current: publicItem(result.current) };
    }
    this.#emitWrite(result);              // OBJ-2 S1d — fan out the claim
    return publicItem(result);
  }

  /**
   * reassign a task to a different webid.
   *
   * @param {string} itemId
   * @param {string} newAssignee   webid
   * @param {string} [actor]
   * @returns {Promise<import('../types.js').Item>}
   */
  async reassign(itemId, newAssignee, actor) {
    const item = await this.#store.reassign(
      itemId, newAssignee,
      { actor: actor ?? SYSTEM_ACTOR },
    );
    this.#emitWrite(item);                // OBJ-2 S1d — fan out the reassign
    return publicItem(item);
  }

  /**
   * @param {string} itemId
   * @returns {Promise<import('../types.js').Item|null>}
   */
  async getById(itemId) {
    const item = await this.#store.getById(itemId);
    return item ? publicItem(item) : null;
  }
}

/**
 * Return the substrate's rich task item as the household `Item`, taking a
 * defensive shallow copy (callers mutate results in tests) and dropping the
 * substrate-internal `_etag`. It renames nothing and re-nulls nothing: the
 * owner stays `assignee`, and `completedAt` stays absent while open — this is
 * the ONE task shape the app speaks, not a translation to a second one.
 *
 * @param {object} item
 * @returns {object}
 */
function publicItem(item) {
  if (!item) return item;
  const { _etag, ...rest } = item;
  void _etag;
  return rest;
}
