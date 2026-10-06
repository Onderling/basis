/**
 * intentionBook — the intention rows of ONE store, written and read: `intend` a row, `cancel` it, record that it
 * `ran`. The rows are read once at `load()` and kept as the store holds them (every write goes through the book), so a
 * setting can ask "is it on?" without waiting. On the box the store is the own-devices store; occurrences are never
 * written here — they are read from the rows (`intentions.js`).
 */

const iso = (t) => new Date(t).toISOString();

/**
 * @param {object} a
 * @param {import('@onderling/item-store').CircleItemStore} a.store
 * @param {string} a.actor          who writes the rows (the host)
 * @param {() => number} [a.now]
 */
export function createIntentionBook({ store, actor, now = Date.now }) {
  /** @type {Map<string, object>} */
  const byId = new Map();
  const keep = (row) => { if (row?.id) byId.set(row.id, row); return row; };

  async function update(id, patch) {
    const row = byId.get(id) ?? (await store.get(id));
    if (!row) throw new Error(`intention ${id} not found`);
    return keep(await store.put({ ...row, ...patch }, { by: actor }));
  }

  return {
    async load() {
      byId.clear();
      for (const row of await store.listByType('intention')) keep(row);
    },
    /** Every row, any state. */
    rows: () => [...byId.values()],
    /** A person's open rows for one op. */
    openFor: (actsAs, op) => [...byId.values()].filter((r) => r.state === 'open' && r.actsAs === actsAs && r.op === op),
    /**
     * A new row, open.
     * @param {{trigger: object, op: string, appOrigin?: string, args?: object, actsAs: string, label?: string, window?: string|number}} spec
     */
    async intend({ trigger, op, appOrigin = null, args = {}, actsAs, label = null, window: win } = {}) {
      if (typeof op !== 'string' || !op) throw new Error('intend: an op is required');
      if (typeof actsAs !== 'string' || !actsAs) throw new Error('intend: actsAs (whose authority it runs under) is required');
      if (!trigger || typeof trigger !== 'object') throw new Error('intend: a trigger is required');
      const row = {
        type: 'intention', trigger, op, args, actsAs, state: 'open',
        ...(appOrigin ? { appOrigin } : {}), ...(label ? { label } : {}), ...(win !== undefined ? { window: win } : {}),
      };
      return keep(await store.put(row, { by: actor }));
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
