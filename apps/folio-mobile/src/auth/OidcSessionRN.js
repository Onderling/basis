/**
 * OidcSessionRN — re-export shim around `@onderling/oidc-session-rn`.
 *
 * **2026-05-08:** the implementation moved to the new
 * `@onderling/oidc-session-rn` substrate (Pinboard V3 Phase 40.3 — rule
 * of two consumer). This file is now a thin shim so existing
 * `import { OidcSessionRN, SECURE_STORE_KEYS }` paths in
 * folio-mobile keep working without source changes elsewhere in the
 * app.
 *
 * The wrapped class pre-binds `appId: 'folio'` so the legacy
 * `folio-oidc-*` storage keys stay stable — existing user vaults
 * resolve unchanged.
 */

import {
  OidcSessionRN as BaseOidcSessionRN,
  buildSecureStoreKeys,
} from '@onderling/oidc-session-rn';

/**
 * Folio-flavoured `OidcSessionRN` — pre-binds `appId: 'folio'` so
 * the legacy storage keys are preserved for users with existing
 * sign-ins.  Other apps (Pinboard V3 mobile) instantiate
 * `BaseOidcSessionRN` directly with their own appId.
 */
export class OidcSessionRN extends BaseOidcSessionRN {
  constructor({ store } = {}) {
    super({ store, appId: 'folio' });
  }
}

/**
 * Legacy export — folio-mobile callers read this as a frozen
 * constant rather than instantiating `OidcSessionRN({appId})`.
 * Continues to point at the canonical 'folio' key set.
 */
export const SECURE_STORE_KEYS = buildSecureStoreKeys('folio');
