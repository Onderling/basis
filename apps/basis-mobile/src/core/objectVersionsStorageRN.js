/**
 * basis-mobile v2 — AsyncStorage-backed `versions` adapter for the
 * shared circle stores (γ.2 / Phase 9; consolidated onto `@onderling/versioning`
 * per plans/PLAN-pod-versioning-history-recovery.md "Rewire circle").
 *
 * Mirror of web's `localStorageObjectVersions`: the shared factory
 * (`createObjectVersionsAdapter`, kring-host) composes the versioning
 * substrate; this module only supplies the concrete StorageBackend. We
 * REUSE `createAsBackend` (the pseudo-pod AsyncStorage backend the circle
 * pods already use) instead of inventing another AsyncStorage IO — it
 * already speaks the `{get, put, delete, list(prefix)}` contract
 * (`getAllKeys`-based list) the version store needs.
 *
 * Key shape — logical (backend-level) keys are VERBATIM with web:
 *   `cc.versions2.<storeName>/<encodeURIComponent(circleId)>/<ts>`
 * AsyncStorage physically prefixes them with the backend scope (`ccv:`),
 * which keeps version records out of the circle pods' `pp:` namespace.
 * Legacy `cc.versions.<storeName>.<circleId>` slot keys are ignored (no
 * users; no migration).
 */

import { createObjectVersionsAdapter } from '@onderling/kring-host/objectVersionsStorage';
import { createAsBackend } from '@onderling/react-native/pseudo-pod-adapter';

/** AsyncStorage scope for circle version history (disjoint from `pp:`). */
export const VERSIONS_AS_SCOPE = 'ccv';

/**
 * Compose the shared adapter factory with an AsyncStorage StorageBackend.
 *
 * @param {string} storeName        e.g. 'policy' / 'recipe' / 'rules'
 * @param {object} storage          AsyncStorage instance (or a test double
 *                                  with getItem/setItem/removeItem/getAllKeys)
 * @param {object} [retention]      `{perKey?:number}` — defaults to substrate (50)
 * @returns {{capture: Function, list: Function, restore: Function}}
 */
export function asyncStorageObjectVersions(storeName, storage, retention) {
  return createObjectVersionsAdapter({
    storeName,
    backend: createAsBackend({ AsyncStorage: storage, scope: VERSIONS_AS_SCOPE }),
    retention,
  });
}
