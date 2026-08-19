/**
 * basis v2 — localStorage IO for the pending-policy cache (γ-next.policy).
 *
 * Thin instantiation of the shared circle-kind pending storage
 * (`circleKindFactory.js`).  Wires `createCirclePolicyPendingStore` to
 * `window.localStorage` (or an injected `storage` for tests).  Key prefix
 * `cc.circlePolicyPending.<circleId>` is the ONLY per-kind difference and
 * matches the convention of every other circle store — DO NOT change it
 * (would orphan already-cached broadcasts on disk).
 */

import {
  createCircleKindPendingStore,
  makeCircleKindPendingLocalIo,
} from './circleKindFactory.js';

const KEY_PREFIX = 'cc.circlePolicyPending.';

export function localStorageCirclePolicyPendingIo(storage = globalThis.localStorage) {
  return makeCircleKindPendingLocalIo(KEY_PREFIX, storage);
}

export function createCirclePolicyPendingStoreLocal(storage = globalThis.localStorage) {
  return createCircleKindPendingStore(localStorageCirclePolicyPendingIo(storage));
}
