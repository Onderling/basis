/**
 * Dynamic Client Registration (RFC 7591) for Solid OIDC.
 *
 * `expo-auth-session` doesn't do DCR; Inrupt's hosted IdP rejects
 * client_id values that aren't either pre-registered, fetchable URLs,
 * or DCR-issued.  A `<scheme>://auth/callback` custom scheme is none
 * of those.
 *
 * Lifted from `apps/folio-mobile/src/auth/dcr.js` 2026-05-08.
 * Cache-key prefix is now configurable so a single device with both
 * a Folio install and a Pinboard install doesn't share registrations.
 */

const DEFAULT_KEY_PREFIX = 'oidc-dcr-client-id-';

/**
 * Hash an issuer URL into a secure-store key suffix.
 *
 * @param {string} issuer
 * @param {string} keyPrefix   — e.g. 'folio-dcr-client-id-' or 'pinboard-dcr-client-id-'.
 *                                Defaults to 'oidc-dcr-client-id-'.
 * @returns {string}
 */
function issuerKey(issuer, keyPrefix = DEFAULT_KEY_PREFIX) {
  return keyPrefix + issuer.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function resolveKeyPrefix(prefixOrAppId) {
  if (typeof prefixOrAppId !== 'string' || !prefixOrAppId) return DEFAULT_KEY_PREFIX;
  // Already a `*-dcr-client-id-` shape → use as-is.
  if (prefixOrAppId.endsWith('-dcr-client-id-')) return prefixOrAppId;
  // Bare app-id → append the canonical DCR suffix.
  return `${prefixOrAppId}-dcr-client-id-`;
}

/**
 * Build the DCR registration body per Solid-OIDC + RFC 7591.
 */
export function buildRegistrationBody({
  redirectUri,
  clientName = 'Solid OIDC client (mobile)',
  scopes = ['openid', 'webid', 'offline_access'],
}) {
  return {
    redirect_uris:              [redirectUri],
    client_name:                clientName,
    application_type:           'native',
    token_endpoint_auth_method: 'none',
    grant_types:                ['authorization_code', 'refresh_token'],
    response_types:             ['code'],
    scope:                      scopes.join(' '),
  };
}

/**
 * POST a registration request to the issuer's registration endpoint.
 */
export async function registerClient({
  discovery,
  redirectUri,
  clientName,
  scopes,
  fetchFn = globalThis.fetch,
}) {
  if (!discovery?.registrationEndpoint && !discovery?.registration_endpoint) {
    throw Object.assign(
      new Error('registerClient: discovery has no registration_endpoint'),
      { code: 'NO_REGISTRATION_ENDPOINT' },
    );
  }
  const endpoint = discovery.registrationEndpoint ?? discovery.registration_endpoint;

  const body = buildRegistrationBody({ redirectUri, clientName, scopes });

  let response;
  try {
    response = await fetchFn(endpoint, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept':       'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw Object.assign(
      new Error(`registerClient: POST ${endpoint} failed: ${err?.message ?? err}`),
      { code: 'NETWORK_ERROR', cause: err },
    );
  }

  let json;
  try {
    json = await response.json();
  } catch {
    throw Object.assign(
      new Error(`registerClient: response was not JSON (${response.status})`),
      { code: 'PARSE_ERROR', status: response.status },
    );
  }

  if (!response.ok) {
    throw Object.assign(
      new Error(`registerClient: ${response.status} ${json.error ?? ''} — ${json.error_description ?? ''}`),
      { code: 'REGISTRATION_REJECTED', status: response.status, body: json },
    );
  }

  if (typeof json.client_id !== 'string' || json.client_id.length === 0) {
    throw Object.assign(
      new Error('registerClient: response missing client_id'),
      { code: 'INVALID_RESPONSE', body: json },
    );
  }

  return {
    client_id:                 json.client_id,
    client_id_issued_at:       json.client_id_issued_at,
    client_secret:             json.client_secret,
    registration_access_token: json.registration_access_token,
    registration_client_uri:   json.registration_client_uri,
    raw:                       json,
  };
}

/**
 * Returns a saved client_id for the issuer if one is in secure-store,
 * or registers fresh, saves the result, and returns the new client_id.
 *
 * @param {object} args
 * @param {string} args.issuer
 * @param {object} args.discovery
 * @param {string} args.redirectUri
 * @param {object} args.store         expo-secure-store namespace
 * @param {string} [args.clientName]
 * @param {string[]} [args.scopes]
 * @param {string} [args.keyPrefix]   Either a bare app-id ('folio',
 *                                     'pinboard') or a full DCR-key prefix.
 * @param {(url: string, init: object) => Promise<Response>} [args.fetchFn]
 * @returns {Promise<string>}         the client_id to use
 */
export async function loadOrRegisterClient({
  issuer,
  discovery,
  redirectUri,
  store,
  clientName,
  scopes,
  keyPrefix,
  fetchFn,
  onResolve,
}) {
  const prefix = resolveKeyPrefix(keyPrefix);
  const key = issuerKey(issuer, prefix);

  const cached = await store.getItemAsync(key);
  const fromCache = typeof cached === 'string' && cached.length > 0;
  if (fromCache) {
    onResolve?.({ fromCache: true, clientId: cached });
    return cached;
  }

  const reg = await registerClient({ discovery, redirectUri, clientName, scopes, fetchFn });
  await store.setItemAsync(key, reg.client_id);
  onResolve?.({ fromCache: false, clientId: reg.client_id });
  return reg.client_id;
}

/**
 * Purge the cached client_id for an issuer.
 *
 * @param {string} issuer
 * @param {object} store
 * @param {string} [keyPrefix]   Either a bare app-id or full DCR-key prefix.
 */
export async function clearStoredClient(issuer, store, keyPrefix) {
  const prefix = resolveKeyPrefix(keyPrefix);
  const key = issuerKey(issuer, prefix);
  if (typeof store.deleteItemAsync === 'function') {
    await store.deleteItemAsync(key);
  } else if (typeof store.setItemAsync === 'function') {
    await store.setItemAsync(key, '');
  }
}

// Internal — exposed for tests.
export const _internal = { issuerKey, resolveKeyPrefix, DEFAULT_KEY_PREFIX };
