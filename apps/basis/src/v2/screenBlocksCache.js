/**
 * basis v2 — per-screen materialized-blocks cache (δ.1).
 *
 * Tiny store that stashes the LAST `materializeScreen(...)` result per
 * screenId.  The Screens-tab view-mode reads on screen open and renders
 * the cached blocks immediately while a fresh materialize runs in the
 * background; on result the view swaps + the cache re-saves the fresh
 * payload.  Result: tapping a screen feels instant (the 200–800ms
 * materialize wait happens silently behind the scenes), with a subtle
 * "refreshing" pip in the heading while fresh data is in flight.
 *
 * Survives reboots — on cold boot the user sees the previous screen
 * state immediately instead of staring at "Loading…" while the host
 * resolves block-skills + filter rows.
 *
 * Storage is injected (`load`/`save`/`remove`) so web wires localStorage
 * and mobile wires AsyncStorage via thin adapters (see
 * `screenBlocksCacheStorage.js` + `screenBlocksCacheStorageRN.js`).
 *
 * Shape: stores arbitrary JSON-serializable blobs (materializeScreen
 * returns plain block objects already; if a callsite ever stores
 * functions or dates the JSON round-trip will lossy-coerce them).
 */

/**
 * Build a per-screen materialized-blocks cache from injected IO.
 *
 * @param {object} [io]
 * @param {(screenId: string) => Promise<object[]|null>} [io.load]
 * @param {(screenId: string, blocks: object[]) => Promise<void>} [io.save]
 * @param {(screenId: string) => Promise<void>} [io.remove]
 * @returns {{ get: Function, set: Function, clear: Function }}
 */
export function createScreenBlocksCache({ load, save, remove } = {}) {
  return {
    async get(screenId) {
      if (typeof screenId !== 'string' || !screenId) return null;
      if (typeof load !== 'function') return null;
      try { return (await load(screenId)) ?? null; }
      catch { return null; }
    },
    async set(screenId, blocks) {
      if (typeof screenId !== 'string' || !screenId) return;
      if (typeof save !== 'function') return;
      try { await save(screenId, blocks); } catch { /* ignore */ }
    },
    async clear(screenId) {
      if (typeof screenId !== 'string' || !screenId) return;
      if (typeof remove !== 'function') return;
      try { await remove(screenId); } catch { /* ignore */ }
    },
  };
}
