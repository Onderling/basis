// @onderling/pod-client/sealing — opt-in at-rest envelope encryption for pod resources.
export {
  recipientId, generateKeypair, generateGroupKey, isSealed,
  seal, open, sealWithGroupKey, openWithGroupKey,
  makeSealer, makeOpener, makeGroupSealer, makeGroupOpener,
  sealingPublicKeyFromNetworkKey, sealingKeyPairFromNetworkKey,
} from './envelope.js';
export { createSealedPodClient, recipientStrategy, groupKeyStrategy } from './SealedPodClient.js';
export {
  buildGroupKeyResource, unwrapGroupKey, grantMember, rotateGroupKeyResource,
  unwrapGroupKeyVersion, readableGroupKeys, openSealedAcrossVersions,   // Phase 3 — historic-key retention
  banFromHistory,   // removal policy — hard-ban re-wrap of retained history (excludes the departed)
} from './groupKeyResource.js';
export {
  createSealedIndex, upsertEntry, removeEntry, getEntry, decodePseudonym,
  queryIndex, semanticQuery, serializeIndex, parseIndex, shardKeyFor,
} from './sealedIndex.js';
export {
  KEY_EVENT_KIND, buildKeyEvent, establishKeyEvent, rotateKeyEvent,   // key establishment + rotation carried in the log
  foldKeyEvents, readKeyChain, currentGroupKey, openAcrossKeyChain,   // fold(log) → key chain; read/open across versions
  keyIdOf, collapseKeyEvents, MAX_KEYS_PER_VERSION,                   // the ONE collapse rule the store and the fold share
} from './keyEventsLog.js';
export { createControlAgent } from './controlAgent.js';
export { createCanonicalShare } from './canonicalShare.js';   // objective L — revocable canonical cross-circle share
export {
  createResourceKeyGrant, openGrantedResource, resourceScope,
} from './resourceKeyGrant.js';
export { createPodKeyStore, readGroupKey } from './podKeyStore.js';
export { createMemberSealingIdentity } from './memberIdentity.js';
export { resolveCircleStorage, circleStorageClient } from './resolveCircleStorage.js';
export { podStorageBackend } from './podStorageBackend.js';   // adapt a Solid pod to the blind StorageBackend port
export {
  messageRef, tsFromRef,   // the ONE per-message range-queryable row key convention
  writeSealedMessage, readSealedMessage, readSealedMessagesSince,   // sealed circle-log write/read over a StorageBackend
} from './sealedMessageLog.js';
export {
  SEAL_SCHEMES, chooseSealScheme, resolveSealStrategy,   // the one seal resolver — scheme chosen by policy
  sealForAudience, openSealedEnvelope,
} from './sealResolver.js';
