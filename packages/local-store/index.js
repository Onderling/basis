/**
 * @onderling/local-store — local-first storage substrate.
 *
 * **Layer:** substrate. Cross-platform.
 *
 * Lifted from `apps/stoop/src/lib/{CachingDataSource, SyncCadence,
 * Settings}.js` 2026-05-08 (Tasks V1 = rule-of-two consumer; the
 * pattern was originally written for Stoop V1 Phase 4).
 *
 * Three exports:
 *
 *   - `CachingDataSource` — the local-first DataSource that wraps an
 *     optional inner (pod-backed) DataSource with a Map cache + write
 *     queue + bulk-sync-on-attach.
 *
 *   - `SyncCadence` — foreground-only poll cadence helper.
 *
 *   - `createSettingsModule({appId, sharedFields, deviceFields,
 *     defaults})` — factory that returns app-specific
 *     `loadSettings`, `saveSettings`, `updateSettings` functions
 *     pre-bound with the app's path prefix + field schema. Apps
 *     export the resulting functions as their public Settings API.
 */

export { CachingDataSource } from './src/CachingDataSource.js';

export { SyncCadence } from './src/SyncCadence.js';

export {
  createSettingsModule,
} from './src/Settings.js';
export { sealedPersist } from './src/sealedPersist.js';
