/**
 * @onderling/pod-routing — storage-function → URI mapping + per-write
 * reachability cache for the graceful-degradation gate.
 *
 * See `Project Files/Substrates/substrates-v2-functional-design-2026-05-11.md`
 * §4.3 and Phase 52.3 of the substrates coding plan.
 */

export { createPodRouting }             from './src/PodRouting.js';
export { createReachabilityCache }      from './src/reachability.js';
export { buildDefaultPolicy }           from './src/defaultPolicy.js';
export {
  CANONICAL_STORAGE_FUNCTIONS,
  matchMapping,
  substituteVars,
  joinUriTail,
}                                       from './src/storageFunctions.js';
export {
  CONFIG_VERSION,
  configResourceUri,
  readConfig,
  writeConfig,
}                                       from './src/configResource.js';
export {
  // The ONE vocabulary for "where does this circle's content live" — see the module header for why
  // it lives here and what the four former copies cost.
  CIRCLE_STORAGE_POSTURES,
  CIRCLE_STORAGE_POSTURE_NAMES,
  DEFAULT_CIRCLE_STORAGE_POSTURE,
  isCircleStoragePosture,
  normaliseCircleStoragePosture,
  posturePodUriRequired,
}                                       from './src/circleStoragePosture.js';
