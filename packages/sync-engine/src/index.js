/**
 * @onderling/sync-engine — pod ↔ external-source sync engine.
 *
 * Post-Phase 5.1 (2026-05-04): the V0 `SyncEngine` + `IngestQueueSource` +
 * `LocalFolderSource` + `InMemoryBackend` + `storageConvention` were
 * deleted as a parallel implementation of `core.DataSource` /
 * the retired `core.PodStorageConvention` (2026-09-03). The substrate now ships only the
 * Folio-lifted `SyncEngine` (formerly `BidirectionalSyncEngine`) +
 * the lifted helpers (`PathMap`, `scanLocal`, `scanPod`, `diff`,
 * adapters).  The Folio-lifted `versions.js` — the LAST legacy version
 * store — was RETIRED (2026-07-10, PLAN-folio-as-file-agent)
 * onto `@onderling/versioning`: `SyncEngine` now owns one `createVersionStore`
 * per instance (Node fs backend by default) and exposes it as
 * `engine.versionStore`.  No standalone versions module / `./versions`
 * subpath remains.
 *
 * For one-shot ingest patterns (e.g. `apps/import-bridge-v0`), apps
 * write directly through any `core.DataSource` (e.g. `MemorySource` for
 * tests, `pod-client.PodClient`-wrapped for production). For
 * bidirectional sync (`apps/folio`), this `SyncEngine` is the engine.
 * For one-way live sync from a peer, use `core.protocol.LiveSyncSkill`.
 */

export { SyncEngine } from './SyncEngine.js';

// Folio-lifted helpers. PathMap accepts an injected
// `parseSharePath` hook; consumers that don't care about share folders
// pass nothing.
export { PathMap, joinRel } from './PathMap.js';
export { scanLocal } from './scanLocal.js';
export { scanPod }   from './scanPod.js';
export { diff }      from './diff.js';
export { objectDiff } from './objectDiff.js';

// γ.2's keyed-object version capture (`objectVersions.js`) was RETIRED
// (2026-07-09, PLAN-pod-versioning-history-recovery "Rewire circle"): the
// circle stores now version through the `@onderling/versioning` substrate via
// `@onderling/kring-host/objectVersionsStorage`.
