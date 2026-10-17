/**
 * dcr — re-export shim around `@onderling/oidc-session-rn`'s DCR helpers.
 *
 * **2026-05-08:** the implementation moved to
 * `@onderling/oidc-session-rn` (Pinboard V3 Phase 40.3 — rule-of-two
 * consumer). This file is a thin shim that pre-binds
 * `keyPrefix: 'folio'` so the legacy DCR cache keys
 * (`folio-dcr-client-id-<host>`) are unchanged.
 */

import {
  loadOrRegisterClient as substrateLoadOrRegisterClient,
  registerClient as substrateRegisterClient,
  buildRegistrationBody as substrateBuildRegistrationBody,
  clearStoredClient as substrateClearStoredClient,
  _dcrInternal,
} from '@onderling/oidc-session-rn';

/**
 * Pre-binds `keyPrefix: 'folio'` so existing folio-mobile calls keep
 * the legacy `folio-dcr-client-id-<host>` cache keys.
 */
export async function loadOrRegisterClient(args) {
  return substrateLoadOrRegisterClient({ keyPrefix: 'folio', ...args });
}

/**
 * Pre-binds `keyPrefix: 'folio'` similarly.
 */
export async function clearStoredClient(issuer, store) {
  return substrateClearStoredClient(issuer, store, 'folio');
}

export const registerClient          = substrateRegisterClient;
export const buildRegistrationBody   = substrateBuildRegistrationBody;

/**
 * Internal — kept for tests.  Pre-bind to the folio prefix.
 */
export const _internal = {
  issuerKey: (issuer) => _dcrInternal.issuerKey(issuer, _dcrInternal.resolveKeyPrefix('folio')),
};
