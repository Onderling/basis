/**
 * basis v2 — localStorage IO for the screen-blocks cache (δ.1).
 *
 * Wires `createScreenBlocksCache` to `window.localStorage` (or an
 * injected `storage` matching that interface for tests).  Key prefix
 * `cc.screenBlocksCache.<screenId>` matches the convention of every
 * other v2 per-id cache (`cc.circleRecipePending.<id>`, etc.).
 */

import { createScreenBlocksCache } from './screenBlocksCache.js';
import { sealedKeyValue } from './localStoreSeal.js';

const KEY_PREFIX = 'cc.screenBlocksCache.';

/**
 * SEALED AT REST (ledger L1081). The kept blocks are a page's content — appointment titles, task texts, circle names, the
 * last chat line per circle — so the values go through `sealedKeyValue`: sealed with the device's content key, the keys
 * legible. Before the key exists a write is refused (the cache's save swallows it; the next save after boot writes) and a
 * read answers "no cache": a sealed value cannot be opened yet, and is never handed on as if it were blocks. A plain
 * value from before reads once and is sealed at the next write. The phone's IO (`screenBlocksCacheStorageRN.js`) is the
 * same over AsyncStorage.
 */
export function sealedScreenBlocksCacheIo(storage) {
  const kv = sealedKeyValue(storage, { name: 'the page blocks cache' });
  return {
    load: async (screenId) => {
      try {
        const raw = await kv.getItem(KEY_PREFIX + screenId);
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }   // not openable yet (no key), corrupt, or not JSON: no cache
    },
    save: async (screenId, blocks) => {
      try { await kv.setItem(KEY_PREFIX + screenId, JSON.stringify(blocks)); } catch { /* quota / disabled / no content key yet */ }
    },
    remove: async (screenId) => {
      try { await kv.removeItem(KEY_PREFIX + screenId); } catch { /* ignore */ }
    },
  };
}

export function localStorageScreenBlocksCacheIo(storage = globalThis.localStorage) {
  return sealedScreenBlocksCacheIo(storage);
}

export function createScreenBlocksCacheLocal(storage = globalThis.localStorage) {
  return createScreenBlocksCache(localStorageScreenBlocksCacheIo(storage));
}
