/**
 * basis v2 — user-owned screens (Plan α.2.a · audit gap #7+#8 framing).
 *
 * The screens reframing the user described:
 *   "the stream should be actually just the circle of all circles.
 *    The user must be able to choose by itself how to separate/combine
 *    circles into one interface (which is now called a circle, but
 *    actually it should more be like a screen that combines/filters
 *    circles)"
 *
 * A Screen is a user-defined VIEW that pairs:
 *   - a circleFilter — which circles contribute data (null = all)
 *   - a block list  — the same {id, type, config} shape α.1a's Recipe uses;
 *                     reusable with the existing block helpers (addBlock,
 *                     moveBlock, etc).
 *
 * Examples:
 *   - "Stream"    → circleFilter: null, blocks: [{noticeboard}, {agenda}]
 *   - "My neighbourhood"  → circleFilter: ['neighbourhood-selwerd'], blocks: [{noticeboard, limit:10}]
 *   - "Mijn dingen" → circleFilter: null, blocks: [{taken, scope:'assigned-to-me'}]
 *                    (the new task block lands in α.4)
 *
 * Per-user storage (per):
 *   One ScreenBook per user; key `cc.userScreens` (NOT per-circle).
 *   Mirrors createCircleRecipeStore's injectable {load, save} shape so
 *   the host can swap localStorage → pod io later without changing
 *   any callers.
 *
 * The block helpers from `circleRecipe.js` (addBlock, removeBlock,
 * moveBlock, updateBlock) operate on anything with `.blocks`, so they
 * compose with Screen unchanged.  Reuse them via:
 *
 *   book = updateScreen(book, screenId, (s) => addBlock(s, 'noticeboard'));
 */

/* ─────────────────────────────────────────────────────────────────────── */
/* Constants + shapes                                                     */
/* ─────────────────────────────────────────────────────────────────────── */

/** Empty book — what a fresh user starts with (host can seed defaults). */
import { BLOCK_TYPES } from './circleRecipe.js';
import { localStorageObjectVersions } from '@onderling/kring-host/objectVersionsStorage';
import { pinsOf } from './plusPins.js';

export const EMPTY_SCREEN_BOOK = Object.freeze({ screens: [], activeId: null });

/** Sentinel for "all circles" in circleFilter (vs `[circleId, …]`). */
export const ALL_CIRCLES = null;

/* ─────────────────────────────────────────────────────────────────────── */
/* Single-screen helpers                                                  */
/* ─────────────────────────────────────────────────────────────────────── */

/** Build a fresh empty Screen with a generated id + optional name. */
export function emptyScreen(name = '', circleFilter = ALL_CIRCLES) {
  return {
    id:          freshScreenId(),
    name:        typeof name === 'string' ? name : '',
    circleFilter: normalizeCircleFilter(circleFilter),
    blocks:      [],
  };
}

/**
 * Coerce raw → canonical Screen.  Mints id when missing, normalises
 * blocks via the same predicate circleRecipe uses (forward-compat: an
 * unknown block type is dropped silently).  circleFilter = null means
 * "all circles"; an empty array also means all circles.
 */
export function normalizeScreen(raw) {
  if (!raw || typeof raw !== 'object') return emptyScreen('');
  return {
    id:          typeof raw.id   === 'string' && raw.id   ? raw.id   : freshScreenId(),
    name:        typeof raw.name === 'string'             ? raw.name : '',
    circleFilter: normalizeCircleFilter(raw.circleFilter),
    blocks:      normalizeBlocks(raw.blocks),
  };
}

/** Returns true when the screen's filter matches "all circles". */
export function isAllCircles(screen) {
  const f = screen?.circleFilter;
  return f == null || (Array.isArray(f) && f.length === 0);
}

/**
 * Resolve the effective list of circle ids for this screen.  When the
 * filter is "all", returns the supplied `allCircleIds`.  Caller
 * supplies the universe — keeps this helper pure.
 */
export function effectiveCircleIds(screen, allCircleIds = []) {
  if (isAllCircles(screen)) return [...allCircleIds];
  return [...screen.circleFilter];
}

/** Add a circle id to the filter (deduped); switches from null → [id]. */
export function addCircleToScreen(screen, circleId) {
  if (!screen || typeof circleId !== 'string' || !circleId) return normalizeScreen(screen);
  const cur = normalizeScreen(screen);
  const next = isAllCircles(cur) ? [] : [...cur.circleFilter];
  if (!next.includes(circleId)) next.push(circleId);
  return { ...cur, circleFilter: next };
}

/** Remove a circle id from the filter.  No-op if filter is `ALL_CIRCLES`. */
export function removeCircleFromScreen(screen, circleId) {
  if (!screen) return normalizeScreen(screen);
  const cur = normalizeScreen(screen);
  if (isAllCircles(cur)) return cur;
  return { ...cur, circleFilter: cur.circleFilter.filter((id) => id !== circleId) };
}

/** Switch the screen back to "all circles" (drops any explicit list). */
export function setAllCircles(screen) {
  if (!screen) return normalizeScreen(screen);
  const cur = normalizeScreen(screen);
  return { ...cur, circleFilter: ALL_CIRCLES };
}

/* ─────────────────────────────────────────────────────────────────────── */
/* ScreenBook helpers                                                     */
/* ─────────────────────────────────────────────────────────────────────── */

/** The book's persona set (the header switcher's ticks), carried as is: a non-empty list of self ids, or absent (= all). */
function personaSetOf(book) {
  const ids = Array.isArray(book?.personaSet) ? book.personaSet.filter((id) => typeof id === 'string' && id) : [];
  return ids.length ? { personaSet: ids } : {};
}

/** What the book carries beside its pages, kept across every page change: the persona set, and the pins ("Vastgezet",
 *  each an address only — plusPins.js). */
function carriedOf(book) {
  const pinned = pinsOf(book);
  return { ...personaSetOf(book), ...(pinned.length ? { pinned } : {}) };
}

export function normalizeScreenBook(raw) {
  if (!raw || typeof raw !== 'object') return { screens: [], activeId: null };
  const arr = Array.isArray(raw.screens) ? raw.screens : [];
  const screens = arr.map(normalizeScreen);
  let activeId = typeof raw.activeId === 'string' ? raw.activeId : null;
  if (activeId && !screens.some((s) => s.id === activeId)) activeId = null;
  if (!activeId && screens.length > 0) activeId = screens[0].id;
  const history = normalizeHistory(raw.history);
  return { screens, activeId, ...carriedOf(raw), ...(history ? { history } : {}) };
}

/** How many parent links the book keeps (the version store keeps 50 per series). */
const HISTORY_CAP = 50;
/**
 * The book's undo history: which kept version it stands at (`at`) and each version's parent — what an undo steps back
 * to. Carried in the book (not the versions: a version is a book without it), so an undo never depends on the device
 * log having been saved.
 */
function normalizeHistory(h) {
  if (!h || typeof h !== 'object') return null;
  const at = Number.isFinite(h.at) ? h.at : null;
  const parents = {};
  if (h.parents && typeof h.parents === 'object') {
    for (const [k, v] of Object.entries(h.parents)) if (Number.isFinite(Number(k)) && Number.isFinite(v)) parents[k] = v;
  }
  return { at, parents };
}
const withoutHistory = (book) => { const { history: _h, ...rest } = book ?? {}; return rest; };   // eslint-disable-line no-unused-vars
const capParents = (parents) => Object.fromEntries(Object.entries(parents).sort((a, b) => Number(b[0]) - Number(a[0])).slice(0, HISTORY_CAP));

export function addScreen(book, name = '', circleFilter = ALL_CIRCLES) {
  const cur = normalizeScreenBook(book);
  const screen = emptyScreen(name, circleFilter);
  const screens = [...cur.screens, screen];
  return { screens, activeId: cur.activeId ?? screen.id, ...carriedOf(cur) };
}

export function renameScreen(book, screenId, newName) {
  const cur = normalizeScreenBook(book);
  const name = typeof newName === 'string' ? newName : '';
  return { ...cur, screens: cur.screens.map((s) => (s.id === screenId ? { ...s, name } : s)) };
}

export function removeScreen(book, screenId) {
  const cur = normalizeScreenBook(book);
  const screens = cur.screens.filter((s) => s.id !== screenId);
  let activeId = cur.activeId;
  if (activeId === screenId) activeId = screens.length > 0 ? screens[0].id : null;
  return { screens, activeId, ...carriedOf(cur) };
}

export function setActiveScreen(book, screenId) {
  const cur = normalizeScreenBook(book);
  if (!cur.screens.some((s) => s.id === screenId)) return cur;
  return { ...cur, activeId: screenId };
}

export function getActiveScreen(book) {
  const cur = normalizeScreenBook(book);
  if (!cur.activeId) return null;
  return cur.screens.find((s) => s.id === cur.activeId) ?? null;
}

/**
 * Apply a mutator function to one screen in the book.  The mutator
 * receives the current Screen and returns a new one — use either the
 * single-screen helpers above OR the α.1 block helpers (addBlock,
 * moveBlock, …) since Screen and Recipe share the `.blocks` shape.
 */
export function updateScreen(book, screenId, mutator) {
  const cur = normalizeScreenBook(book);
  if (typeof mutator !== 'function') return cur;
  const idx = cur.screens.findIndex((s) => s.id === screenId);
  if (idx < 0) return cur;
  const screens = cur.screens.slice();
  screens[idx] = normalizeScreen(mutator(screens[idx]));
  return { ...cur, screens };
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Storage adapter                                                        */
/* ─────────────────────────────────────────────────────────────────────── */

/**
 * Per-user ScreenBook store.  ONE book per user (no per-circle key).
 * Injectable {load, save} so pod io can swap in later.
 *
 *   const store = createUserScreenStore({ io: localStorageScreenIo() });
 *   const book = await store.get();
 *   await store.update((cur) => addScreen(cur, 'Stream'));
 */
export function createUserScreenStore({ io = {}, versions = null } = {}) {
  const { load, save } = io;
  const hasVersions = Boolean(versions && typeof versions.capture === 'function' && typeof versions.list === 'function');
  const newestTs = async () => (hasVersions ? ((await versions.list(SCREEN_VERSIONS_KEY))[0]?.ts ?? null) : null);
  return {
    async get() {
      let raw = null;
      try { raw = typeof load === 'function' ? await load() : null; }
      catch { raw = null; }
      return normalizeScreenBook(raw);
    },
    async set(book) {
      const next = normalizeScreenBook(book);
      if (typeof save === 'function') await save(next);
      return next;
    },
    async update(mutator) {
      const cur = await this.get();
      const next = normalizeScreenBook(typeof mutator === 'function' ? mutator(cur) : mutator);
      if (typeof save === 'function') await save(next);
      return next;
    },
    /**
     * The same change, kept as a VERSION (the `versions` adapter the circle recipe, policy and rules stores take): the
     * book before is captured when it is not the newest yet, then the book after. Returns both versions' timestamps so
     * the change can be logged with what it replaced, and undone by restoring `previous`.
     * @returns {Promise<{book: object, previous: number|null, current: number|null}>}
     */
    async updateVersioned(mutator) {
      const cur = await this.get();
      const parents = { ...(cur.history?.parents ?? {}) };
      // where the book stands now: the version it was put at (by a change or an undo), else the book as it is, kept now
      let previous = cur.history?.at ?? null;
      if (previous == null && hasVersions) { await versions.capture(SCREEN_VERSIONS_KEY, withoutHistory(cur)); previous = await newestTs(); }
      const next = normalizeScreenBook(typeof mutator === 'function' ? mutator(withoutHistory(cur)) : mutator);
      let current = null;
      if (hasVersions) { await versions.capture(SCREEN_VERSIONS_KEY, withoutHistory(next)); current = await newestTs(); }
      if (current != null && current !== previous && previous != null) parents[current] = previous;
      const book = await this.set({ ...withoutHistory(next), history: { at: current, parents: capParents(parents) } });
      return { book, previous, current };
    },
    /**
     * UNDO: step back to the parent of the version the book stands at — the versions are the mechanism (a restore is
     * not a new version, so repeated undos walk back instead of toggling). Null when there is nothing before.
     * @returns {Promise<{book: object, previous: number, current: number}|null>}
     */
    async undo() {
      if (!hasVersions || typeof versions.restore !== 'function') return null;
      const cur = await this.get();
      const at = cur.history?.at ?? null;
      const parent = at != null ? cur.history.parents?.[at] : null;
      if (!Number.isFinite(parent)) return null;
      const value = await versions.restore(SCREEN_VERSIONS_KEY, parent);
      if (!value) return null;
      const book = await this.set({ ...withoutHistory(normalizeScreenBook(value)), history: { at: parent, parents: cur.history.parents } });
      return { book, previous: at, current: parent };
    },
    /** Put the book back as it was at version `ts` (itself kept as a new version, so a restore is undoable too). */
    async restoreVersion(ts) {
      if (!hasVersions || typeof versions.restore !== 'function') return null;
      const value = await versions.restore(SCREEN_VERSIONS_KEY, ts);
      if (!value) return null;
      const book = await this.set(value);
      await versions.capture(SCREEN_VERSIONS_KEY, book);
      return { book, current: await newestTs() };
    },
  };
}

/** The one series the person's screen book is versioned under (it is the device's: there is one book per device). */
export const SCREEN_VERSIONS_KEY = 'device';

/** A device's own screen book with its versions (each change kept, so it can be undone) — what the web shell composes. */
export function localUserScreenStore(storage = globalThis.localStorage) {
  return createUserScreenStore({ io: localStorageScreenIo(storage), versions: localStorageObjectVersions('screens', storage) });
}

/**
 * localStorage-backed io.  Single key (no per-circle splitting).
 *   key: `cc.userScreens`
 */
export function localStorageScreenIo(storage = globalThis.localStorage) {
  const KEY = 'cc.userScreens';
  return {
    load: async () => {
      try {
        const s = storage?.getItem(KEY);
        return s ? JSON.parse(s) : null;
      } catch { return null; }
    },
    save: async (book) => {
      try { storage?.setItem(KEY, JSON.stringify(book)); } catch { /* quota / disabled */ }
    },
  };
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Internals                                                              */
/* ─────────────────────────────────────────────────────────────────────── */

function normalizeCircleFilter(raw) {
  if (raw == null) return ALL_CIRCLES;
  if (!Array.isArray(raw)) return ALL_CIRCLES;
  const out = [];
  for (const id of raw) {
    if (typeof id === 'string' && id) out.push(id);
  }
  // Empty array is canonicalised to null (= all circles).
  return out.length > 0 ? out : ALL_CIRCLES;
}

// The one block table (circleRecipe.js): a page keeps any block type the table knows; which ones an editor OFFERS is
// the table's `places` (a copy of the list lived here and had already drifted from it).

function normalizeBlocks(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const b of arr) {
    if (!b || typeof b !== 'object') continue;
    if (typeof b.type !== 'string' || !BLOCK_TYPES.includes(b.type)) continue;
    const id = typeof b.id === 'string' && b.id ? b.id : freshBlockId();
    const config = b.config && typeof b.config === 'object' ? { ...b.config } : {};
    out.push({ id, type: b.type, config });
  }
  return out;
}

let _screenSeq = 0;
function freshScreenId() {
  _screenSeq = (_screenSeq + 1) | 0;
  return `s-${Date.now().toString(36)}-${_screenSeq.toString(36)}`;
}

let _blockSeq = 0;
function freshBlockId() {
  _blockSeq = (_blockSeq + 1) | 0;
  return `b-${Date.now().toString(36)}-${_blockSeq.toString(36)}`;
}
