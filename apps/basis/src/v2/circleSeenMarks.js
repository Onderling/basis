/**
 * The circles' seen-marks on this device (`cc.circleSeenAt`: circle id → when the person last looked), held for both
 * shells (ledger L1085). The rule a shell may not hold itself:
 *
 *   A MARK IS NEVER WRITTEN FROM A MAP THAT WAS NOT LOADED. Before, the phone started from `{}` and an `openCircle`
 *   before the stored marks were read wrote `bump({}, id)` over them: every other circle's mark was gone, and all of
 *   its news showed as unread again. Now an open before the load is REMEMBERED and applied to the loaded map when it
 *   arrives, so the person's open still counts and nothing they had is lost.
 *
 * And for the readers: `current()` is `null` until the marks are loaded — "not known yet", which the projections
 * (`buildTilePreviews`, the circles-with-news block) answer with NO unread count, never "everything unread". `{}` means
 * known and empty.
 *
 * The marks are SEALED at rest (ledger L1083): `circleSeenMarksIo(storage)` is the shared sealed io, so the shells load
 * them once the content key exists (`onShellContentSeal`). The one write a load may make is the one that applies
 * opens made before it; a load with nothing pending writes nothing (beyond the one-time reseal of an old plain value).
 */
import { bumpSeenAt } from './circleTilePreviews.js';
import { sealedJsonIo } from './localStoreSeal.js';

export const CIRCLE_SEEN_AT_KEY = 'cc.circleSeenAt';

/** The marks' sealed io, over localStorage (web) or AsyncStorage (phone). */
export function circleSeenMarksIo(storage) {
  const io = sealedJsonIo(storage);
  return {
    load: () => io.load(CIRCLE_SEEN_AT_KEY),
    save: async (map) => { try { await io.save(CIRCLE_SEEN_AT_KEY, map); } catch { /* no content key yet: kept in memory */ } },
  };
}

/**
 * @param {{load: () => Promise<object|null>, save: (map: object) => Promise<void>}} io
 * @param {{now?: () => number}} [o]
 */
export function createCircleSeenMarks({ load, save } = {}, { now = () => Date.now() } = {}) {
  let held = null;            // null: not loaded yet
  let pending = [];           // opens before the load: [circleId, ts]
  const subs = new Set();
  const notify = () => { for (const fn of subs) { try { fn(held); } catch { /* one bad listener */ } } };
  return {
    /** The marks as held, or `null` while not known yet. */
    current: () => held,
    /** Read the stored marks (call once the content key exists); applies opens made before, and writes only then. */
    async load() {
      let stored = null;
      try { stored = await load?.(); } catch { stored = null; }
      let map = (stored && typeof stored === 'object' && !Array.isArray(stored)) ? { ...stored } : {};
      const before = pending; pending = [];
      for (const [id, ts] of before) map = bumpSeenAt(map, id, ts);
      held = map;
      if (before.length) { try { await save?.(held); } catch { /* the next open writes it */ } }
      notify();
      return held;
    },
    /** The person opened (or left) a circle: its mark moves to now — remembered when the marks are not loaded yet. */
    async open(circleId, ts = now()) {
      if (!circleId) return held;
      if (held === null) { pending.push([circleId, ts]); return null; }
      held = bumpSeenAt(held, circleId, ts);
      try { await save?.(held); } catch { /* best-effort */ }
      notify();
      return held;
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}
