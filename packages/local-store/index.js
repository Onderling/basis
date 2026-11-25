/**
 * @onderling/local-store — local-first storage substrate.
 *
 * **Layer:** substrate. Cross-platform.
 *
 * Lifted from `apps/pinboard/src/lib/{CachingDataSource, SyncCadence,
 * Settings}.js` 2026-05-08 (Tasks V1 = rule-of-two consumer; the
 * pattern was originally written for Pinboard V1 Phase 4).
 *
 * Three exports:
 *
 *   - `CachingDataSource` — the local-first DataSource that wraps an
 *     optional inner (pod-backed) DataSource with a Map cache + write
 *     queue + bulk-sync-on-attach.
 *
 *
 *   - `createSettingsModule({appId, sharedFields, deviceFields,
 *     defaults})` — factory that returns app-specific
 *     `loadSettings`, `saveSettings`, `updateSettings` functions
 *     pre-bound with the app's path prefix + field schema. Apps
 *     export the resulting functions as their public Settings API.
 */

export { CachingDataSource } from './src/CachingDataSource.js';
// The one format a persist adapter stores a Map in, and the gate that never saves over a snapshot it could not read.
export { mapSnapshotGate, readMapSnapshot, writeMapSnapshot, MAP_SNAPSHOT_V } from './src/mapSnapshot.js';
// The stores holding data this build could not read, for the one notice every shell paints.
export { reportNotReadable, clearNotReadable, notReadableStores, onNotReadableChange, resetNotReadableStores, STORE_KINDS } from './src/notReadableStores.js';
// The saves waiting on a debounce, made all at once when the page or the app goes away.
export { trackPendingSave, flushPendingSaves, pendingSaveCount } from './src/pendingSaves.js';


export {
  createSettingsModule,
} from './src/Settings.js';
export { sealedPersist } from './src/sealedPersist.js';
