/**
 * screenHead — a screen's materialized blocks (Vandaag, Mij), kept current instead of read again on every landing.
 *
 * A PROJECTION, in memory for the session only: built from the stores at the first landing after boot, never persisted
 * (the shells' cache-first paint stays what it was), and dropped whenever its key changes. On a phone each Vandaag
 * landing read calendar.listEvents ×6 and tasks.listOpen ×3 though nothing had changed (2026-10-30); a landing on a
 * fresh head reads nothing.
 *
 * What it listens to, each through a subscription the shell hands in (`subscribe`):
 *   - the circles' ITEMS — `agent.onCircleChanged`: this node's own writes and members' items that landed, the
 *     own-devices scope included;
 *   - the event LOG — chat, unread and news are entries there, not items, so the log's own subscription marks the
 *     head stale too;
 *   - the landing KEY (the page and its blocks, the circles shown, the selves, the block opened whole): another key is
 *     another head;
 *   - and `invalidate()`, which a shell calls after an act of the person's own that changes what the screen shows
 *     without writing a store (the intro card seen, a setting).
 * Stale while the screen is shown → ONE refold after `debounceMs` (a burst of changes is one read), handed to the
 * screen through `onUpdate`. Stale while it is hidden → nothing runs; the next landing refolds. An idle screen does no work.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** How long a shown screen waits after a change before it reads again (a burst of landed items is one read). */
export const SCREEN_HEAD_DEBOUNCE_MS = param({ key: 'vandaag.headDebounceMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 400 });

/**
 * @param {object} a
 * @param {(key: string) => Promise<any>} [a.materialize]  read the screen for this key (the shell's materializeScreen call);
 *   a screen that builds its reader per mount hands it to `land` instead
 * @param {Array<(fn: Function) => (() => void)>} [a.subscribe]  each returns its unsubscribe; any call marks the head stale
 * @param {number} [a.debounceMs]
 */
export function createScreenHead({ materialize, subscribe = [], debounceMs = SCREEN_HEAD_DEBOUNCE_MS }) {
  let reader = typeof materialize === 'function' ? materialize : null;
  let key = null;
  let blocks;
  let fresh = false;
  let shown = false;
  let inFlight = null;          // { key, promise }
  let timer = null;
  const updates = new Set();

  const read = (k) => {
    if (inFlight && inFlight.key === k) return inFlight.promise;
    const promise = (async () => {
      try {
        if (!reader) throw new TypeError('screenHead: no reader (pass materialize, or land(key, reader))');
        const out = await reader(k);
        if (key === k) { blocks = out; fresh = true; }
        return out;
      } finally {
        if (inFlight?.promise === promise) inFlight = null;
      }
    })();
    inFlight = { key: k, promise };
    return promise;
  };

  const refold = () => {
    timer = null;
    if (!shown || key === null) return;
    const k = key;
    read(k).then((out) => {
      if (key !== k || !shown) return;
      for (const fn of updates) { try { fn(out); } catch { /* one screen never stops another */ } }
    }).catch(() => { /* the next landing reads again */ });
  };

  const stale = () => {
    fresh = false;
    if (!shown || timer) return;
    timer = setTimeout(refold, debounceMs);
  };

  const unsubs = (Array.isArray(subscribe) ? subscribe : [subscribe])
    .filter((s) => typeof s === 'function')
    .map((s) => { try { return s(() => stale()); } catch { return null; } })
    .filter((u) => typeof u === 'function');

  return {
    /** The screen is shown with this key: what the head holds when it is fresh for it, else one read. `reader` (optional)
     *  replaces the head's reader from here on — a screen that is mounted anew per landing brings its own. */
    async land(k, reader_ = null) {
      if (typeof reader_ === 'function') reader = reader_;
      shown = true;
      if (k !== key) { key = k; fresh = false; blocks = undefined; }
      if (fresh) return blocks;
      return read(k);
    },
    /** Whether a landing with this key would read nothing (the shell can skip its own cache-first paint). */
    isFresh(k) { return fresh && k === key; },
    /** The screen went away: changes wait for the next landing. */
    hide() {
      shown = false;
      if (timer) { clearTimeout(timer); timer = null; }
    },
    /** Something the subscriptions do not see changed what the screen shows: the next landing (or a shown screen) reads. */
    invalidate() { stale(); },
    /** A refold while shown: `fn(blocks)`. Returns the unsubscribe. */
    onUpdate(fn) {
      if (typeof fn !== 'function') return () => {};
      updates.add(fn);
      return () => { updates.delete(fn); };
    },
    dispose() {
      if (timer) { clearTimeout(timer); timer = null; }
      for (const u of unsubs) { try { u(); } catch { /* gone either way */ } }
      unsubs.length = 0;
      updates.clear();
    },
  };
}
