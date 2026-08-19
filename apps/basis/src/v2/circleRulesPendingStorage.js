/**
 * basis v2 — localStorage IO for the pending-rules cache (γ-next.rules).
 *
 * Thin instantiation of the shared circle-kind pending storage
 * (`circleKindFactory.js`).  Wires `createCircleRulesPendingStore` to
 * `window.localStorage` (or an injected `storage` for tests).  Key prefix
 * `cc.circleRulesPending.<circleId>` is the ONLY per-kind difference and
 * matches the convention of every other circle store — DO NOT change it
 * (would orphan already-cached broadcasts on disk).
 */

import {
  createCircleKindPendingStore,
  makeCircleKindPendingLocalIo,
} from './circleKindFactory.js';

const KEY_PREFIX = 'cc.circleRulesPending.';

export function localStorageCircleRulesPendingIo(storage = globalThis.localStorage) {
  return makeCircleKindPendingLocalIo(KEY_PREFIX, storage);
}

export function createCircleRulesPendingStoreLocal(storage = globalThis.localStorage) {
  return createCircleKindPendingStore(localStorageCircleRulesPendingIo(storage));
}
