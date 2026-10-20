/**
 * VASTGEZET — what a person pinned to their "+" sheet: their own acts (`{kind: 'own', actId}`) and BOOKMARKS to an op
 * in one of their circles (`{kind: 'bookmark', circleId, appOrigin, opId}`), kept in the screens book (`book.pinned`)
 * and changed only through the screen ops (versioned, undoable).
 *
 * A bookmark is an ADDRESS and nothing else: never an op's args, never anything of the circle's content (a pin is
 * written as these fields only, whatever it was handed). In the sheet a bookmark OPENS its circle with that op's form
 * selected; it is never invoked from the sheet. It is painted only while it still works: the person is in that circle
 * and the circle's availability does not hide the op. A tap from a stale paint (the circle was left since) opens
 * nothing and says so.
 */

/** A pin reduced to its address (null when it is not one). */
function cleanPin(p) {
  if (p?.kind === 'own' && typeof p.actId === 'string' && p.actId) return { kind: 'own', actId: p.actId };
  if (p?.kind === 'bookmark' && [p.circleId, p.appOrigin, p.opId].every((x) => typeof x === 'string' && x)) {
    return { kind: 'bookmark', circleId: p.circleId, appOrigin: p.appOrigin, opId: p.opId };
  }
  return null;
}

/** The one key a pin has (two pins with the same key are one). */
export function pinKey(p) {
  const c = cleanPin(p);
  if (!c) return '';
  return c.kind === 'own' ? `own:${c.actId}` : `bookmark:${c.circleId}:${c.appOrigin}:${c.opId}`;
}

/** The book's pins, each reduced to its address. */
export function pinsOf(book) {
  return (Array.isArray(book?.pinned) ? book.pinned : []).map(cleanPin).filter(Boolean);
}

/** The book with this pin added (once; a malformed pin adds nothing). */
export function withPin(book, pin) {
  const c = cleanPin(pin);
  const cur = pinsOf(book);
  if (!c || cur.some((x) => pinKey(x) === pinKey(c))) return { ...book, pinned: cur };
  return { ...book, pinned: [...cur, c] };
}

/** The book with the pin of this key taken away. */
export function withoutPin(book, key) {
  return { ...book, pinned: pinsOf(book).filter((x) => pinKey(x) !== key) };
}

/**
 * The pins to paint, in order, each with the words it needs: an own act that still exists; a bookmark whose circle the
 * person is in and whose op that circle's availability does not hide (with the circle's name).
 * @param {object[]} pins
 * @param {{ circles: Array<{id: string, name?: string}>, availabilityOf?: (circleId: string) => ({of: Function}|null), ownActIds?: string[] }} o
 */
export function paintablePins(pins, { circles = [], availabilityOf = null, ownActIds = [] } = {}) {
  const byId = new Map((circles ?? []).map((c) => [c.id, c]));
  const own = new Set(ownActIds);
  const out = [];
  for (const p of (pins ?? []).map(cleanPin).filter(Boolean)) {
    if (p.kind === 'own') { if (own.has(p.actId)) out.push(p); continue; }
    const c = byId.get(p.circleId);
    if (!c) continue;
    const av = typeof availabilityOf === 'function' ? availabilityOf(p.circleId) : null;
    if (av && av.of(p.opId).state === 'hidden') continue;
    out.push({ ...p, name: c.name ?? '' });
  }
  return out;
}

/**
 * What tapping a pin does: an own act is chosen in the sheet (`{kind: 'own', actId}`); a bookmark OPENS its circle with
 * that op's form (`{kind: 'open-circle', circleId, appOrigin, opId}` — no args, nothing invoked). A bookmark whose
 * circle is no longer the person's: `{error}` — it opens nothing, and the sheet says so.
 */
export function openPin(pin, { circles = [] } = {}) {
  const p = cleanPin(pin);
  if (!p) return { error: 'circle.vandaag.pin_gone' };
  if (p.kind === 'own') return { kind: 'own', actId: p.actId };
  if (!(circles ?? []).some((c) => c.id === p.circleId)) return { error: 'circle.vandaag.pin_gone' };
  return { kind: 'open-circle', circleId: p.circleId, appOrigin: p.appOrigin, opId: p.opId };
}
