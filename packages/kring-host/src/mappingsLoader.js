/**
 * Shared extension-mapping loader (feedback-extension — web≡mobile core;
 * repo-split W4, objective F).
 *
 * Platform-independent: the caller injects the store (web localStorage /
 * mobile AsyncStorage / a real pseudo-pod) + the base catalogue. Loads the pod
 * `mappings/` folder, runs the sandbox verify gate against the catalogue, and
 * returns the `mergeManifests` sources for the accepted mappings (to merge in)
 * plus the rejected/dropped for surfacing. Both the web (`circleApp.js`) and
 * mobile (`agentBundle.js`) composition roots reach this so the load+verify
 * path lives ONCE.
 *
 * The verify/convert gate (`verifyMappings`, `mappingsToSources`) is INJECTED
 * rather than imported: those functions live in the basis app module
 * `src/mappings.js`, whose own dependency on the app-local `composite.js`
 * (`verifyComposite`, destined for `@onderling/manifest-host` — NOT this package)
 * keeps `mappings.js` from moving into this substrate honestly. Injection lets
 * this loader live neutrally in `@onderling/kring-host` while the app wires its
 * verify gate in — the compat shim at `apps/basis/src/v2/mappingsLoader.js`
 * binds the app's `verifyMappings`/`mappingsToSources` so existing callers stay
 * unchanged. Mirrors the repo's injected-dependency convention (blob-gateway /
 * confidential-llm / data-connectors inject their adapters).
 */

import { loadMappings } from '@onderling/pod-routing/mappings';

/**
 * @param {object} args
 * @param {{list:Function, read:Function}} args.store   pseudo-pod-subset store
 * @param {string} args.deviceId
 * @param {{ opsById: Map }} args.catalogue               the base catalogue to verify against
 * @param {(mappings:Array, catalogue:object)=>{accepted:object[], rejected:Array<{id,missing:string[]}>}} args.verifyMappings
 *        catalogue verify gate — injected (basis `src/mappings.js`)
 * @param {(accepted:object[])=>{sources:Array<{manifest:object}>, dropped:Array<{id,errors:object[]}>}} args.mappingsToSources
 *        manifest-shape gate — injected (basis `src/mappings.js`)
 * @returns {Promise<{ sources: Array<{manifest:object}>, accepted: object[],
 *                     rejected: Array<{id,missing}>, dropped: Array<{id,errors}>,
 *                     mappingOrigins: string[] }>}
 */
export async function loadVerifyMappings({ store, deviceId, catalogue, verifyMappings, mappingsToSources }) {
  if (typeof verifyMappings !== 'function' || typeof mappingsToSources !== 'function') {
    throw new TypeError('loadVerifyMappings: verifyMappings and mappingsToSources must be injected');
  }
  const { mappings } = await loadMappings({ pseudoPod: store, deviceId });
  const { accepted, rejected } = verifyMappings(mappings, catalogue);
  const { sources, dropped } = mappingsToSources(accepted);
  return {
    sources,
    accepted,
    rejected,
    dropped,
    mappingOrigins: sources.map((s) => s.manifest.app),
  };
}
