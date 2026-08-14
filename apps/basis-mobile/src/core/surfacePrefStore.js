/**
 * surfacePrefStore — the per-user surface preference singleton (mobile), shared by the kring
 * screen (applies it to bot replies) + the My-data screen (sets it). Mirrors web's module-level
 * store in circleApp.js.
 *
 * Register-backed since the device-params consolidation: the value lives in the parameter
 * register (device scope) — no bare AsyncStorage key. The store is constructed at module scope,
 * before the agent boots, so the io holds an agent THUNK; App.js calls `attachSurfacePrefAgent`
 * once the bundle is up, which also hydrates the cache from the register. Until then `.get()`
 * serves the default ('inline'), matching web's pre-hydrate window.
 */
import { createSurfacePrefStore, registerSurfacePrefIo } from '../../../basis/src/v2/surfacePref.js';

let _agent = null;

export const surfacePrefStore = createSurfacePrefStore(registerSurfacePrefIo(() => _agent));

/** Late-bind the booted agent, then hydrate the cached value from the register. */
export function attachSurfacePrefAgent(agent) {
  _agent = agent ?? null;
  if (_agent) surfacePrefStore.hydrate().catch(() => {});
}
