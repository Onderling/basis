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

import { storageName } from '../../../basis/src/v2/storageRegister.js';   // every storage name from the one register
import { createCircleRulesPendingStore } from '../../../basis/src/v2/circleRulesPending.js';
import { makeCircleKindPendingLocalIo } from '../../../basis/src/v2/circleKindFactory.js';

const KEY_PREFIX = storageName('circleRulesPending');

/** The same SEALED io as the web's (ledger L1083: an incoming circle document), over AsyncStorage. */
export function asyncStorageCircleRulesPendingIo(storage) {
  return makeCircleKindPendingLocalIo(KEY_PREFIX, storage);
}

export function makeCircleRulesPendingStoreRN(storage) {
  return createCircleRulesPendingStore(asyncStorageCircleRulesPendingIo(storage));
}
