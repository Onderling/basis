/**
 * A KEPT PICTURE: what a screen showed when it was last caught up, painted at a cold start before the agent is whole
 * (the cold-start work, the circles list and Today on the phone).
 *
 * ONE RULE for every screen that has one: the kept picture stays on screen until the LIVE state is CAUGHT UP, and only
 * a caught-up live state may become the next kept picture. "Caught up" is the screen's own answer that its sources were
 * read (for the circles list and Today: the circles list was read, `circlesKnown`), never "the live state has rows": an
 * empty day and a person in no circle are real answers, and a live state read before the stores were open is not one.
 * Before this, Today's kept blocks were replaced at ~3 s by a live read made before the circles were known ("nothing
 * planned"), until the real one landed at ~13 s; and that early read was written back as the next start's picture.
 *
 * A picture is never a source: nothing reads it but the painter. A tap on what it shows waits for the live state.
 */

/**
 * What to paint now.
 * @param {{ kept?: unknown, live?: unknown, caughtUp?: boolean }} s
 *   `kept` the picture read at the start (null: none), `live` the live value (null: not read yet), `caughtUp` whether
 *   the live sources were read
 * @returns {{ source: 'live'|'kept'|'none', value: unknown, refreshing: boolean }}
 *   `refreshing` is true while a kept picture stands in for a live state that is still coming
 */
export function keptPictureView({ kept = null, live = null, caughtUp = false } = {}) {
  if (caughtUp && live != null) return { source: 'live', value: live, refreshing: false };
  if (kept != null) return { source: 'kept', value: kept, refreshing: true };
  if (live != null) return { source: 'live', value: live, refreshing: false };
  return { source: 'none', value: null, refreshing: false };
}

/** May this live value become the next kept picture? Only a caught-up one (an early read would be the next start's lie). */
export function mayKeepPicture({ caughtUp = false } = {}) {
  return caughtUp === true;
}

/** One row of the kept circles list: exactly what a tile paints, nothing a tap acts on. */
export function keptCircleRow(circle, preview = null, { pinned = false } = {}) {
  if (!circle || typeof circle.id !== 'string') return null;
  return {
    id: circle.id,
    name: typeof circle.name === 'string' ? circle.name : '',
    // what the live list orders by, so the kept list paints in the same order and is replaced in place
    ...(typeof circle.kind === 'string' && circle.kind ? { kind: circle.kind } : {}),
    ...(Number.isFinite(preview?.ts) ? { ts: preview.ts } : {}),
    ...(pinned ? { pinned: true } : {}),
    ...(Number.isFinite(circle.memberCount) ? { memberCount: circle.memberCount } : {}),
    ...(typeof preview?.subtitle === 'string' && preview.subtitle ? { subtitle: preview.subtitle } : {}),
    ...(Number(preview?.unread) > 0 ? { unread: Number(preview.unread) } : {}),
  };
}

export const KEPT_CIRCLES_KEY = 'cc.keptCircles';

/**
 * The kept circles list over a sealed key-value store (`sealedKeyValue(storage, { strict: true, waitForKey: true })`):
 * `read()` waits for the content key and answers the rows or null; `keep(rows, { caughtUp })` writes only a caught-up
 * list, only when it changed, and at most once a second.
 * @param {{ getItem: Function, setItem: Function }} kv  a SEALED key-value store
 * @param {{ now?: () => number, minIntervalMs?: number }} [o]
 */
export function createKeptCircles(kv, { now = () => Date.now(), minIntervalMs = 1000 } = {}) {
  let lastText = null;
  let lastAt = -Infinity;
  let pending = null;
  let timer = null;
  const write = async (text) => {
    lastText = text; lastAt = now();
    try { await kv.setItem(KEPT_CIRCLES_KEY, text); } catch { /* a picture is best-effort: the live list is the truth */ }
  };
  return {
    async read() {
      try {
        const raw = await kv.getItem(KEPT_CIRCLES_KEY);
        if (typeof raw !== 'string' || !raw) return null;
        const rows = JSON.parse(raw);
        if (!Array.isArray(rows)) return null;
        lastText = raw;
        return rows.filter((r) => r && typeof r.id === 'string');
      } catch { return null; }
    },
    keep(rows, { caughtUp = false } = {}) {
      if (!mayKeepPicture({ caughtUp }) || !Array.isArray(rows)) return Promise.resolve(false);
      const text = JSON.stringify(rows.filter(Boolean));
      if (text === lastText) return Promise.resolve(false);
      const wait = lastAt + minIntervalMs - now();
      if (wait <= 0 && !timer) return write(text).then(() => true);
      pending = text;
      if (!timer) {
        timer = setTimeout(() => { timer = null; const p = pending; pending = null; if (p != null && p !== lastText) write(p); }, Math.max(0, wait));
        if (typeof timer?.unref === 'function') timer.unref();
      }
      return Promise.resolve(true);
    },
  };
}
