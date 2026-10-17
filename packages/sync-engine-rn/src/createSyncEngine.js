/**
 * createSyncEngine — RN-flavoured factory for a `SyncEngine`.
 *
 * Wires up the RN adapters (`fsRN` over `expo-file-system`, `hashRN`
 * over `expo-crypto`, `watcherRN` interval-poll — all from the
 * cross-platform `@onderling/sync-engine` substrate) and constructs
 * a SyncEngine.  The class itself is parameterised so apps can pass
 * their own subclass (e.g. Folio's `SyncEngine` that pre-injects
 * conflict-marker + auto-share hooks).  When no subclass is supplied,
 * the substrate's stock `SyncEngine` is used.
 *
 * Lifted from `apps/folio/src/rn/serviceFactory.js` 2026-05-08
 * (Pinboard V3 mobile = rule-of-two consumer).  The original folio
 * version hardcoded its own SyncEngine subclass; the lifted version
 * accepts that subclass via `SyncEngineClass`.
 *
 * The peer-deps (`expo-file-system`, `expo-crypto`) are NOT
 * imported here — they're peer-injected by the caller as
 * `args.FileSystem` / `args.Crypto` namespaces.  This keeps the
 * substrate free of expo-* parse-time dependencies (matters for
 * non-RN consumers under unit-test runners).
 */

import { SyncEngine as SubstrateSyncEngine } from '@onderling/sync-engine/SyncEngine';
import { createFsRN }              from '@onderling/sync-engine/adapters/fsRN';
import { createHashRN }            from '@onderling/sync-engine/adapters/hashRN';
import { createWatcherRN, DEFAULT_POLL_INTERVAL_MS } from '@onderling/sync-engine/adapters/watcherRN';

/**
 * Build a SyncEngine wired for React Native.
 *
 * @param {object} args
 * @param {object} args.podClient           an authenticated `PodClient`
 * @param {string} args.localRoot           absolute file:// URI under documentDirectory
 * @param {string} args.podRoot             pod root URI (with trailing slash)
 * @param {object} [args.identity]          AgentIdentity for auto-share
 * @param {object} [args.FileSystem]        namespace import of `expo-file-system`
 *                                            (omit when `args.adapters` is supplied)
 * @param {object} [args.Crypto]            namespace import of `expo-crypto`
 *                                            (omit when `args.adapters` is supplied)
 * @param {number} [args.pollIntervalMs]    pod poll interval
 * @param {number} [args.watcherIntervalMs] local-FS poll interval (default 10s)
 * @param {object} [args.versions]          retention policy (see SyncEngine)
 * @param {object} [args.watcher]           sha-stability + grace timings
 * @param {object} [args.adapters]          escape hatch for tests — pass
 *                                          pre-built `{ fs, hash, watcherFactory }`.
 * @param {typeof SubstrateSyncEngine} [args.SyncEngineClass]
 *                                          App-specific subclass (e.g. Folio's
 *                                          conflict-marker + auto-share variant).
 *                                          Defaults to the substrate's stock
 *                                          `SyncEngine`.
 *
 * @returns {SubstrateSyncEngine}
 */
export function createSyncEngine(args) {
  if (!args)                throw new Error('createSyncEngine: args required');
  const { podClient, localRoot, podRoot, identity, SyncEngineClass } = args;
  if (!podClient)           throw new Error('createSyncEngine: podClient required');
  if (!localRoot)           throw new Error('createSyncEngine: localRoot required');
  if (!podRoot)             throw new Error('createSyncEngine: podRoot required');

  let fs, hash, watcherFactory;
  if (args.adapters) {
    ({ fs, hash, watcherFactory } = args.adapters);
    if (!fs || !hash || !watcherFactory) {
      throw new Error('createSyncEngine: adapters must provide { fs, hash, watcherFactory }');
    }
  } else {
    if (!args.FileSystem) throw new Error('createSyncEngine: FileSystem (expo-file-system) is required (or pass adapters)');
    if (!args.Crypto)     throw new Error('createSyncEngine: Crypto (expo-crypto) is required (or pass adapters)');
    fs   = createFsRN({ FileSystem: args.FileSystem });
    hash = createHashRN({ Crypto: args.Crypto });
    watcherFactory = createWatcherRN({
      fs,
      intervalMs: args.watcherIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    });
  }

  const Cls = SyncEngineClass ?? SubstrateSyncEngine;
  return new Cls({
    podClient,
    localRoot,
    podRoot,
    identity:       identity ?? null,
    pollIntervalMs: args.pollIntervalMs,
    versions:       args.versions ?? null,
    watcher:        args.watcher ?? null,
    fs,
    hash,
    watcherFactory,
  });
}
