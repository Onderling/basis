/**
 * serviceFactory — convenience for building a SyncEngine on RN.
 *
 * **2026-05-08:** the implementation lifted into the new
 * `@onderling/sync-engine-rn` substrate (Pinboard V3 mobile = rule-of-two
 * consumer). This file is now a thin shim that pre-binds Folio's
 * `SyncEngine` subclass so callers don't have to.
 *
 * Folio's subclass adds conflict-marker writing + auto-share hooks
 * (see `apps/folio/src/SyncEngine.js`); other consumers of the
 * substrate (Pinboard V3 mobile) call the substrate's `createSyncEngine`
 * directly without `SyncEngineClass` (and get the substrate's stock
 * `SyncEngine`).
 */

import { createSyncEngine as substrateCreateSyncEngine } from '@onderling/sync-engine-rn';
import { SyncEngine as FolioSyncEngine } from '../SyncEngine.js';

/**
 * Build a SyncEngine wired for React Native, using Folio's subclass.
 *
 * Same args as the substrate's `createSyncEngine`; this shim adds
 * `SyncEngineClass: FolioSyncEngine`.
 */
export function createSyncEngine(args) {
  return substrateCreateSyncEngine({
    ...args,
    SyncEngineClass: FolioSyncEngine,
  });
}
