/**
 * basis-mobile — AsyncStorage IO for the screen-blocks cache (δ.1).
 *
 * Mirrors web's `screenBlocksCacheStorage.js` verbatim on the key shape
 * (`cc.screenBlocksCache.<screenId>`) so a future pod-sync sees one
 * canonical key prefix across surfaces.
 *
 * Portable: `storage` is injected (no top-level AsyncStorage import) so
 * vitest exercises round-trip with a mock and the launcher screen passes
 * the real `@react-native-async-storage/async-storage` instance.
 */

import { createScreenBlocksCache } from '../../../basis/src/v2/screenBlocksCache.js';
import { sealedScreenBlocksCacheIo } from '../../../basis/src/v2/screenBlocksCacheStorage.js';

/** The same SEALED IO as the web's (ledger L1081: the kept blocks are a page's content), over AsyncStorage. */
export function asyncStorageScreenBlocksCacheIo(storage) {
  return sealedScreenBlocksCacheIo(storage);
}

export function makeScreenBlocksCacheRN(storage) {
  return createScreenBlocksCache(asyncStorageScreenBlocksCacheIo(storage));
}
