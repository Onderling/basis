/**
 * basis-mobile — AsyncStorage IO for the pending-rules cache
 * (γ-next.rules).  Mirrors web's `circleRulesPendingStorage.js`
 * verbatim on the key shape (`cc.circleRulesPending.<circleId>`) so a
 * future pod-sync sees one canonical key prefix across surfaces.
 *
 * Portable: `storage` is injected (no top-level AsyncStorage import)
 * so vitest exercises round-trip with a mock and the launcher screen
 * passes the real `@react-native-async-storage/async-storage` instance.
 */

import { createCircleRulesPendingStore } from '../../../basis/src/v2/circleRulesPending.js';

const KEY_PREFIX = 'cc.circleRulesPending.';

export function asyncStorageCircleRulesPendingIo(storage) {
  return {
    load: async (circleId) => {
      try {
        const raw = await storage?.getItem?.(KEY_PREFIX + circleId);
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    },
    save: async (circleId, rulesDoc) => {
      try {
        await storage?.setItem?.(KEY_PREFIX + circleId, JSON.stringify(rulesDoc));
      } catch { /* ignore */ }
    },
    remove: async (circleId) => {
      try {
        await storage?.removeItem?.(KEY_PREFIX + circleId);
      } catch { /* ignore */ }
    },
  };
}

export function makeCircleRulesPendingStoreRN(storage) {
  return createCircleRulesPendingStore(asyncStorageCircleRulesPendingIo(storage));
}
