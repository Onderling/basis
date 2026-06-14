/**
 * Shared extension-mapping loader (feedback-extension P2 — web≡mobile core).
 *
 * Platform-independent: the caller injects the store (web localStorage /
 * mobile AsyncStorage / a real pseudo-pod) + the base catalog. Loads the pod
 * `mappings/` folder, runs the sandbox verify gate (`verifyMappings`) against
 * the catalog, and returns the `mergeManifests` sources for the accepted
 * mappings (to merge in) plus the rejected/dropped for surfacing. Both the web
 * (`circleApp.js`) and mobile (`agentBundle.js`) composition roots call this so
 * the load+verify path lives ONCE.
 */

import { loadMappings } from '@canopy/pod-routing/mappings';
import { verifyMappings, mappingsToSources } from '../mappings.js';

/**
 * @param {object} args
 * @param {{list:Function, read:Function}} args.store   pseudo-pod-subset store
 * @param {string} args.deviceId
 * @param {{ opsById: Map }} args.catalog               the base catalog to verify against
 * @returns {Promise<{ sources: Array<{manifest:object}>, accepted: object[],
 *                     rejected: Array<{id,missing}>, dropped: Array<{id,errors}>,
 *                     mappingOrigins: string[] }>}
 */
export async function loadVerifyMappings({ store, deviceId, catalog }) {
  const { mappings } = await loadMappings({ pseudoPod: store, deviceId });
  const { accepted, rejected } = verifyMappings(mappings, catalog);
  const { sources, dropped } = mappingsToSources(accepted);
  return {
    sources,
    accepted,
    rejected,
    dropped,
    mappingOrigins: sources.map((s) => s.manifest.app),
  };
}
