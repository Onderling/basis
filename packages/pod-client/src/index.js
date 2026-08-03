/**
 * @onderling/pod-client — high-level pod read/write/list + conflict
 * detection + tombstone-backed delete-scope. Public API.
 *
 * **Layer: SDK foundation.** Substrates and apps compose primitives from this
 * package; substrates MUST NOT reinvent them (no parallel HTTP fetch, no
 * homebrew tombstone store, no in-substrate merge contracts), apps MUST
 * justify direct use in their README. See
 * `Project Files/conventions/architectural-layering.md`.
 *
 * Scaffolded by A5a; A5b1 added `CapabilityAuth` + `SolidOidcAuth`;
 * A5b2 added `PodClient`. A6 added `TombstoneStore` + per-platform adapters.
 * A7 added `ConflictResolver`.
 */

export {
  PodClientError,
  AuthError,
  CapabilityError,
  NotFoundError,
  ConflictError,
  NetworkError,
  DeviceUnreachableError,
  PayloadTooLargeError,
  PolicyError,
  MalformedResourceError,
  EncryptionError,
  ConventionError,
  SharingUnsupportedError,
  mapSourceCode,
} from './Errors.js';

// Pod storage adapter + portable archive export/import (extracted from
// @onderling/core — the concrete Solid pod DataSource and its backup pair).
export { SolidPodSource } from './SolidPodSource.js';
// sealed, pod-backed `core.DataSource` (SolidPodSource + createSealedPodClient → read/write/delete/list),
// so a per-circle CircleItemStore can persist to a real pod with content sealed at rest under the group key.
export { createSealedPodDataSource, podGroupPrefix } from './sealedPodDataSource.js';
export { PodExporter }    from './PodExporter.js';
export { PodImporter }    from './PodImporter.js';

export { Auth } from './Auth/Auth.js';
export { CapabilityAuth, DEFAULT_MAX_BODY_BYTES } from './Auth/CapabilityAuth.js';
export { SolidOidcAuth }  from './Auth/SolidOidcAuth.js';
export { PodClient }      from './PodClient.js';

// R2b.0 — pod-SIDE, scope-aware verifier for `PodCapabilityToken`s (the
// enforcing half of pod credential delegation) + its owner-side revocation
// ledger. Deny-by-default; clone of blob-gateway's capabilityVerifier retargeted
// from skill-scoped to path-scoped. See PLAN-companion-node-remote-hosting §R2b.
export { createPodTokenVerifier, scopeForRequest } from './Auth/PodTokenVerifier.js';
export { PodTokenRegistry } from './Auth/PodTokenRegistry.js';

// Conflict detection + resolution.
export { ConflictResolver } from './ConflictResolver.js';

// Phase 52.16 (2026-05-14) — ACP/WAC sharing primitives. The main
// API is `client.sharing.{grant, revoke, list, capabilities}` on a
// PodClient instance; the factory + test seam are exposed for
// substrate consumers that want to wire sharing without a full
// PodClient.
export { createClientSharing, _setInruptModuleForTests } from './sharing/index.js';
export { probeCapabilities, parseSharingLinkHeader, parseAcrUrl, discoverAcrUrl } from './sharing/capabilities.js';
// Direct ACP `.acr` writer — ENFORCING ACP sharing on ACP pods (Inrupt ESS /
// CSS-ACP), where `universalAccess` no-ops. `setResourceAccess` routes ACP
// resources here automatically; exposed for advanced/substrate use.
export { writeAcpAcr }                                   from './sharing/acpWriter.js';
// Declarative, best-effort access policy for a single resource (public-read /
// owner-write / admin-write), composed over `client.sharing.*`. Used to give
// the commons + registry pod resources their real-pod access posture.
export { setResourceAccess }                             from './sharing/setResourceAccess.js';

// Opt-in at-rest envelope encryption (recipient-wrap + group-key modes). Node-side (node:crypto).
export {
  recipientId, generateKeypair, generateGroupKey, isSealed,
  seal, open, sealWithGroupKey, openWithGroupKey,
  makeSealer, makeOpener, makeGroupSealer, makeGroupOpener,
  sealingPublicKeyFromNetworkKey, sealingKeyPairFromNetworkKey,   // out-of-circle: derive a sealing key from a published network key
  createSealedPodClient, recipientStrategy, groupKeyStrategy,
  buildGroupKeyResource, unwrapGroupKey, grantMember, rotateGroupKeyResource,
  createSealedIndex, upsertEntry, removeEntry, getEntry, decodePseudonym,
  queryIndex, semanticQuery, serializeIndex, parseIndex, shardKeyFor,
  createControlAgent, createCanonicalShare, createPodKeyStore, readGroupKey, createMemberSealingIdentity,
  KEY_EVENT_KIND, buildKeyEvent, establishKeyEvent, rotateKeyEvent,   // key-events in the log — self-distributing group key + rotation (no pod)
  foldKeyEvents, readKeyChain, currentGroupKey, openAcrossKeyChain,
  resolveCircleStorage, circleStorageClient,
  podStorageBackend,   // adapt a Solid pod to the blind StorageBackend port (ciphertext-only; seal is the gate)
  messageRef, tsFromRef, writeSealedMessage, readSealedMessage, readSealedMessagesSince,   // Phase-3 sealed circle-log over a StorageBackend
  SEAL_SCHEMES, chooseSealScheme, resolveSealStrategy, sealForAudience, openSealedEnvelope,   // the one seal resolver
} from './sealing/index.js';

// grants-over-Peer — ONE grant surface (out-of-circle share + task mandate) over the single `Peer`
// (connectivity Phase 4 §4). A thin façade composing PodCapabilityToken (broker default) / resourceKeyGrant
// (CEK offline) / TaskGrantManager (mandate) + the seal audience — no new crypto.
export {
  createGrantsOverPeer, chooseGrantMode, GRANT_MODE, serializeGrants, hydrateGrants,
  assertScopedScheme, SCOPED_SEAL_SCHEMES,   // a grant may never extend a group-key audience
} from './grants/index.js';

// Identity-on-pod (extracted from @onderling/core — Track B / identity-pod-schema).
// On-pod identity store, vault→pod migration, and the pod↔vault identity
// sync engine. These operate ON a pod, so they live at the SDK pod layer;
// AgentIdentity / Bootstrap / KeyRotation (kernel identity) stay in @onderling/core.
export { IdentityPodStore } from './identity/IdentityPodStore.js';
export { IdentitySync, vaultCacheKeyFor, resourcePathFromCacheKey } from './identity/IdentitySync.js';
export { migrateVaultToPod } from './identity/migrateVaultToPod.js';

// Delete-scope primitive (TombstoneStore + per-platform adapters).
export { TombstoneStore }         from './TombstoneStore.js';
export { MemoryTombstones }       from './tombstones/MemoryTombstones.js';
export { IndexedDBTombstones }    from './tombstones/IndexedDBTombstones.js';
export { AsyncStorageTombstones } from './tombstones/AsyncStorageTombstones.js';
export { FileTombstones }         from './tombstones/FileTombstones.js';
