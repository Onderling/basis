/**
 * SolidVault — Solid OIDC session manager.
 *
 * Despite the name, **SolidVault is not itself a `Vault`** in the
 * `@onderling/core` Vault sense.  It's the Solid-OIDC session manager
 * that *uses* a Vault-shaped store (`get` / `set` / `delete` / `list`)
 * to persist its tokens.  The name is inherited from the design docs
 * (where "vault" refers loosely to "the thing that holds your Solid
 * credentials").
 *
 * Originally lived at `packages/core/src/storage/SolidVault.js`;
 * extracted to its own package 2026-05-11 (standardisation Phase 50.1)
 * as a peer to `@onderling/oidc-session-rn`.  No code changes other
 * than inlining a minimal default in-memory token store (was
 * `core.VaultMemory`) to break the package cycle.
 *
 * Public API:
 *
 *   const sv = new SolidVault({
 *     webid:        'https://alice.example/profile/card#me',
 *     oidcIssuer:  'https://login.inrupt.com',
 *     redirectUrl: 'https://app.example/callback',  // browser only
 *     vault:       userVault,                        // optional; defaults to in-memory
 *   });
 *
 *   await sv.login({ clientId, clientSecret, refreshToken? });
 *   sv.isAuthenticated();        // boolean
 *   const fetchFn = sv.getAuthenticatedFetch();    // for SolidPodSource
 *   await sv.refresh();          // forces refresh; emits 'auth-state'
 *   sv.podRoot;                  // getter — derived from WebID profile
 *   await sv.logout();           // clears tokens + vault entries
 *
 * The Solid OIDC interaction is delegated to `@inrupt/solid-client-authn-node`'s
 * `Session` (Node-only).  Browser/RN redirect-based flows are handled by
 * `@onderling/oidc-session-rn` (uses `expo-auth-session` for the dance).
 *
 * Token storage: under namespace `solid-oidc:<webid>` in the supplied vault.
 *   solid-oidc:<webid>:access_token
 *   solid-oidc:<webid>:refresh_token
 *   solid-oidc:<webid>:expires_at      (unix-ms string)
 *   solid-oidc:<webid>:id_token
 *   solid-oidc:<webid>:client_id       (so we can re-login on a fresh process)
 *   solid-oidc:<webid>:client_secret
 *   solid-oidc:<webid>:oidc_issuer
 *   solid-oidc:<webid>:pod_root        (cached after first lookup)
 *
 * Automatic refresh: when the access token is within `REFRESH_LEEWAY_MS` of
 * expiry, `getAuthenticatedFetch()` transparently refreshes before issuing
 * the request.  Manual `refresh()` is available too.
 *
 * Events (Node `EventEmitter`):
 *   'auth-state'  → ('authenticated' | 'unauthenticated' | 'refreshed' | 'expired')
 */

import { EventEmitter } from 'node:events';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';

/* ────────────────────────────────────────────────────────────────────────── */

/** Refresh when within this many ms of expiry. */
const REFRESH_LEEWAY_MS = param({ key: 'oidcSession.refreshLeewayMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60_000 });

/**
 * Minimal in-memory Vault-shaped store used as the default when no vault is
 * supplied.  Exposes the same `get` / `set` / `delete` / `list` surface
 * `@onderling/core`'s `VaultMemory` provides for our purposes here.  Callers
 * who want richer vault behaviour (persistence, encryption) supply their own.
 */
class InMemoryTokenStore {
  #m = new Map();
  async get(key)    { return this.#m.has(key) ? this.#m.get(key) : null; }
  async set(key, v) { this.#m.set(key, v); }
  async delete(key) { this.#m.delete(key); }
  async list()      { return Array.from(this.#m.keys()); }
}

/**
 * Map our `Vault` interface onto the Inrupt `IStorage` interface (a subset:
 * `get(key)`, `set(key, value)`, `delete(key)`).  The Inrupt session uses
 * this internally for its own state machine — *separate* from the token
 * storage we manage explicitly.
 *
 * We namespace Inrupt's internal keys under `inrupt:` so they don't collide
 * with our `solid-oidc:` prefix.
 */
class VaultBackedInruptStorage {
  #vault;
  #prefix;

  constructor(vault, prefix = 'inrupt:') {
    this.#vault  = vault;
    this.#prefix = prefix;
  }

  async get(key) {
    const v = await this.#vault.get(this.#prefix + key);
    // IStorage expects `string | undefined` (not null).
    return v == null ? undefined : v;
  }
  async set(key, value) {
    await this.#vault.set(this.#prefix + key, String(value));
  }
  async delete(key) {
    await this.#vault.delete(this.#prefix + key);
  }
}

/** Lazy-load the Inrupt module so tests can inject a stub via `_setSessionFactory`. */
let _sessionFactory = null;
async function defaultSessionFactory(opts) {
  const mod = await import('@inrupt/solid-client-authn-node');
  return new mod.Session(opts);
}

/**
 * Test-only seam: replace the Session constructor with a fake.
 * Pass `null` to restore the default.
 *
 * @param {(opts: object) => Promise<object>|object} factory
 */
export function _setSessionFactory(factory) {
  _sessionFactory = factory;
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Solid OIDC session manager for Node — despite the name, not itself a `Vault`; it persists its
 * tokens into a Vault-shaped store under `solid-oidc:<webid>:*` (refresh token in the vault,
 * access token in memory only). Delegates the OIDC flow to `@inrupt/solid-client-authn-node`'s
 * `Session`; `getAuthenticatedFetch()` transparently refreshes when the access token is within
 * 60s of expiry, coalescing concurrent refreshes onto one in-flight promise. Emits `'auth-state'`
 * with `'authenticated'` | `'unauthenticated'` | `'refreshed'` | `'expired'`.
 */
export class SolidVault extends EventEmitter {
  #webid;
  #oidcIssuer;
  #redirectUrl;
  #vault;

  // Inrupt session — populated on login() / restoreFromVault().
  #session = null;

  // Cached token state, mirrored from the vault.
  #accessToken  = null;
  #refreshToken = null;
  #expiresAt    = null;   // unix-ms or null
  #idToken      = null;

  // Cached config for restoreFromVault() / re-login.
  #clientId     = null;
  #clientSecret = null;

  // Cached pod root (derived from WebID profile on first access).
  #podRoot      = null;

  // Single in-flight refresh promise to avoid concurrent refreshes.
  #refreshing   = null;

  /**
   * @param {object} opts
   * @param {string}   opts.webid        — the user's WebID URI
   * @param {string}   [opts.oidcIssuer] — OIDC issuer; if omitted, derived from WebID profile or supplied at login()
   * @param {string}   [opts.redirectUrl] — for browser/RN flow (unused in Node)
   * @param {object}   [opts.vault]      — token storage (Vault-shaped: `get`/`set`/`delete`/`list`); defaults to an in-memory store (tests only)
   */
  constructor({ webid, oidcIssuer, redirectUrl, vault } = {}) {
    super();
    if (!webid || typeof webid !== 'string') {
      throw Object.assign(
        new Error('SolidVault: `webid` is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    this.#webid       = webid;
    this.#oidcIssuer  = oidcIssuer ?? null;
    this.#redirectUrl = redirectUrl ?? null;
    this.#vault       = vault ?? new InMemoryTokenStore();
  }

  /* ── Public getters ────────────────────────────────────────────────────── */

  get webid()       { return this.#webid; }
  get oidcIssuer()  { return this.#oidcIssuer; }
  get redirectUrl() { return this.#redirectUrl; }

  /**
   * Pod root URI derived from the WebID profile.  Reads the profile document
   * via the (authenticated, if available) fetch, looks for the `pim:storage`
   * triple, and falls back to deriving from the WebID URL origin.  Result is
   * cached in-memory + in the vault.
   *
   * Returns `null` if the WebID can't be resolved (e.g. offline, no fetch).
   *
   * @returns {Promise<string|null>}
   */
  async getPodRoot() {
    if (this.#podRoot) return this.#podRoot;

    const cached = await this.#vault.get(this.#vaultKey('pod_root'));
    if (cached) {
      this.#podRoot = cached;
      return cached;
    }

    const fetchFn = this.#unauthenticatedSafeFetch();
    let podRoot = null;

    try {
      const res = await fetchFn(this.#webid, {
        headers: { Accept: 'text/turtle, application/ld+json;q=0.9, */*;q=0.5' },
      });
      if (res.ok) {
        const body = await res.text();
        podRoot = extractPimStorage(body, this.#webid);
      }
    } catch {
      // ignore — we'll fall back to origin-derived
    }

    if (!podRoot) {
      try {
        const u = new URL(this.#webid);
        podRoot = `${u.origin}/`;
      } catch {
        return null;
      }
    }

    this.#podRoot = podRoot;
    try { await this.#vault.set(this.#vaultKey('pod_root'), podRoot); } catch { /* ignore */ }
    return podRoot;
  }

  /** Synchronous accessor; returns `null` if `getPodRoot()` hasn't run yet. */
  get podRoot() { return this.#podRoot; }

  /**
   * Whether the session is currently authenticated and the access token is
   * not expired.
   */
  isAuthenticated() {
    if (!this.#session) return false;
    if (this.#session.info && typeof this.#session.info.isLoggedIn === 'boolean') {
      if (!this.#session.info.isLoggedIn) return false;
    }
    if (this.#expiresAt && Date.now() >= this.#expiresAt) return false;
    return true;
  }

  /* ── Login / logout ─────────────────────────────────────────────────────── */

  /**
   * Perform the OIDC login flow (Node, client-credentials/refresh-token).
   *
   * Required `opts`:
   *   - `clientId`     (or stored from a previous login)
   *   - `clientSecret` (or stored from a previous login)
   *
   * Optional:
   *   - `oidcIssuer`   (overrides constructor)
   *   - `refreshToken` (skips full login; reuses stored token if not given)
   *
   * If a refresh token is available (either in opts or in the vault), uses
   * it to silently re-establish the session without prompting.
   *
   * @param {object} [opts]
   * @returns {Promise<void>}
   */
  async login(opts = {}) {
    // Resolve effective configuration, restoring from vault where possible.
    const stored = await this.#loadFromVault();

    const oidcIssuer = opts.oidcIssuer || this.#oidcIssuer || stored.oidcIssuer;
    if (!oidcIssuer) {
      throw Object.assign(
        new Error('SolidVault.login: `oidcIssuer` is required (constructor, opts, or stored)'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    this.#oidcIssuer = oidcIssuer;

    const clientId     = opts.clientId     || stored.clientId;
    const clientSecret = opts.clientSecret || stored.clientSecret;
    const refreshToken = opts.refreshToken || stored.refreshToken;

    if (!clientId || !clientSecret) {
      throw Object.assign(
        new Error('SolidVault.login: `clientId` and `clientSecret` are required for the Node OIDC flow'),
        { code: 'INVALID_ARGUMENT' },
      );
    }

    const session = await this.#newSession();

    // Wire NEW_TOKENS so refreshes flow back into the vault.
    session.events?.on?.('newTokens', (tokenSet) => {
      this.#absorbTokenSet(tokenSet).catch(() => { /* swallow */ });
    });
    // Also fall back to NEW_REFRESH_TOKEN for older variants — harmless duplicate.
    session.events?.on?.('newRefreshToken', (newToken) => {
      this.#refreshToken = newToken;
      this.#vault.set(this.#vaultKey('refresh_token'), newToken).catch(() => {});
    });

    const loginOpts = {
      oidcIssuer,
      clientId,
      clientSecret,
      // The Node session expects a no-op redirect handler when running headless.
      handleRedirect: () => { /* no-op */ },
    };
    if (this.#redirectUrl) loginOpts.redirectUrl = this.#redirectUrl;
    if (refreshToken)      loginOpts.refreshToken = refreshToken;

    await session.login(loginOpts);
    this.#session = session;

    // Some Node flows don't fire NEW_TOKENS on the first login.  Pull the
    // current state directly off the session if available.
    await this.#captureSessionState();

    // Persist config so a fresh process can re-login from refresh token alone.
    await this.#vault.set(this.#vaultKey('client_id'),     clientId);
    await this.#vault.set(this.#vaultKey('client_secret'), clientSecret);
    await this.#vault.set(this.#vaultKey('oidc_issuer'),   oidcIssuer);
    this.#clientId     = clientId;
    this.#clientSecret = clientSecret;

    this.emit('auth-state', this.isAuthenticated() ? 'authenticated' : 'unauthenticated');
  }

  /**
   * Invalidate tokens and clear all `solid-oidc:<webid>:*` vault entries.
   */
  async logout() {
    if (this.#session?.logout) {
      try {
        // 'app' logout — Node-side, doesn't need a redirect.
        await this.#session.logout({ logoutType: 'app' });
      } catch {
        // best-effort
      }
    }
    this.#session     = null;
    this.#accessToken = null;
    this.#refreshToken = null;
    this.#expiresAt   = null;
    this.#idToken     = null;
    this.#podRoot     = null;
    this.#clientId    = null;
    this.#clientSecret = null;

    await this.#clearVault();
    this.emit('auth-state', 'unauthenticated');
  }

  /* ── Refresh ───────────────────────────────────────────────────────────── */

  /**
   * Force a refresh of the access token using the stored refresh token.
   * Concurrent calls are coalesced into a single in-flight refresh.
   *
   * Emits `'auth-state'` with `'refreshed'` on success or `'expired'` on
   * failure (after which `isAuthenticated()` returns false).
   */
  async refresh() {
    if (this.#refreshing) return this.#refreshing;
    this.#refreshing = (async () => {
      try {
        if (!this.#session) {
          // If we have stored credentials, do a fresh login from refresh token.
          await this.login({});
        } else {
          // Issue a re-login from the refresh token in-place.  This is what
          // the Inrupt docs recommend for Node when you want to extend a
          // session beyond its access token's lifetime.
          if (!this.#refreshToken) {
            throw Object.assign(
              new Error('SolidVault.refresh: no refresh token available'),
              { code: 'NO_REFRESH_TOKEN' },
            );
          }
          await this.#session.login({
            oidcIssuer:   this.#oidcIssuer,
            clientId:     this.#clientId,
            clientSecret: this.#clientSecret,
            refreshToken: this.#refreshToken,
            handleRedirect: () => {},
          });
          await this.#captureSessionState();
        }
        this.emit('auth-state', 'refreshed');
      } catch (err) {
        this.emit('auth-state', 'expired');
        throw err;
      } finally {
        this.#refreshing = null;
      }
    })();
    return this.#refreshing;
  }

  /* ── Authenticated fetch ────────────────────────────────────────────────── */

  /**
   * Returns a `fetch` function bound to the authenticated session.
   *
   * Transparently refreshes the access token before each request when within
   * `REFRESH_LEEWAY_MS` of expiry.  If no session exists at all, falls back
   * to attempting a refresh (which will load credentials from the vault).
   *
   * Suitable for passing as `SolidPodSource({ fetch })`.
   *
   * @returns {(input: RequestInfo, init?: RequestInit) => Promise<Response>}
   */
  getAuthenticatedFetch() {
    return async (input, init) => {
      // Lazy session restore: if we never logged in but the vault has
      // credentials + a refresh token, use them.
      if (!this.#session) {
        const stored = await this.#loadFromVault();
        if (stored.refreshToken && stored.clientId && stored.clientSecret) {
          await this.refresh();
        }
      }

      // Pre-emptive refresh near expiry.
      if (this.#expiresAt && Date.now() >= this.#expiresAt - REFRESH_LEEWAY_MS) {
        try { await this.refresh(); } catch { /* fall through, the request will likely 401 */ }
      }

      if (!this.#session?.fetch) {
        throw Object.assign(
          new Error('SolidVault: no authenticated session — call login() first'),
          { code: 'UNAUTHENTICATED' },
        );
      }
      return this.#session.fetch(input, init);
    };
  }

  /* ── Private helpers ───────────────────────────────────────────────────── */

  /** Compute the namespaced vault key. */
  #vaultKey(suffix) { return `solid-oidc:${this.#webid}:${suffix}`; }

  /** Read whatever's persisted in the vault for this webid. */
  async #loadFromVault() {
    const [
      accessToken, refreshToken, expiresAtRaw, idToken,
      clientId, clientSecret, oidcIssuer, podRoot,
    ] = await Promise.all([
      this.#vault.get(this.#vaultKey('access_token')),
      this.#vault.get(this.#vaultKey('refresh_token')),
      this.#vault.get(this.#vaultKey('expires_at')),
      this.#vault.get(this.#vaultKey('id_token')),
      this.#vault.get(this.#vaultKey('client_id')),
      this.#vault.get(this.#vaultKey('client_secret')),
      this.#vault.get(this.#vaultKey('oidc_issuer')),
      this.#vault.get(this.#vaultKey('pod_root')),
    ]);
    if (accessToken)  this.#accessToken  = accessToken;
    if (refreshToken) this.#refreshToken = refreshToken;
    if (expiresAtRaw) this.#expiresAt    = Number(expiresAtRaw) || null;
    if (idToken)      this.#idToken      = idToken;
    if (clientId)     this.#clientId     = clientId;
    if (clientSecret) this.#clientSecret = clientSecret;
    if (oidcIssuer && !this.#oidcIssuer) this.#oidcIssuer = oidcIssuer;
    if (podRoot)      this.#podRoot      = podRoot;
    return { accessToken, refreshToken, expiresAtRaw, idToken,
             clientId, clientSecret, oidcIssuer, podRoot };
  }

  /** Erase every `solid-oidc:<webid>:*` and `inrupt:*` entry. */
  async #clearVault() {
    if (typeof this.#vault.list !== 'function') return;
    const keys = await this.#vault.list();
    const prefix     = `solid-oidc:${this.#webid}:`;
    const inrptPrefix = 'inrupt:';
    await Promise.all(
      keys
        .filter(k => k.startsWith(prefix) || k.startsWith(inrptPrefix))
        .map(k => this.#vault.delete(k)),
    );
  }

  /** Persist a token set produced by an Inrupt NEW_TOKENS event. */
  async #absorbTokenSet(tokenSet) {
    if (!tokenSet) return;
    const { accessToken, refreshToken, idToken, expiresAt } = tokenSet;
    if (accessToken)  { this.#accessToken  = accessToken;  await this.#vault.set(this.#vaultKey('access_token'),  accessToken); }
    if (refreshToken) { this.#refreshToken = refreshToken; await this.#vault.set(this.#vaultKey('refresh_token'), refreshToken); }
    if (idToken)      { this.#idToken      = idToken;      await this.#vault.set(this.#vaultKey('id_token'),      idToken); }
    if (typeof expiresAt === 'number') {
      // SessionTokenSet says expiresAt is "Expiration of the access token" —
      // historically this has been seconds-since-epoch.  Detect: a value <
      // 10^12 is almost certainly seconds.
      const ms = expiresAt < 1e12 ? expiresAt * 1000 : expiresAt;
      this.#expiresAt = ms;
      await this.#vault.set(this.#vaultKey('expires_at'), String(ms));
    }
  }

  /**
   * Pull token state directly off the session object.  Used after login()
   * because Node sometimes doesn't fire NEW_TOKENS on the initial login.
   */
  async #captureSessionState() {
    const s = this.#session;
    if (!s) return;
    // info.expirationDate is already unix-ms per ISessionInfo.
    if (s.info?.expirationDate && typeof s.info.expirationDate === 'number') {
      this.#expiresAt = s.info.expirationDate;
      await this.#vault.set(this.#vaultKey('expires_at'), String(s.info.expirationDate));
    }
    // Some test stubs expose .accessToken / .refreshToken / .idToken directly.
    if (s.accessToken)  { this.#accessToken  = s.accessToken;  await this.#vault.set(this.#vaultKey('access_token'),  s.accessToken); }
    if (s.refreshToken) { this.#refreshToken = s.refreshToken; await this.#vault.set(this.#vaultKey('refresh_token'), s.refreshToken); }
    if (s.idToken)      { this.#idToken      = s.idToken;      await this.#vault.set(this.#vaultKey('id_token'),      s.idToken); }
  }

  /** Construct an Inrupt Session, using a vault-backed IStorage. */
  async #newSession() {
    const factory = _sessionFactory ?? defaultSessionFactory;
    const storage = new VaultBackedInruptStorage(this.#vault);
    return factory({ storage });
  }

  /**
   * A `fetch` to use for the *unauthenticated* WebID profile lookup.  Falls
   * back to global fetch.  Tests can swap globalThis.fetch.
   */
  #unauthenticatedSafeFetch() {
    if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
    return async () => { throw new Error('No fetch implementation available'); };
  }
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Extract `pim:storage` from a Turtle/JSON-LD WebID profile body.
 *
 * The WebID document is conventionally Turtle, but we accept JSON-LD as well.
 * For Turtle we use a simple regex — not a full parser, but adequate for the
 * canonical `<webid> pim:storage <pod-root> .` shape.
 *
 * @param {string} body
 * @param {string} webid
 * @returns {string|null}
 */
function extractPimStorage(body, webid) {
  if (!body || typeof body !== 'string') return null;

  // Try JSON-LD first.
  if (body.trimStart().startsWith('{') || body.trimStart().startsWith('[')) {
    try {
      const json = JSON.parse(body);
      const arr  = Array.isArray(json) ? json : [json];
      for (const node of arr) {
        const storage = node?.['http://www.w3.org/ns/pim/space#storage']
                     ?? node?.['pim:storage']
                     ?? node?.['storage'];
        if (typeof storage === 'string')      return storage;
        if (Array.isArray(storage) && storage.length) {
          const v = storage[0];
          if (typeof v === 'string') return v;
          if (v && typeof v === 'object' && typeof v['@id'] === 'string') return v['@id'];
        }
        if (storage && typeof storage === 'object' && typeof storage['@id'] === 'string') {
          return storage['@id'];
        }
      }
    } catch {
      // fall through to Turtle parse
    }
  }

  // Turtle: look for `pim:storage <uri>` or full IRI form.
  // We don't try to parse prefixes — covering the two canonical writings.
  const reShortPrefix = /pim:storage\s*<([^>]+)>/i;
  const reFullIri     = /<http:\/\/www\.w3\.org\/ns\/pim\/space#storage>\s*<([^>]+)>/i;

  const m1 = body.match(reShortPrefix);
  if (m1) return m1[1];
  const m2 = body.match(reFullIri);
  if (m2) return m2[1];

  // No storage triple — caller falls back to origin.
  void webid;
  return null;
}
