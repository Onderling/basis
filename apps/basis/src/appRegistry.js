/**
 * basis — app-toggle registry.
 *
 * Per OQ-4.B user resolution (2026-05-23): apps in the merged
 * catalogue can be toggled on/off from chat-inline.  Disabled apps'
 * ops disappear from `/help`, fail dispatch with a friendly error,
 * and their notifications stop routing.
 *
 * The chat-shell built-ins `/apps` (list) + `/apps on|off <name>`
 * (toggle) live in `core/localBuiltins.js`; this module owns the
 * pure state.  Persistence rides on the same IndexedDB store as
 * threads (in a separate object store, `appStates`).
 *
 * Side-panel UI (OQ-4.B's "and side-panel" half) lands when the
 * basis RN renderer ships in v0.6.7+ — the same registry
 * powers both surfaces.
 */

/**
 * @typedef {object} AppState
 * @property {string}  appOrigin
 * @property {boolean} enabled
 */

export class AppRegistry {
  /** @type {Map<string, boolean>} appOrigin → enabled */
  #state;
  /** @type {Set<(state: ReadonlyMap<string,boolean>) => void>} */
  #subscribers;

  constructor(initial = {}) {
    this.#state = new Map();
    this.#subscribers = new Set();
    if (initial && typeof initial === 'object') {
      for (const [k, v] of Object.entries(initial)) {
        this.#state.set(String(k), v !== false);
      }
    }
  }

  /**
   * Set the known appOrigins (called when the catalogue is rebuilt).
   * Apps not in the list lose their state.  New apps default to
   * enabled.
   *
   * @param {string[]} appOrigins
   */
  syncWithCatalogue(appOrigins) {
    if (!Array.isArray(appOrigins)) return;
    const known = new Set(appOrigins);
    for (const k of [...this.#state.keys()]) {
      if (!known.has(k)) this.#state.delete(k);
    }
    for (const k of appOrigins) {
      if (!this.#state.has(k)) this.#state.set(k, true);
    }
    this.#emit();
  }

  /** @param {string} appOrigin */
  isEnabled(appOrigin) {
    // Unknown app → treat as enabled (forward-additive; new apps that
    // enter the catalogue before sync are usable immediately).
    if (!this.#state.has(appOrigin)) return true;
    return this.#state.get(appOrigin) === true;
  }

  /**
   * @param {string}  appOrigin
   * @param {boolean} enabled
   */
  setEnabled(appOrigin, enabled) {
    this.#state.set(String(appOrigin), enabled !== false);
    this.#emit();
  }

  /** @returns {string[]} */
  enabledApps() {
    const out = [];
    for (const [k, v] of this.#state) if (v) out.push(k);
    return out;
  }

  /** @returns {AppState[]} — for serialisation + UI listing */
  snapshot() {
    return [...this.#state.entries()].map(([appOrigin, enabled]) => ({
      appOrigin, enabled,
    }));
  }

  /**
   * Subscribe to state changes; returns an unsubscribe handle.
   *
   * @param {(state: ReadonlyMap<string, boolean>) => void} fn
   * @returns {() => void}
   */
  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    this.#subscribers.add(fn);
    return () => this.#subscribers.delete(fn);
  }

  #emit() {
    const view = new Map(this.#state);
    for (const fn of this.#subscribers) {
      try { fn(view); } catch { /* swallow */ }
    }
  }
}

/**
 * Filter a merged catalogue by the registry's enabled-set.  Returns
 * a NEW catalogue with disabled apps' ops removed from commandMenu +
 * opsById (replyShapeFor / followUpsFor / embedSnapshotFor still
 * look up by opId — unchanged, just won't find ops that aren't in
 * opsById).
 *
 * @param {import('./manifestMerge.js').MergedCatalogue} catalogue
 * @param {AppRegistry} registry
 * @returns {import('./manifestMerge.js').MergedCatalogue}
 */
export function filterCatalogue(catalogue, registry) {
  if (!catalogue || !registry) return catalogue;
  const filteredOpsById = new Map();
  for (const [key, entry] of catalogue.opsById) {
    if (registry.isEnabled(entry.appOrigin)) filteredOpsById.set(key, entry);
  }
  return {
    ...catalogue,
    opsById:     filteredOpsById,
    commandMenu: catalogue.commandMenu.filter((e) => registry.isEnabled(e.appOrigin)),
    appOrigins:  catalogue.appOrigins.filter((a) => registry.isEnabled(a)),
  };
}
