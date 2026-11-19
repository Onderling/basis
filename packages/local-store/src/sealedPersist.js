/**
 * sealedPersist — put the seal at the boundary between the cache and the disk.
 *
 * `CachingDataSource` keeps a Map of path → JSON-encoded item and persists it through an adapter
 * (`load() → Map`, `scheduleSave(map)`, `flush(map)`, …). Until now that adapter wrote the Map as it
 * stood, so a person's shopping list, tasks and posts reached a file, IndexedDB or AsyncStorage as plain
 * text — measured 2026-09-10, one item added through the real agent, the words readable in a hex dump.
 *
 * ── Why the seal goes HERE and not one layer up ─────────────────────────────────────────────────────
 * The tempting place was above the DataSource: wrap read/write, and every store is sealed at once. It is
 * wrong, and the reason is `CachingDataSource.query()` — it walks the cache and `JSON.parse`s each value
 * to filter on its fields. Feed that cache ciphertext and query silently matches nothing: no error, no
 * failed test, just a list that renders empty. Sealing at the cache boundary would have broken reading
 * while looking like it worked.
 *
 * So the split is deliberate and it is the one that matches the words "at rest": **the cache holds
 * plaintext, the disk holds ciphertext.** Nothing above this line changes behaviour — query still parses,
 * list still filters, the store is untouched — and nothing below it is readable without the key.
 *
 * KEYS ARE NOT SEALED. The Map's keys are paths (`mem://household/items/<id>`), and they stay legible
 * because every lookup is by key. Someone holding the raw file learns how many items exist and which
 * circle they belong to, never what any of them says. Hiding that is a different layout, not a different
 * cipher.
 *
 * NO MIGRATION. Frits, 2026-09-10: *"All data must be sealed, but from the start."* A value already on
 * disk in plain text opens as itself (the group-key `open` passes non-sealed text through by design), so
 * an existing install keeps reading what it has and seals from the next save onward. Nothing walks a live
 * store at boot, which is the one part of this that could have lost someone's things.
 */

/**
 * Wrap a persist adapter so what it writes is sealed and what it reads is opened.
 *
 * @param {{load:Function, save?:Function, scheduleSave?:Function, flush?:Function, cancel?:Function, close?:Function}} persist
 *   the adapter (FilePersist / IndexedDBPersist / AsyncStoragePersist — all share this surface).
 * @param {{seal:(t:string)=>string, open:(t:string)=>string}|null} strategy
 *   this device's content-seal strategy. `null` returns the adapter UNCHANGED — a host with no key
 *   behaves as it did rather than half-sealing.
 * @param {(msg:string, err?:unknown)=>void} [onWarn]  where an unopenable value is reported.
 * @returns the same adapter surface, sealing on the way out to storage.
 */
export function sealedPersist(persist, strategy, onWarn = null) {
  if (!persist || typeof persist.load !== 'function') {
    throw new Error('sealedPersist: a persist adapter with load() is required');
  }
  // No strategy — a host with no content key (a test, a composition that stores nothing sensitive):
  // the adapter is returned UNCHANGED rather than half-sealed. There is no opt-out; sealing is what
  // happens whenever a key exists.
  if (!strategy || typeof strategy.seal !== 'function' || typeof strategy.open !== 'function') return persist;
  const warn = typeof onWarn === 'function' ? onWarn : (m, e) => console.warn(m, e);

  /**
   * ONLY WHAT CHANGED IS SEALED AGAIN. Per key, the plain value last sealed (or opened at load) and its sealed form: an
   * unchanged value reuses that sealed form, a changed one is always sealed fresh. Before, every save sealed every row
   * of the whole map, so one changed item re-sealed the store, and the first save after a start re-sealed every row it
   * had just opened. Reusing a ciphertext for the SAME plaintext reveals nothing the disk did not already hold (it is
   * the bytes already there); a value that changed — even back to an earlier one — never gets an older ciphertext. The
   * memory holds what the store holds: a key gone from the map leaves it. In memory only; the plain side is the very
   * string the cache above already holds. It relies on the strategy sealing under ONE key for this wrapper's life:
   * true of every caller (each passes the device content-seal strategy, whose key is read once when it is built and
   * never rewritten in a session; a ceremony that re-keys reseals the vault HOLDING that key and ends in a reload).
   * A strategy whose key could change while the wrapper lives would need this memory dropped when it does.
   */
  const sealedOf = new Map();   // key → { plain, sealed }

  /** Every value sealed (reused when unchanged); keys untouched. */
  const sealMap = (map) => {
    const out = new Map();
    for (const [k, v] of map ?? []) {
      const plain = typeof v === 'string' ? v : JSON.stringify(v);
      const had = sealedOf.get(k);
      if (had && had.plain === plain) { out.set(k, had.sealed); continue; }
      const sealed = strategy.seal(plain);
      sealedOf.set(k, { plain, sealed });
      out.set(k, sealed);
    }
    if (sealedOf.size > out.size) for (const k of [...sealedOf.keys()]) if (!out.has(k)) sealedOf.delete(k);
    return out;
  };

  /**
   * Every value opened. A value that will not open is DROPPED rather than passed on as ciphertext:
   * the row would otherwise reach `query()`, fail to parse, and vanish anyway — but silently. Dropping
   * it here at least says so once, with its key. A value that was really sealed on disk is remembered with its
   * sealed form; one that was plain (written before sealing) is not, so the next save seals it.
   */
  const openMap = (map) => {
    const out = new Map();
    sealedOf.clear();
    for (const [k, v] of map ?? []) {
      const stored = typeof v === 'string' ? v : JSON.stringify(v);
      try {
        const plain = strategy.open(stored);
        out.set(k, plain);
        if (typeof plain === 'string' && plain !== stored) sealedOf.set(k, { plain, sealed: stored });
      }
      catch (err) { warn(`[at-rest] ${k}: stored here but not openable with this device's content key`, err); }
    }
    return out;
  };

  const passthrough = (name) => (typeof persist[name] === 'function'
    ? { [name]: (...a) => persist[name](...a) }
    : {});

  return {
    async load() { return openMap(await persist.load()); },
    ...(typeof persist.save         === 'function' ? { save:         (m) => persist.save(sealMap(m)) }         : {}),
    ...(typeof persist.scheduleSave === 'function' ? { scheduleSave: (m) => persist.scheduleSave(sealMap(m)) } : {}),
    ...(typeof persist.flush        === 'function' ? { flush:        (m) => persist.flush(sealMap(m)) }        : {}),
    ...passthrough('cancel'),
    ...passthrough('close'),
  };
}

export default sealedPersist;
