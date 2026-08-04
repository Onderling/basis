/**
 * MemberPod — pod operations against a *single household member's* pod.
 *
 * Per Q-H2.6 + the routing table in `routingTable.js`, items that are
 * explicitly assigned to one member (errand / schedule with an `assignee`
 * set) live on **that member's** pod, with an `ItemRef` written to the
 * shared household pod so cross-member listings still work.  This
 * class is the wrapper the orchestrator uses for "the assignee's pod"
 * — one instance per member-pod the orchestrator touches.
 *
 * Storage layout (under `podRoot`, which is the member's pod root —
 * NOT scoped under `/household/`):
 *
 *   /private/errands.json     # array of Items (type === 'errand')
 *   /private/schedule.json    # array of Items (type === 'schedule')
 *
 * **Single file per type per member** — design choice locked here:
 *
 *   - The household agent reaches the member's pod via a capability
 *     token issued by the member.  That access path is *remote* and
 *     latency-sensitive: many small reads kill orchestrator listings.
 *   - The member also accesses their own pod directly (their own
 *     client, not the agent).  A single `errands.json` is trivial to
 *     inspect / hand-edit / back up.
 *   - Trade-off: every mutation rewrites the whole collection file.
 *     For v0 (a few dozen open items per member at most) that's
 *     cheaper than N round-trips per listing.  If a household ever
 *     accumulates thousands of personal items we revisit this — see
 *     `apps/household/docs/HYBRID-POD-NOTES.md` "Cross-pod listing
 *     latency".
 *
 * Concurrency: writes go through `PodClient.write` with the default
 * `'reject'` conflict policy.  If the member's own client is racing
 * with the agent the caller decides what to do (retry, surface, etc.).
 *
 * Path stability: `relPath` returned by `addItem` is the path *within*
 * `podRoot` (no leading slash, no host).  The orchestrator assembles
 * an `ItemRef` as `{ ownerPodRoot: this.podRoot, relPath, ... }`; a
 * later resolve is just `<ownerPodRoot><relPath>`.  Because the
 * collection file holds many items, `relPath` is the same for every
 * item of a given type — that's intentional: the ref points at the
 * file the item lives in, plus the item id for in-file lookup.
 *
 * @see apps/household/src/pods/routingTable.js
 * @see apps/household/src/pods/HouseholdPod.js — sister wrapper for
 *      the shared household pod.
 * @see apps/household/docs/HYBRID-POD-NOTES.md
 */

/**
 * @typedef {import('../types.js').Item}     Item
 * @typedef {import('../types.js').ItemType} ItemType
 */

/**
 * Type → collection-file mapping for the member pod.  Only the
 * "personal" types live here; `shopping` + `repair` are
 * household-scoped by the routing table and never land on a member
 * pod.  Frozen so a typo can't silently rewrite it.
 */
export const MEMBER_TYPE_TO_FILE = Object.freeze({
  errand:   'errands.json',
  schedule: 'schedule.json',
});

/** Collection file relPaths under the member's pod root.  Frozen. */
const MEMBER_RELPATHS = Object.freeze(
  Object.fromEntries(
    Object.entries(MEMBER_TYPE_TO_FILE).map(([type, file]) => [type, `private/${file}`]),
  ),
);

/** All collection relPaths (for "list all open" walks). */
const ALL_MEMBER_RELPATHS = Object.freeze(Object.values(MEMBER_RELPATHS));

/**
 * Detect a "resource not found" error from the pod-client.  Same shape
 * as BotPod's helper.
 * @param {unknown} err
 * @returns {boolean}
 */
function isNotFound(err) {
  return Boolean(err && typeof err === 'object' && /** @type {any} */ (err).code === 'NOT_FOUND');
}

export class MemberPod {
  /** @type {import('@onderling/pod-client').PodClient} */
  #pod;
  /** @type {string} */
  #root;
  /** @type {string} */
  #memberWebid;

  /**
   * @param {object} args
   * @param {import('@onderling/pod-client').PodClient} args.podClient
   *   Configured against the MEMBER's pod root + auth (typically a
   *   capability token the member issued to the household agent).
   * @param {string} args.podRoot       member's pod URL (with or without
   *                                    a trailing slash — normalised
   *                                    here)
   * @param {string} args.memberWebid   the member's webid; stored on
   *                                    every Item we write so audit
   *                                    trails carry the owner.
   */
  constructor({ podClient, podRoot, memberWebid } = {}) {
    if (!podClient)    throw new Error('MemberPod: podClient is required');
    if (!podRoot)      throw new Error('MemberPod: podRoot is required');
    if (!memberWebid)  throw new Error('MemberPod: memberWebid is required');
    this.#pod         = podClient;
    this.#root        = podRoot.endsWith('/') ? podRoot : `${podRoot}/`;
    this.#memberWebid = memberWebid;
  }

  /** Pod URL (with trailing slash). */
  get podRoot()     { return this.#root; }
  /** The member's webid. */
  get memberWebid() { return this.#memberWebid; }

  // ── path helpers ────────────────────────────────────────────────────

  /**
   * @param {ItemType} type
   * @returns {string} relPath under the pod root, no leading slash.
   */
  #relPathFor(type) {
    const rel = MEMBER_RELPATHS[type];
    if (!rel) throw new Error(`MemberPod: type '${type}' is not stored on member pods`);
    return rel;
  }

  /**
   * @param {ItemType} type
   * @returns {string} absolute pod URI for the collection file.
   */
  #uriFor(type) {
    return `${this.#root}${this.#relPathFor(type)}`;
  }

  /**
   * Read a collection file and return its array of Items.  Treats
   * missing-file as an empty collection.
   *
   * @param {ItemType} type
   * @returns {Promise<Array<Item>>}
   */
  async #readCollection(type) {
    const uri = this.#uriFor(type);
    try {
      const res = await this.#pod.read(uri, { decode: 'json' });
      return Array.isArray(res?.content) ? res.content : [];
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
  }

  /**
   * Write a collection file (array).
   *
   * @param {ItemType}      type
   * @param {Array<Item>}   items
   */
  async #writeCollection(type, items) {
    const uri = this.#uriFor(type);
    await this.#pod.write(uri, items, {
      contentType: 'application/json',
    });
  }

  // ── public API ──────────────────────────────────────────────────────

  /**
   * Add a personal item to the member's pod.  Mutates the relevant
   * collection file (errands.json / schedule.json) by reading,
   * appending, and rewriting.
   *
   * Returns the URI + relPath the orchestrator uses to build an
   * `ItemRef` on the household pod.
   *
   * @param {Item} item
   * @returns {Promise<{ uri: string, relPath: string }>}
   */
  async addItem(item) {
    if (!item || !item.id || !item.type) {
      throw new Error('MemberPod.addItem: item.id and item.type are required');
    }
    const type    = /** @type {ItemType} */ (item.type);
    const relPath = this.#relPathFor(type);
    const uri     = this.#uriFor(type);

    const existing = await this.#readCollection(type);
    // Defend against duplicate-id no-op writes (idempotent retry).
    const filtered = existing.filter((it) => it.id !== item.id);
    filtered.push(item);
    await this.#writeCollection(type, filtered);
    return { uri, relPath };
  }

  /**
   * List the member's *open* items (`completedAt` absent), optionally
   * filtered by type.  Walks errands.json + schedule.json (or just one
   * if `filter.type` is set) and merges.  Sorted by `addedAt` ASC; ties
   * broken by id (ULID) for determinism.
   *
   * @param {{ type?: ItemType }} [filter]
   * @returns {Promise<Array<Item>>}
   */
  async listOpen(filter = {}) {
    /** @type {Array<ItemType>} */
    const types = filter.type
      ? [/** @type {ItemType} */ (filter.type)]
      : /** @type {Array<ItemType>} */ (Object.keys(MEMBER_RELPATHS));

    /** @type {Array<Item>} */
    const out = [];
    for (const type of types) {
      const collection = await this.#readCollection(type);
      for (const it of collection) {
        if (it && (it.completedAt == null)) out.push(it);
      }
    }
    out.sort((a, b) => {
      const aT = a.addedAt ?? 0;
      const bT = b.addedAt ?? 0;
      if (aT !== bT) return aT - bT;
      return (a.id ?? '').localeCompare(b.id ?? '');
    });
    return out;
  }

  /**
   * Single-item read by id.  Searches every member-pod collection
   * (errands then schedule).  Returns `null` if not found.
   *
   * @param {string} itemId
   * @returns {Promise<Item|null>}
   */
  async getById(itemId) {
    if (!itemId) throw new Error('MemberPod.getById: itemId is required');
    for (const type of /** @type {Array<ItemType>} */ (Object.keys(MEMBER_RELPATHS))) {
      const collection = await this.#readCollection(type);
      const found = collection.find((it) => it && it.id === itemId);
      if (found) return found;
    }
    return null;
  }

  /**
   * Mark an item complete in-place: sets `completedAt = Date.now()`
   * but leaves the item in the collection file.  Member's own client
   * decides when to prune (e.g. archive monthly).
   *
   * Throws if the id is not found.
   *
   * @param {string} itemId
   * @returns {Promise<Item>} the updated item
   */
  async markComplete(itemId) {
    if (!itemId) throw new Error('MemberPod.markComplete: itemId is required');
    for (const type of /** @type {Array<ItemType>} */ (Object.keys(MEMBER_RELPATHS))) {
      const collection = await this.#readCollection(type);
      const idx = collection.findIndex((it) => it && it.id === itemId);
      if (idx < 0) continue;
      const completedAt = Date.now();
      const updated = { ...collection[idx], completedAt };
      const next = collection.slice();
      next[idx] = updated;
      await this.#writeCollection(type, next);
      return updated;
    }
    throw new Error(`MemberPod.markComplete: id not found: ${itemId}`);
  }

  /**
   * Hard-delete an item from the member's pod.  No-op (no throw) if
   * the id isn't present — deletes are idempotent by design (a retry
   * after a flaky network shouldn't fail).
   *
   * @param {string} itemId
   * @returns {Promise<void>}
   */
  async remove(itemId) {
    if (!itemId) throw new Error('MemberPod.remove: itemId is required');
    for (const type of /** @type {Array<ItemType>} */ (Object.keys(MEMBER_RELPATHS))) {
      const collection = await this.#readCollection(type);
      const idx = collection.findIndex((it) => it && it.id === itemId);
      if (idx < 0) continue;
      const next = collection.slice();
      next.splice(idx, 1);
      await this.#writeCollection(type, next);
      return;
    }
  }

  /**
   * The set of relPaths under the member's pod root that this wrapper
   * touches.  Exposed for tests + introspection.
   * @returns {ReadonlyArray<string>}
   */
  static get COLLECTION_RELPATHS() {
    return ALL_MEMBER_RELPATHS;
  }
}

export default MemberPod;
