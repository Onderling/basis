export { createNeighbourhoodAgent }     from './Agent.js';
export { createNeighbourhoodCluster }   from './cluster.js';
export { buildSkills, setAddressFallbackReportHook } from './skills/index.js';
export { buildOnboardingSkills }       from './onboarding.js';
/**
 * Phase 52.9.2 / Q-B (2026-05-14) — groupMirror retired in favour of
 * the `notify-envelope` + `pseudo-pod` substrate path.
 * `wireGroupBroadcastMirror` is gone; use `wireSubstrateMirror` +
 * `buildSubstrateStack` instead.
 */
export { wireSubstrateMirror,
         attachSubstrateMirror,
         registerAgentInRegistry }     from './substrateMirror.js';
export { buildSubstrateStack }         from './lib/substrateStack.js';
