/**
 * intentionBook — the intention rows of every store a host holds, written and read: `intend` a row, `cancel` it, record
 * that it `ran`. Its own store (the own-devices store) and each circle store the host is in: a row a member's device
 * wrote into a circle's store is a row here too, once that store holds it. The rows are read at `load()` (the runner
 * reads them again each pass, so a row that synced in since is seen) and kept as the stores hold them, so a setting can
 * ask "is it on?" without waiting. Occurrences are never written here — they are read from the rows (`intentions.js`).
 */

const iso = (t) => new Date(t).toISOString();

/**
 * @param {object} a
 * @param {import('@onderling/item-store').CircleItemStore} a.store   the host's own store
 * @param {() => Promise<Array<{scope: string, store: import('@onderling/item-store').CircleItemStore}>>} [a.circles]
 *   the circle stores the host holds, each under its circle id
 * @param {string} a.actor          who writes the rows (the host)
 * @param {() => number} [a.now]
 */
export function createIntentionBook({ store, circles = null, actor, now = Date.now }) {
  /** @type {Map<string, object>} */
  const byId = new Map();
  /** A row's circle (absent: the host's own store). */
  const scopes = new Map();
  /** The circle stores as last read. */
  let held = new Map();
  const keep = (row, scope = null) => {
    if (row?.id) { byId.set(row.id, row); if (scope) scopes.set(row.id, scope); else scopes.delete(row.id); }
    return row;
  };
  const readCircles = async () => {
    const list = typeof circles === 'function' ? ((await circles()) ?? []) : [];
    held = new Map(list.filter((c) => c?.scope && c?.store).map((c) => [c.scope, c.store]));
    return held;
  };
  const storeOf = (id) => (scopes.has(id) ? held.get(scopes.get(id)) : store);

  async function update(id, patch) {
    const where = storeOf(id);
    const row = byId.get(id) ?? (await where.get(id));
    if (!row) throw new Error(`intention ${id} not found`);
    return keep(await where.put({ ...row, ...patch }, { by: actor }), scopes.get(id) ?? null);
  }

  return {
    async load() {
      const next = new Map();
      const nextScopes = new Map();
      for (const row of await store.listByType('intention')) if (row?.id) next.set(row.id, row);
      for (const [scope, s] of await readCircles()) {
        let rows = [];
        try { rows = (await s.listByType('intention')) ?? []; } catch { /* one circle's store failing never hides the others */ }
        for (const row of rows) if (row?.id) { next.set(row.id, row); nextScopes.set(row.id, scope); }
      }
      byId.clear(); scopes.clear();
      for (const [id, row] of next) byId.set(id, row);
      for (const [id, scope] of nextScopes) scopes.set(id, scope);
    },
    /** Every row, any state. */
    rows: () => [...byId.values()],
    /** The circle a row is in, or null for the host's own store. */
    scopeOf: (id) => scopes.get(id) ?? null,
    /** The store a row is in. */
    storeOf,
    /** A person's open rows for one op. */
    openFor: (actsAs, op) => [...byId.values()].filter((r) => r.state === 'open' && r.actsAs === actsAs && r.op === op),
    /**
     * A new row, open — in the host's own store, or in the circle `scope` names (one the host holds).
     * @param {{trigger: object, op: string, appOrigin?: string, args?: object, actsAs: string, label?: string, window?: string|number, scope?: string}} spec
     */
    async intend({ trigger, op, appOrigin = null, args = {}, actsAs, label = null, window: win, scope = null } = {}) {
      if (typeof op !== 'string' || !op) throw new Error('intend: an op is required');
      if (typeof actsAs !== 'string' || !actsAs) throw new Error('intend: actsAs (whose authority it runs under) is required');
      if (!trigger || typeof trigger !== 'object') throw new Error('intend: a trigger is required');
      let where = store;
      if (scope) {
        where = held.get(scope) ?? (await readCircles()).get(scope);
        if (!where) throw new Error(`intend: this host holds no circle ${scope}`);
      }
      const row = {
        type: 'intention', trigger, op, args, actsAs, state: 'open',
        ...(appOrigin ? { appOrigin } : {}), ...(label ? { label } : {}), ...(win !== undefined ? { window: win } : {}),
      };
      return keep(await where.put(row, { by: actor }), scope);
    },
    async cancel(id) { return update(id, { state: 'cancelled' }); },
    /** It ran now: a one-off row is finished, a recurring row's last run moves (its earlier occurrences are done). */
    async ran(id) {
      const row = byId.get(id);
      const once = row?.trigger?.at != null && row?.trigger?.every == null;
      return update(id, { lastRunAt: iso(now()), ...(once ? { state: 'done' } : {}) });
    },
  };
}
