/**
 * ⚠ DELETION-CANDIDATE (2026-08-08, §8c fork 4 — derived from principle 7 "one store per circle").
 *   Zero production consumers: `apps/basis/src/v2/circleSources.js` explicitly declined to wire it because
 *   standing it up would be a SECOND circle registry (a principle-7 defect). SUCCESSOR: the canonical `circle`
 *   item type read through `circleRoster` / `audience`. Kept (not deleted) per the "mark, don't delete" rule so
 *   its shape can still be learned from; retire when nothing references it.
 *
 * `createCirclesStore({ itemStore })` — CRUD over saved audiences.
 *
 * Backed by the canonical `circle` item type (registered in
 * `@onderling/item-types`).  The injected `itemStore` is duck-typed:
 * anything with the four methods below works.  We deliberately do
 * NOT depend on `@onderling/item-store`; consumers wire whichever store
 * they use.
 *
 *   itemStore.addItems(items, ctx)   → Promise<Item[]>
 *   itemStore.listOpen(filter)       → Promise<Item[]>
 *   itemStore.getById(id)            → Promise<Item | null>
 *   itemStore.update(id, patch, ctx) → Promise<Item>
 *
 * Substrate-compat note: `@onderling/item-store`'s `addItems` currently
 * requires a non-empty `text` field on every partial — so this store
 * sets `text: name` when writing circles.  This is a substrate-shape
 * quirk, not part of the circle's canonical schema, and is recorded
 * for the substrate-fix slice.
 */

/**
 * @typedef {object} Circle
 * @property {string} id
 * @property {'circle'} type
 * @property {string} name
 * @property {string[]} members
 * @property {Record<string, string[]>} [roles]
 */

/**
 * @typedef {object} ItemStoreLike
 * @property {(items: object[], ctx: object) => Promise<object[]>} addItems
 * @property {(filter?: object) => Promise<object[]>}              listOpen
 * @property {(id: string) => Promise<object | null>}              getById
 * @property {(id: string, patch: object, ctx: object) => Promise<object>} update
 */

const TYPE = 'circle';

/**
 * @param {{ itemStore: ItemStoreLike }} deps
 */
export function createCirclesStore({ itemStore }) {
  if (!itemStore) {
    throw new Error('createCirclesStore: itemStore required');
  }
  for (const m of ['addItems', 'listOpen', 'getById', 'update']) {
    if (typeof itemStore[m] !== 'function') {
      throw new Error(`createCirclesStore: itemStore.${m} must be a function`);
    }
  }

  return {
    /**
     * Create a new circle.  `members` defaults to [], `roles` to {}.
     * @returns {Promise<Circle>}
     */
    async create({ name, members = [], roles } = {}, ctx) {
      if (typeof name !== 'string' || name.trim() === '') {
        throw new TypeError('createCirclesStore.create: name (non-empty string) required');
      }
      const partial = {
        type:    TYPE,
        text:    name,           // item-store substrate-compat (see header)
        name,
        members: [...members],
        ...(roles ? { roles: { ...roles } } : {}),
      };
      const [persisted] = await itemStore.addItems([partial], ctx ?? {});
      return persisted;
    },

    /** Fetch one circle by id.  Returns null if absent OR if the item is not a circle. */
    async get(id) {
      const item = await itemStore.getById(id);
      if (!item || item.type !== TYPE) return null;
      return item;
    },

    /** List every circle the store has visibility on (read-side filtering = item-store's). */
    async list() {
      const items = await itemStore.listOpen({ type: TYPE });
      // Defensive: if the store ignores type filtering, filter here.
      return items.filter((it) => it.type === TYPE);
    },

    /**
     * Patch a circle's fields.  Use for name / roles changes; for
     * member roster manipulation prefer `addMember` / `removeMember`.
     */
    async update(id, patch, ctx) {
      assertExists(await itemStore.getById(id), id);
      const safe = { ...patch };
      // Mirror name → text so substrate compat survives renames.
      if (typeof safe.name === 'string') safe.text = safe.name;
      return itemStore.update(id, safe, ctx ?? {});
    },

    /** Add `webid` to a circle's members (no-op if already present). */
    async addMember(id, webid, ctx) {
      const circle = assertExists(await itemStore.getById(id), id);
      const members = Array.isArray(circle.members) ? circle.members : [];
      if (members.includes(webid)) return circle;
      return itemStore.update(id, { members: [...members, webid] }, ctx ?? {});
    },

    /** Remove `webid` from a circle's members (no-op if absent). */
    async removeMember(id, webid, ctx) {
      const circle = assertExists(await itemStore.getById(id), id);
      const members = Array.isArray(circle.members) ? circle.members : [];
      if (!members.includes(webid)) return circle;
      return itemStore.update(id, { members: members.filter((m) => m !== webid) }, ctx ?? {});
    },
  };
}

function assertExists(item, id) {
  if (!item)               throw new Error(`circle "${id}" not found`);
  if (item.type !== TYPE)  throw new Error(`item "${id}" is not a circle (type=${item.type})`);
  return item;
}
