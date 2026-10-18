/**
 * OidcSessionRN — Solid OIDC session for React Native.
 *
 * Persists the post-OIDC-dance tokens to a `SecureStore`-shaped store
 * (`expo-secure-store` is the canonical impl) and exposes the same
 * interface that `@onderling/pod-client`'s `SolidOidcAuth` consumes:
 *
 *   - `isAuthenticated() → boolean`
 *   - `getAuthenticatedFetch() → fetch` (bearer-token wrapper, with
 *      transparent refresh on 401 + pro-active refresh on expiry)
 *   - `webid` (string or null)
 *   - `logout()` (clears tokens)
 *   - `restoreFromVault({ onWarning? }) → Promise<boolean>`
 *
 * **Why no Inrupt Node lib:** `@inrupt/solid-client-authn-node` pulls
 * in dozens of Node built-ins that don't exist on RN. The mobile flow
 * runs the OIDC dance via `expo-auth-session` (see `oidcSignIn.js`)
 * and only needs the resulting access token + a fetch wrapper that
 * injects it. No DPoP / JWT-binding for v0 — bearer is sufficient
 * against `storage.inrupt.com` (same as web SDKs). Future work can
 * layer DPoP via `@inrupt/solid-client-authn-browser` if needed.
 *
 * **Storage key prefix:** the canonical apps each have their own —
 * folio uses `folio-oidc-*`, Pinboard uses `pinboard-oidc-*`. This is
 * configurable via the `appId` constructor arg so a single device
 * running both apps doesn't get its keys clobbered.
 *
 * Lifted from `apps/folio-mobile/src/auth/OidcSessionRN.js` 2026-05-08
 * (Pinboard V3 Phase 40.3). Folio's static keys stay stable for migration:
 * `appId: 'folio'` produces the legacy `folio-oidc-*` keys.
 */

export const DEFAULT_APP_ID = 'oidc';

/**
 * Build the secure-store key set for an app.  Keys must satisfy
 * expo-secure-store's `[A-Za-z0-9._-]+` pattern.
 *
 * @param {string} appId  Short string used as a key prefix.
 *                          Examples: 'folio', 'pinboard'.
 * @returns {{
 *   ACCESS_TOKEN: string,
 *   REFRESH_TOKEN: string,
 *   ID_TOKEN: string,
 *   EXPIRES_AT: string,
 *   ISSUER: string,
 *   WEBID: string,
 *   CLIENT_ID: string,
 * }}
 */
export function buildSecureStoreKeys(appId = DEFAULT_APP_ID) {
  if (typeof appId !== 'string' || !/^[A-Za-z0-9._-]+$/.test(appId)) {
    throw new Error(`buildSecureStoreKeys: appId must match [A-Za-z0-9._-]+, got ${JSON.stringify(appId)}`);
  }
  return Object.freeze({
    ACCESS_TOKEN:  `${appId}-oidc-access-token`,
    REFRESH_TOKEN: `${appId}-oidc-refresh-token`,
    ID_TOKEN:      `${appId}-oidc-id-token`,
    EXPIRES_AT:    `${appId}-oidc-expires-at`,
    ISSUER:        `${appId}-oidc-issuer`,
    WEBID:         `${appId}-oidc-webid`,
    CLIENT_ID:     `${appId}-oidc-client-id`,
  });
}

/**
 * @typedef {object} TokenSet
 * @property {string}  accessToken
 * @property {string}  [refreshToken]
 * @property {string}  [idToken]
 * @property {number}  [expiresIn]   seconds from now
 * @property {number}  [expiresAt]   unix-ms (alternative to expiresIn)
 * @property {string}  [issuer]
 * @property {string}  [webid]
 * @property {string}  [clientId]
 */

/**
 * @typedef {object} SecureStore
 * @property {(key: string) => Promise<string|null>} getItemAsync
 * @property {(key: string, value: string) => Promise<void>} setItemAsync
 * @property {(key: string) => Promise<void>} deleteItemAsync
 */

export class OidcSessionRN {
  /** @type {SecureStore} */ #store;
  /** @type {ReturnType<buildSecureStoreKeys>} */ #keys;

  /** @type {string|null} */ #accessToken  = null;
  /** @type {string|null} */ #refreshToken = null;
  /** @type {string|null} */ #idToken      = null;
  /** @type {number|null} */ #expiresAt    = null;
  /** @type {string|null} */ #issuer       = null;
  /** @type {string|null} */ #webid        = null;
  /** @type {string|null} */ #clientId     = null;

  /**
   * @param {object} args
   * @param {SecureStore} args.store  Typically the namespace import of
   *                                   `expo-secure-store`.
   * @param {string} [args.appId]     Storage-key prefix.  Examples:
   *                                   'folio' (legacy), 'pinboard' (new).
   *                                   Defaults to 'oidc'.
   */
  constructor({ store, appId = DEFAULT_APP_ID } = {}) {
    if (!store) throw new Error('OidcSessionRN: store required');
    if (typeof store.getItemAsync    !== 'function')
      throw new Error('OidcSessionRN: store.getItemAsync must be a function');
    if (typeof store.setItemAsync    !== 'function')
      throw new Error('OidcSessionRN: store.setItemAsync must be a function');
    if (typeof store.deleteItemAsync !== 'function')
      throw new Error('OidcSessionRN: store.deleteItemAsync must be a function');
    this.#store = store;
    this.#keys  = buildSecureStoreKeys(appId);
  }

  /** Snapshot of the storage keys this instance reads/writes. */
  get storageKeys() { return this.#keys; }

  /**
   * Adopt a fresh token set (e.g. from `expo-auth-session.exchangeCodeAsync`)
   * and persist to secure storage.
   *
   * @param {TokenSet} tokens
   */
  async adoptTokens(tokens) {
    if (!tokens || typeof tokens !== 'object') {
      throw new Error('OidcSessionRN.adoptTokens: tokens object required');
    }
    if (typeof tokens.accessToken !== 'string' || tokens.accessToken.length === 0) {
      throw new Error('OidcSessionRN.adoptTokens: accessToken required');
    }
    this.#accessToken  = tokens.accessToken;
    this.#refreshToken = tokens.refreshToken ?? this.#refreshToken ?? null;
    this.#idToken      = tokens.idToken      ?? this.#idToken      ?? null;
    if (typeof tokens.expiresAt === 'number') {
      this.#expiresAt = tokens.expiresAt < 1e12 ? tokens.expiresAt * 1000 : tokens.expiresAt;
    } else if (typeof tokens.expiresIn === 'number') {
      this.#expiresAt = Date.now() + tokens.expiresIn * 1000;
    }
    if (typeof tokens.issuer   === 'string' && tokens.issuer.length   > 0) this.#issuer   = tokens.issuer;
    if (typeof tokens.webid    === 'string' && tokens.webid.length    > 0) this.#webid    = tokens.webid;
    if (typeof tokens.clientId === 'string' && tokens.clientId.length > 0) this.#clientId = tokens.clientId;

    await this.#persist();
  }

  /**
   * Read previously-stored tokens back into memory.
   *
   * @param {object} [opts]
   * @param {(msg: string) => void} [opts.onWarning]
   * @returns {Promise<boolean>}
   */
  async restoreFromVault({ onWarning } = {}) {
    try {
      this.#accessToken  = await this.#store.getItemAsync(this.#keys.ACCESS_TOKEN);
      this.#refreshToken = await this.#store.getItemAsync(this.#keys.REFRESH_TOKEN);
      this.#idToken      = await this.#store.getItemAsync(this.#keys.ID_TOKEN);
      const exp          = await this.#store.getItemAsync(this.#keys.EXPIRES_AT);
      this.#expiresAt    = exp ? Number(exp) : null;
      this.#issuer       = await this.#store.getItemAsync(this.#keys.ISSUER);
      this.#webid        = await this.#store.getItemAsync(this.#keys.WEBID);
      this.#clientId     = await this.#store.getItemAsync(this.#keys.CLIENT_ID);
    } catch (err) {
      onWarning?.(`OidcSessionRN.restoreFromVault: vault read failed: ${err?.message ?? err}`);
      return false;
    }
    if (!this.#accessToken && !this.#refreshToken) return false;
    return this.isAuthenticated();
  }

  /**
   * Snapshot of authentication state.  Cheap; safe to call every render.
   */
  getStatus() {
    const out = { authenticated: this.isAuthenticated() };
    if (this.#webid)     out.webid     = this.#webid;
    if (this.#expiresAt) out.expiresAt = this.#expiresAt;
    if (this.#issuer)    out.issuer    = this.#issuer;
    return out;
  }

  isAuthenticated() {
    if (!this.#accessToken) return false;
    if (this.#expiresAt && Date.now() >= this.#expiresAt) return false;
    return true;
  }

  /** @returns {string|null} */ get webid()        { return this.#webid; }
  /** @returns {string|null} */ get issuer()       { return this.#issuer; }
  /** @returns {string|null} */ get clientId()     { return this.#clientId; }
  /** @returns {string|null} */ get accessToken()  { return this.#accessToken; }
  /** @returns {string|null} */ get refreshToken() { return this.#refreshToken; }
  /** @returns {number|null} */ get expiresAt()    { return this.#expiresAt; }

  /**
   * Returns a `fetch` wrapper that injects the bearer token AND
   * transparently refreshes on 401 (one retry).
   */
  getAuthenticatedFetch() {
    if (!this.isAuthenticated() && !this.#refreshToken) {
      const err = new Error('OidcSessionRN.getAuthenticatedFetch: not authenticated');
      err.code  = 'NOT_AUTHENTICATED';
      throw err;
    }
    const doFetch = async (input, init = {}) => {
      const headers = new Headers(init.headers ?? {});
      if (!headers.has('Authorization') && this.#accessToken) {
        headers.set('Authorization', `Bearer ${this.#accessToken}`);
      }
      return globalThis.fetch(input, { ...init, headers });
    };
    return async (input, init = {}) => {
      // Pro-active refresh if we know the access token has expired.
      if (
        this.#refreshToken &&
        (!this.#accessToken || (this.#expiresAt && Date.now() >= this.#expiresAt))
      ) {
        try { await this.refresh(); } catch { /* fall through to 401 path */ }
      }
      let res = await doFetch(input, init);
      if (res.status === 401 && this.#refreshToken) {
        try {
          await this.refresh();
          res = await doFetch(input, init);
        } catch { /* surface the original 401 */ }
      }
      return res;
    };
  }

  /**
   * Use the stored refresh_token to obtain a fresh access_token.
   */
  async refresh() {
    if (!this.#refreshToken) {
      throw Object.assign(new Error('OidcSessionRN.refresh: no refresh token'), { code: 'NO_REFRESH_TOKEN' });
    }
    if (!this.#issuer) {
      throw Object.assign(new Error('OidcSessionRN.refresh: no issuer'), { code: 'NO_ISSUER' });
    }
    if (!this.#clientId) {
      throw Object.assign(new Error('OidcSessionRN.refresh: no client_id'), { code: 'NO_CLIENT_ID' });
    }

    const discRes = await globalThis.fetch(this.#issuer.replace(/\/$/, '') + '/.well-known/openid-configuration', {
      headers: { Accept: 'application/json' },
    });
    if (!discRes.ok) {
      throw Object.assign(new Error(`refresh: discovery failed: ${discRes.status}`), { code: 'DISCOVERY_FAILED' });
    }
    const disc = await discRes.json();
    const tokenEndpoint = disc.token_endpoint || disc.tokenEndpoint;
    if (!tokenEndpoint) {
      throw Object.assign(new Error('refresh: discovery missing token_endpoint'), { code: 'NO_TOKEN_ENDPOINT' });
    }

    const body = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: this.#refreshToken,
      client_id:     this.#clientId,
    });

    const res = await globalThis.fetch(tokenEndpoint, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept:         'application/json',
      },
      body: body.toString(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw Object.assign(
        new Error(`refresh: ${res.status} ${json.error ?? ''} — ${json.error_description ?? ''}`),
        { code: 'REFRESH_REJECTED', status: res.status, body: json },
      );
    }
    if (typeof json.access_token !== 'string' || json.access_token.length === 0) {
      throw Object.assign(new Error('refresh: response missing access_token'), { code: 'INVALID_RESPONSE' });
    }

    this.#accessToken = json.access_token;
    if (typeof json.refresh_token === 'string' && json.refresh_token.length > 0) {
      this.#refreshToken = json.refresh_token;
    }
    this.#expiresAt = typeof json.expires_in === 'number'
      ? Date.now() + json.expires_in * 1000
      : null;

    await this.#store.setItemAsync(this.#keys.ACCESS_TOKEN,  this.#accessToken);
    if (json.refresh_token) {
      await this.#store.setItemAsync(this.#keys.REFRESH_TOKEN, this.#refreshToken);
    }
    if (this.#expiresAt) {
      await this.#store.setItemAsync(this.#keys.EXPIRES_AT, String(this.#expiresAt));
    }
  }

  /**
   * Clears in-memory state and removes every secure-store entry.
   */
  async logout() {
    this.#accessToken  = null;
    this.#refreshToken = null;
    this.#idToken      = null;
    this.#expiresAt    = null;
    this.#issuer       = null;
    this.#webid        = null;
    this.#clientId     = null;
    for (const k of Object.values(this.#keys)) {
      try { await this.#store.deleteItemAsync(k); } catch { /* swallow */ }
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  async #persist() {
    const writes = [];
    const set = (k, v) => writes.push(
      v == null
        ? this.#store.deleteItemAsync(k).catch(() => {})
        : this.#store.setItemAsync(k, String(v)).catch(() => {}),
    );
    set(this.#keys.ACCESS_TOKEN,  this.#accessToken);
    set(this.#keys.REFRESH_TOKEN, this.#refreshToken);
    set(this.#keys.ID_TOKEN,      this.#idToken);
    set(this.#keys.EXPIRES_AT,    this.#expiresAt);
    set(this.#keys.ISSUER,        this.#issuer);
    set(this.#keys.WEBID,         this.#webid);
    set(this.#keys.CLIENT_ID,     this.#clientId);
    await Promise.all(writes);
  }
}
