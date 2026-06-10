/**
 * @canopy/pod-client — high-level pod read/write/list + conflict
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
  PolicyError,
  MalformedResourceError,
  EncryptionError,
  ConventionError,
  SharingUnsupportedError,
  mapSourceCode,
} from './Errors.js';

export { Auth } from './Auth/Auth.js';
export { CapabilityAuth } from './Auth/CapabilityAuth.js';
export { SolidOidcAuth }  from './Auth/SolidOidcAuth.js';
export { PodClient }      from './PodClient.js';

// A7 — Conflict detection + resolution.
export { ConflictResolver } from './ConflictResolver.js';

// Phase 52.16 (2026-05-14) — ACP/WAC sharing primitives. The main
// API is `client.sharing.{grant, revoke, list, capabilities}` on a
// PodClient instance; the factory + test seam are exposed for
// substrate consumers that want to wire sharing without a full
// PodClient.
export { createClientSharing, _setInruptModuleForTests } from './sharing/index.js';
export { probeCapabilities, parseSharingLinkHeader }     from './sharing/capabilities.js';

// Opt-in at-rest envelope encryption (recipient-wrap + group-key modes). Node-side (node:crypto).
export {
  recipientId, generateKeypair, generateGroupKey, isSealed,
  seal, open, sealWithGroupKey, openWithGroupKey,
  makeSealer, makeOpener, makeGroupSealer, makeGroupOpener,
} from './sealing/index.js';

// A6 — Delete-scope primitive (TombstoneStore + per-platform adapters).
export { TombstoneStore }         from './TombstoneStore.js';
export { MemoryTombstones }       from './tombstones/MemoryTombstones.js';
export { IndexedDBTombstones }    from './tombstones/IndexedDBTombstones.js';
export { AsyncStorageTombstones } from './tombstones/AsyncStorageTombstones.js';
export { FileTombstones }         from './tombstones/FileTombstones.js';
