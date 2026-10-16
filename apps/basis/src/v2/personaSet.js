/**
 * The persona SET — the header switcher: which of this device's selves the app shows now. Kept on the screens book
 * (per device, `personaSet`), changed only through the `screen-set-personas` op, so it is logged and undoable like a
 * page change. No set = all; a self not held here is dropped; the set never goes empty (an empty one reads as all).
 * Vandaag, Kringen and Contacten show the circles of the selves in the set; the "+" writes as the one ticked self,
 * else it asks.
 */

/**
 * The selves the app shows, in this device's order.
 * @param {{personaSet?: string[]}} book
 * @param {Array<{id: string}>} held   this device's selves (`personasHere`), the default first
 * @returns {string[]}
 */
export function activeSelves(book, held = []) {
  const here = held.map((p) => p.id);
  const want = new Set(Array.isArray(book?.personaSet) ? book.personaSet : []);
  const on = here.filter((id) => want.has(id));
  return on.length ? on : here;
}

/**
 * The circles of the selves in the set (a circle is its self's: `profileIdOf(circleId)`, 'default' when unbound).
 * @param {Array<{id?: string, groupId?: string}>} circles
 * @param {string[]} selves
 * @param {(circleId: string) => string} profileIdOf
 */
export function circlesInSet(circles = [], selves = [], profileIdOf = () => 'default') {
  const on = new Set(selves);
  return circles.filter((c) => on.has(profileIdOf(c?.id ?? c?.groupId) ?? 'default'));
}

/** The self a new own item is written as: the one ticked — with several on, null (the "+" asks). */
export function writeAs(selves = []) {
  return selves.length === 1 ? selves[0] : null;
}

/**
 * The switcher's model: one row per self (on / off; the last one on cannot be turned off), "alle", and the op each
 * act compiles to.
 * @param {object} a
 * @param {object} a.book
 * @param {Array<{id: string, name: string|null}>} a.held
 */
export function switcherModel({ book, held = [] } = {}) {
  const explicit = Array.isArray(book?.personaSet) && book.personaSet.length > 0;
  const on = activeSelves(book, held);
  const onSet = new Set(on);
  const rows = held.map((p) => ({ id: p.id, name: p.name ?? null, on: onSet.has(p.id), canToggle: !(onSet.has(p.id) && on.length === 1) }));
  const op = (ids) => ({ opId: 'screen-set-personas', args: { ids } });
  return {
    rows,
    allOn: !explicit || on.length === held.length,
    toggle: (id) => {
      const row = rows.find((r) => r.id === id);
      if (!row || !row.canToggle) return null;
      const next = row.on ? on.filter((x) => x !== id) : held.map((p) => p.id).filter((x) => onSet.has(x) || x === id);
      return op(next.length === held.length ? null : next);
    },
    all: () => op(null),
  };
}

/** The contacts of the selves in the set: a contact is its pair circle's self; one without a pair circle is the default's. */
export function contactsInSet(contacts = [], selves = [], profileIdOf = () => 'default') {
  const on = new Set(selves);
  return contacts.filter((c) => on.has(c?.pairCircleId ? (profileIdOf(c.pairCircleId) ?? 'default') : 'default'));
}
