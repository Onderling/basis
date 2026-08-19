/**
 * basis v2 — localStorage IO for the pending-recipe cache (γ-next.recipe).
 *
 * Thin instantiation of the shared circle-kind pending storage
 * (`circleKindFactory.js`).  Wires `createCircleRecipePendingStore` to
 * `window.localStorage` (or an injected `storage` for tests).  Key prefix
 * `cc.circleRecipePending.<circleId>` is the ONLY per-kind difference and
 * matches the convention of every other circle store — DO NOT change it
 * (would orphan already-cached broadcasts on disk).
 */

import {
  createCircleKindPendingStore,
  makeCircleKindPendingLocalIo,
} from './circleKindFactory.js';

const KEY_PREFIX = 'cc.circleRecipePending.';

export function localStorageCircleRecipePendingIo(storage = globalThis.localStorage) {
  return makeCircleKindPendingLocalIo(KEY_PREFIX, storage);
}

export function createCircleRecipePendingStoreLocal(storage = globalThis.localStorage) {
  return createCircleKindPendingStore(localStorageCircleRecipePendingIo(storage));
}
