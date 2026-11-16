/**
 * The person's own store as ONE of their selves sees it (their own lists, `ownListsCall` in the agent): the rows that
 * self made, nothing else. DEFAULT-DENY: the view names the store methods it serves; every other method throws, so a
 * read added to the lists ops later cannot reach another self's rows (or the own agenda's) without a red here first.
 *
 *   reads   `get` (another self's row reads as absent) · `list` · `listByType` (filtered)
 *   writes  `put` · `delete`: refused on a row that exists and is not this self's; a new row is this self's (`by`)
 *
 * The five are what `makeListsOps` calls on its store (measured 2026-11-16 by running every lists op through a
 * recording proxy: delete, get, list, listByType, put).
 */

/** The error a refused or unlisted call throws (`code` names which). */
export class OwnViewRefused extends Error {
  constructor(code, detail = '') {
    super(`own store view: ${code}${detail ? ` (${detail})` : ''}`);
    this.name = 'OwnViewRefused';
    this.code = code;
  }
}

/** The store methods the view serves; any other throws `unlisted-method`. */
export const OWN_VIEW_METHODS = Object.freeze(['get', 'list', 'listByType', 'put', 'delete']);

/**
 * @param {object} store                    the person's own store
 * @param {(row: object) => boolean} mine   is this row this self's (and one the view may show)?
 * @returns {object} the view: the five methods, everything else refused
 */
export function ownStoreAsSelf(store, mine) {
  const seen = (row) => !!row && mine(row);
  const methods = {
    async get(id, ...rest) { const row = await store.get(id, ...rest); return seen(row) ? row : null; },
    async list(...a) { const rows = await store.list(...a); return Array.isArray(rows) ? rows.filter(seen) : rows; },
    async listByType(...a) { const rows = await store.listByType(...a); return Array.isArray(rows) ? rows.filter(seen) : rows; },
    async put(item, ...rest) {
      const id = item?.id ?? null;
      const there = id ? await store.get(id) : null;
      if (there && !seen(there)) throw new OwnViewRefused('not-this-self', 'put');
      return store.put(item, ...rest);
    },
    async delete(id, ...rest) {
      const there = id ? await store.get(id) : null;
      if (there && !seen(there)) throw new OwnViewRefused('not-this-self', 'delete');
      return store.delete(id, ...rest);
    },
  };
  // UNLISTED IS NOTHING: a store method outside the five throws by name; any other property (a data field that may hold
  // rows, a map, a cache, a symbol, `then`) reads as undefined, never the store's
  return new Proxy(methods, {
    get(target, prop) {
      if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
      if (typeof prop === 'string' && prop !== 'then' && typeof Reflect.get(store, prop, store) === 'function') {
        return () => { throw new OwnViewRefused('unlisted-method', prop); };
      }
      return undefined;
    },
  });
}
