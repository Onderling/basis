/**
 * @onderling/kring-host — the platform-neutral kring/circle HOST substrate (repo-split W2, objective F).
 *
 * Composition LOGIC that the web AND mobile basis shells share. It depends DOWN on the kernel
 * substrates (@onderling/item-store, @onderling/item-types) and NEVER up on an app. basis becomes a skin
 * over this package. This barrel is the package's public surface; subpaths (e.g. `./circleLists`) exist for
 * consumers that want to import a single feature without the barrel.
 *
 * W2 first extraction: the circle LISTS feature (`makeCircleLists` + `LISTS_ACCEPTS_MANIFEST`), a genuine
 * leaf — its only deps were already-extracted kernel packages, and nothing else in v2 imported it.
 *
 * W3 extraction: the pure-neutral v2 leaves (zero intra-v2 deps) — circleMembers, followUp, deliveryState,
 * kringBroadcast, mappingsStore. Compat shims stay at the old `apps/basis/src/v2/<name>.js` paths.
 */
export { makeCircleLists, LISTS_ACCEPTS_MANIFEST } from './circleLists.js';

export { normalizeCircleMembers, circleMemberCount, recipientSealKeyFromMembers,
  memberFrom, memberToChatItem, memberToViewAs } from './circleMembers.js';
export { pickPromptKey, beginFollowUp, beginFormFollowUp, completeMultiFieldFollowUp, completeFollowUp } from './followUp.js';
export { createDeliveryStateMap } from './deliveryState.js';
export { kringChatMessageEvent, PERMANENT_FANOUT_REASONS, classifyFanOut, broadcastCircleFanOut } from './kringBroadcast.js';
export { WEB_MAPPINGS_DEVICE, localStorageMappingsStore } from './mappingsStore.js';

// W4 extraction: two v2 leaves untangled from their invariant-violating couplings — objectVersionsStorage
// (since consolidated onto the `@onderling/versioning` substrate; sync-engine's objectVersions is retired) and
// mappingsLoader (app-local verify gate now INJECTED; the basis shim binds it).
export { createObjectVersionsAdapter, localStorageBackend, localStorageObjectVersions, fingerprintHex } from './objectVersionsStorage.js';
export { loadVerifyMappings } from './mappingsLoader.js';

// W5 extraction: the /find-enrichment cluster (findExtras + its shared building blocks findOfferingMatches
// and hopPrompt) plus the two pure skill/hop model leaves those depend on (circleOfferings, circleHop). All
// pure-neutral: their only deps are each other + the already-extracted circleMembers leaf.
export { OFFERING_AXES, DEFAULT_OFFERING, normalizeOffering, mergeOffering, MATCH_SOURCES, buildOfferingMatches } from './circleOfferings.js';
export { MAX_HOPS, normalizeHopMode, buildHopChain, makeHopRelayRequest } from './circleHop.js';
export { findOfferingMatches, tokenize } from './findOfferingMatches.js';
export { shouldAutoSuggestHop, buildHopPromptCard, rememberDismissed, hasDismissed } from './hopPrompt.js';
export { buildFindExtras } from './findExtras.js';
