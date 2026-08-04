/**
 * Store — the storage abstraction skills talk to.  jsdoc-only.
 *
 * Phase 1 ships `InMemoryStore` (Stream 1d).  Phase 2 swaps in
 * `HybridPodStore` — same interface; `HouseholdAgent`'s store ref
 * changes from one to the other in a single line.
 *
 * Skills should import nothing from `pods/` directly.  They only see
 * `Store`.  This keeps the agent's hot path platform-agnostic and
 * makes Phase 2's pod swap trivial.
 */

/**
 * @typedef {object} Store
 *
 * @property {(args: AddItemArgs) => Promise<import('../types.js').Item>} addItem
 *   Append a new item.  Store generates ULID, sets addedAt.  Returns
 *   the persisted Item.
 *
 * @property {(filter: ListFilter) => Promise<Array<import('../types.js').Item>>} listOpen
 *   Items not yet completed (`completedAt` absent).  Filterable by
 *   type and `since` (added-after-this-ms-epoch).
 *
 * @property {(itemId: string) => Promise<import('../types.js').Item>} markComplete
 *   Set `completedAt = Date.now()`.  Throws if itemId not found.
 *
 * @property {(itemId: string) => Promise<void>} remove
 *   Hard-delete (used sparingly — usually the user wants markComplete).
 *
 * @property {(itemId: string) => Promise<import('../types.js').Item|null>} getById
 *   Single-item read.  Null if not found.
 */

/**
 * @typedef {object} AddItemArgs
 * @property {import('../types.js').ItemType}  type
 * @property {string}                          text
 * @property {string}                          addedBy        webid
 * @property {import('../types.js').Source}    source
 * @property {number}                         [dueAt]
 */

/**
 * @typedef {object} ListFilter
 * @property {import('../types.js').ItemType}        [type]
 * @property {number}                                [since]
 */

// Empty export so this file is a real ES module.
export const __interface__ = true;
