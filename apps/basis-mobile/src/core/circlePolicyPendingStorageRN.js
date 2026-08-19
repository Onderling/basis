/**
 * basis-mobile — AsyncStorage IO for the pending-policy cache
 * (γ-next.policy).  Mirrors web's `circlePolicyPendingStorage.js`
 * verbatim on the key shape (`cc.circlePolicyPending.<circleId>`) so a
 * future pod-sync sees one canonical key prefix across surfaces.
 *
 * Portable: `storage` is injected (no top-level AsyncStorage import)
 * so vitest exercises round-trip with a mock and the launcher screen
 * passes the real `@react-native-async-storage/async-storage` instance.
 */

import { createCirclePolicyPendingStore } from '../../../basis/src/v2/circlePolicyPending.js';

const KEY_PREFIX = 'cc.circlePolicyPending.';

export function asyncStorageCirclePolicyPendingIo(storage) {
  return {
    load: async (circleId) => {
      try {
        const raw = await storage?.getItem?.(KEY_PREFIX + circleId);
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    },
    save: async (circleId, policy) => {
      try {
        await storage?.setItem?.(KEY_PREFIX + circleId, JSON.stringify(policy));
      } catch { /* ignore */ }
    },
    remove: async (circleId) => {
      try {
        await storage?.removeItem?.(KEY_PREFIX + circleId);
      } catch { /* ignore */ }
    },
  };
}

export function makeCirclePolicyPendingStoreRN(storage) {
  return createCirclePolicyPendingStore(asyncStorageCirclePolicyPendingIo(storage));
}
