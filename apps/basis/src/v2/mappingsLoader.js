/**
 * mappingsLoader — COMPAT WRAPPER (repo-split W4, objective F).
 *
 * The neutral load+verify path moved into the platform-neutral substrate
 * `@onderling/kring-host` (`./mappingsLoader`). It could not `export *` re-export like the pure W3 leaves,
 * because its verify gate (`verifyMappings`, `mappingsToSources`) lives in the app-local `../mappings.js`
 * — which itself depends on the app-local `composite.js` (`verifyComposite`, destined for
 * `@onderling/manifest-host`, not kring-host), so `mappings.js` can't move into the substrate honestly yet.
 *
 * The substrate loader therefore takes those two functions by INJECTION. This shim is the app-side
 * composition seam: it binds basis's `verifyMappings`/`mappingsToSources` into the neutral loader so
 * existing callers (web `circleApp.js`, mobile `agentBundle.js`, the test) keep calling
 * `loadVerifyMappings({ store, deviceId, catalogue })` unchanged.
 */
import { loadVerifyMappings as loadVerifyMappingsNeutral } from '@onderling/kring-host/mappingsLoader';
import { verifyMappings, mappingsToSources } from '../mappings.js';

/** @type {typeof loadVerifyMappingsNeutral} */
export function loadVerifyMappings(args) {
  return loadVerifyMappingsNeutral({ verifyMappings, mappingsToSources, ...args });
}
