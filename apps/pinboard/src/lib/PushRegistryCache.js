/**
 * PushRegistryCache — Pinboard V2 Phase 29.3 (2026-05-07).
 *
 * Persist a `PushRegistry`'s snapshot to the device-local push store a
 * shell hands in (`{read, write}`), so a restart keeps the subscriptions.
 * That store is never synced: not to a pod, not to a sibling, not into a
 * backup that leaves the device.
 *
 *   - `load({dataSource})`          — read the blob; build a fresh
 *                                     `PushRegistry` from it.
 *   - `attach({registry, dataSource})` — install onChange hook so
 *                                     every add/remove writes through.
 *   - `bootstrap({dataSource})`     — load + attach combined.
 *
 * Storage path: `mem://pinboard/push-subscriptions.json`.
 *
 * Persistence semantics:
 * - The whole `byWebid` snapshot is mirrored.
 * - Subscriptions ARE secrets (the endpoint + encrypted-key pair
 *   lets the holder wake the device), which is why they stay on it.
 */

import { PushRegistry } from './PushRegistry.js';

const PUSH_PATH = 'mem://pinboard/push-subscriptions.json';

async function load({ dataSource } = {}) {
  if (!dataSource?.read) throw new TypeError('PushRegistryCache.load: dataSource required');
  const reg = new PushRegistry();
  let raw;
  try { raw = await dataSource.read(PUSH_PATH); } catch { raw = null; }
  if (raw == null) return reg;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object') reg.loadSnapshot(parsed);
  } catch { /* keep empty */ }
  return reg;
}

function attach({ registry, dataSource } = {}) {
  if (!registry) throw new TypeError('PushRegistryCache.attach: registry required');
  if (!dataSource?.write) throw new TypeError('PushRegistryCache.attach: dataSource.write required');

  const flush = () => {
    try {
      void dataSource.write(PUSH_PATH, JSON.stringify(registry.snapshot())).catch(() => {});
    } catch { /* persistence is best-effort */ }
  };
  registry.setOnChange(flush);

  return function detach() {
    if (registry.setOnChange) registry.setOnChange(null);
  };
}

async function bootstrap(args) {
  const registry = await load(args);
  const detach   = attach({ ...args, registry });
  return { registry, detach };
}

export const PushRegistryCache = Object.freeze({ load, attach, bootstrap });
export const PUSH_REGISTRY_STORAGE_PATH = PUSH_PATH;
