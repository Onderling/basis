/**
 * basis v2 — localStorage IO for the screen-blocks cache (δ.1).
 *
 * Wires `createScreenBlocksCache` to `window.localStorage` (or an
 * injected `storage` matching that interface for tests).  Key prefix
 * `cc.screenBlocksCache.<screenId>` matches the convention of every
 * other v2 per-id cache (`cc.circleRecipePending.<id>`, etc.).
 */

import { createScreenBlocksCache } from './screenBlocksCache.js';

const KEY_PREFIX = 'cc.screenBlocksCache.';

export function localStorageScreenBlocksCacheIo(storage = globalThis.localStorage) {
  return {
    load: async (screenId) => {
      try {
        const raw = storage?.getItem?.(KEY_PREFIX + screenId);
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    },
    save: async (screenId, blocks) => {
      try {
        storage?.setItem?.(KEY_PREFIX + screenId, JSON.stringify(blocks));
      } catch { /* quota / disabled */ }
    },
    remove: async (screenId) => {
      try {
        storage?.removeItem?.(KEY_PREFIX + screenId);
      } catch { /* ignore */ }
    },
  };
}

export function createScreenBlocksCacheLocal(storage = globalThis.localStorage) {
  return createScreenBlocksCache(localStorageScreenBlocksCacheIo(storage));
}
