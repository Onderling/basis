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

export function normalizeScreenBook(raw) {
  if (!raw || typeof raw !== 'object') return { screens: [], activeId: null };
  const arr = Array.isArray(raw.screens) ? raw.screens : [];
  const screens = arr.map(normalizeScreen);
  let activeId = typeof raw.activeId === 'string' ? raw.activeId : null;
  if (activeId && !screens.some((s) => s.id === activeId)) activeId = null;
  if (!activeId && screens.length > 0) activeId = screens[0].id;
  return { screens, activeId };
}

export function addScreen(book, name = '', circleFilter = ALL_CIRCLES) {
  const cur = normalizeScreenBook(book);
  const screen = emptyScreen(name, circleFilter);
  const screens = [...cur.screens, screen];
  return { screens, activeId: cur.activeId ?? screen.id };
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
  return { screens, activeId };
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
export function createUserScreenStore({ io = {} } = {}) {
  const { load, save } = io;
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
  };
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

// Lifted from circleRecipe.js (same shape, same predicate).  Kept
// inline rather than importing to avoid a circular dependency if
// circleRecipe ever wants a Screen reference later.  Keep in sync
// with circleRecipe.BLOCK_TYPES — α.4 added 'tasks'.
const BLOCK_TYPES = ['announcement', 'noticeboard', 'calendar', 'tasks', 'rules', 'photo', 'text'];

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
