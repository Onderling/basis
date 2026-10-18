/**
 * `createSolidAuthNode` — Solid OIDC browser-redirect auth for Node.
 *
 * Substrate-level promotion of the byte-near-identical wrappers
 * formerly at `apps/folio/src/auth/OidcSession.js` and
 * `apps/pinboard/src/lib/OidcSession.js`. Phase 52.15.2 (2026-05-14).
 *
 * Wraps `@inrupt/solid-client-authn-node`'s `Session` for the standard
 * Solid OIDC browser-redirect flow:
 *
 *   1. `start({issuer, redirectUrl})` — kicks off OIDC; resolves with
 *      the provider's authorize URL so the caller (HTTP route /
 *      skill handler) can return it to the browser to navigate to.
 *   2. `handleCallback(callbackUrl)` — exchanges the auth code for
 *      tokens; persists the refresh token to the vault.
 *   3. `getStatus()` → `{authenticated, webid?, expiresAt?, issuer?}`.
 *   4. `isAuthenticated()` → boolean.
 *   5. `getAuthenticatedFetch()` → Inrupt's session-bound `fetch`.
 *   6. `restoreFromVault({onWarning?})` — boot-time silent refresh.
 *   7. `logout()` — clears in-memory session + vault entries.
 *
 * Hard rules:
 *   - Inrupt-only OIDC primitives. No bespoke OAuth/OIDC.
 *   - Refresh token in the vault; access token in memory only.
 *   - Multi-issuer (Phase 52.15.1) — accepts known id (`'inrupt'`,
 *     `'solidcommunity'`, …) or any HTTPS URL via `resolveIssuer`.
 *
 * Tests inject a fake `Session` via `_setSessionFactory(factory)`;
 * production lazy-loads `@inrupt/solid-client-authn-node`.
 *
 * @typedef {import('./types.js').SolidAuth} SolidAuth
 * @typedef {import('./types.js').SignInOpts} SignInOpts
 */

import { resolveIssuer } from './issuers.js';

const VAULT_KEY_REFRESH_TOKEN = 'oidc-refresh-token';
const VAULT_KEY_ISSUER        = 'oidc-issuer';
const VAULT_KEY_CLIENT_ID     = 'oidc-client-id';
const VAULT_KEY_CLIENT_SECRET = 'oidc-client-secret';

/**
 * Frozen map of the vault key names under which the Node Solid-OIDC auth persists its state:
 * refresh token, issuer, client id, and client secret.
 */
export const OIDC_VAULT_KEYS = Object.freeze({
  REFRESH_TOKEN: VAULT_KEY_REFRESH_TOKEN,
  ISSUER:        VAULT_KEY_ISSUER,
  CLIENT_ID:     VAULT_KEY_CLIENT_ID,
  CLIENT_SECRET: VAULT_KEY_CLIENT_SECRET,
});

/* ── Session factory — production loads Inrupt; tests inject a fake. ── */

let _sessionFactory = null;

async function defaultSessionFactory() {
  // openid-client (used internally by @inrupt/solid-client-authn-node for
  // discovery/token/JWKS) defaults to a 3500ms HTTP timeout, which real
  // self-hosted Solid IdPs (cold Community Solid Server) routinely exceed
  // → "outgoing request timed out after 3500ms". Raise the global default
  // on the same openid-client copy authn-node requires. Best-effort:
  // never block sign-in if the knob shape changes across versions.
  try {
    const oc = await import('openid-client');
    const custom = oc.custom ?? oc.default?.custom;
    const ms = Number(process.env.OIDC_HTTP_TIMEOUT_MS) || 30000;
    custom?.setHttpOptionsDefaults?.({ timeout: ms });
  } catch { /* best-effort */ }
  const mod = await import('@inrupt/solid-client-authn-node');
  return new mod.Session();
}

/** Test-only seam. Pass `null` to restore the default. */
export function _setSolidAuthNodeSessionFactory(factory) {
  _sessionFactory = factory;
}

async function newSession() {
  return (_sessionFactory ?? defaultSessionFactory)();
}

/* ───────────────────────────────────────────────────────────────────── */

/**
 * Build a `SolidAuth`-shaped instance bound to a vault.
 *
 * @param {object} opts
 * @param {object} opts.vault       — implements `get(key)`, `set(key, value)`, `delete(key)`
 * @param {string} opts.clientName  — display name shown on the OIDC consent screen
 * @returns {SolidAuth}
 */
export function createSolidAuthNode({ vault, clientName } = {}) {
  if (!vault) throw new Error('createSolidAuthNode: vault is required');
  if (typeof vault.get !== 'function' || typeof vault.set !== 'function' || typeof vault.delete !== 'function') {
    throw new Error('createSolidAuthNode: vault must implement get / set / delete');
  }
  if (typeof clientName !== 'string' || clientName.length === 0) {
    throw new Error('createSolidAuthNode: clientName is required (shown on the consent screen)');
  }

  /** @type {object|null} */ let session = null;
  /** @type {string|null} */ let issuerUrl = null;
  /** @type {string|null} */ let clientId = null;
  /** @type {string|null} */ let clientSecret = null;
  /** @type {string|null} */ let webid = null;
  /** @type {number|null} */ let expiresAt = null;

  function wireTokenListeners() {
    const events = session?.events;
    if (!events?.on) return;
    events.on('newTokens', (tokenSet) => {
      absorbTokenSet(tokenSet).catch(() => { /* swallow */ });
    });
    events.on('newRefreshToken', (newToken) => {
      if (typeof newToken === 'string' && newToken) {
        vault.set(VAULT_KEY_REFRESH_TOKEN, newToken).catch(() => {});
      }
    });
  }

  async function absorbTokenSet(tokenSet) {
    if (!tokenSet || typeof tokenSet !== 'object') return;
    if (typeof tokenSet.refreshToken === 'string' && tokenSet.refreshToken) {
      try { await vault.set(VAULT_KEY_REFRESH_TOKEN, tokenSet.refreshToken); } catch { /* ignore */ }
    }
    if (typeof tokenSet.expiresAt === 'number') {
      // Inrupt sometimes uses seconds-since-epoch — normalise to ms.
      expiresAt = tokenSet.expiresAt < 1e12 ? tokenSet.expiresAt * 1000 : tokenSet.expiresAt;
    }
  }

  async function captureSessionState() {
    if (!session) return;
    if (typeof session.info?.webId === 'string' && session.info.webId) {
      webid = session.info.webId;
    }
    if (typeof session.info?.expirationDate === 'number') {
      const ed = session.info.expirationDate;
      expiresAt = ed < 1e12 ? ed * 1000 : ed;
    }
    if (issuerUrl) {
      try { await vault.set(VAULT_KEY_ISSUER, issuerUrl); } catch { /* ignore */ }
    }
    const dynId = session.info?.clientAppId ?? session.info?.clientId;
    if (typeof dynId === 'string' && dynId) {
      clientId = dynId;
      try { await vault.set(VAULT_KEY_CLIENT_ID, dynId); } catch { /* ignore */ }
    }
    const tok = session.info?.refreshToken ?? session.refreshToken ?? null;
    if (typeof tok === 'string' && tok) {
      try { await vault.set(VAULT_KEY_REFRESH_TOKEN, tok); } catch { /* ignore */ }
    }
  }

  /* ── Public API (SolidAuth shape) ──────────────────────────────── */

  async function start({ issuer, redirectUrl } = {}) {
    if (typeof issuer !== 'string' || !issuer) {
      throw Object.assign(new Error('createSolidAuthNode.start: issuer is required'), { code: 'BAD_REQUEST' });
    }
    if (typeof redirectUrl !== 'string' || !redirectUrl) {
      throw Object.assign(new Error('createSolidAuthNode.start: redirectUrl is required'), { code: 'BAD_REQUEST' });
    }

    // Phase 52.15.1 — accept known id or URL; resolve to URL.
    const resolved = resolveIssuer(issuer);
    if (!resolved) {
      throw Object.assign(
        new Error(`createSolidAuthNode.start: unknown issuer "${issuer}"`),
        { code: 'UNKNOWN_ISSUER' },
      );
    }
    issuerUrl = resolved.url;

    const s = await newSession();
    session = s;

    let captured = null;
    await s.login({
      oidcIssuer:    issuerUrl,
      redirectUrl,
      clientName,
      handleRedirect: (url) => { captured = url; },
    });

    if (typeof captured !== 'string' || !captured) {
      throw Object.assign(
        new Error('createSolidAuthNode.start: Inrupt did not produce an authorize URL'),
        { code: 'OIDC_LOGIN_FAILED' },
      );
    }
    return { redirectUrl: captured };
  }

  async function handleCallback(callbackUrl) {
    if (!session) {
      throw Object.assign(
        new Error('createSolidAuthNode.handleCallback: no login in progress; call start() first'),
        { code: 'NO_LOGIN_IN_PROGRESS' },
      );
    }
    if (typeof callbackUrl !== 'string' || !callbackUrl) {
      throw Object.assign(
        new Error('createSolidAuthNode.handleCallback: callbackUrl is required'),
        { code: 'BAD_REQUEST' },
      );
    }

    wireTokenListeners();

    try {
      await session.handleIncomingRedirect(callbackUrl);
    } catch (err) {
      throw Object.assign(
        new Error(`createSolidAuthNode.handleCallback: ${err?.message ?? String(err)}`),
        { code: 'OIDC_CALLBACK_FAILED', cause: err },
      );
    }

    if (!session.info?.isLoggedIn) {
      throw Object.assign(
        new Error('createSolidAuthNode.handleCallback: provider rejected the code'),
        { code: 'OIDC_NOT_AUTHENTICATED' },
      );
    }

    await captureSessionState();

    return {
      webid:     webid ?? undefined,
      issuer:    issuerUrl,
      expiresAt: expiresAt ?? undefined,
    };
  }

  function getStatus() {
    const authed = isAuthenticated();
    const out = { authenticated: authed };
    if (webid)     out.webid     = webid;
    if (expiresAt) out.expiresAt = expiresAt;
    if (issuerUrl) out.issuer    = issuerUrl;
    return out;
  }

  function isAuthenticated() {
    if (!session) return false;
    if (!session.info?.isLoggedIn) return false;
    if (expiresAt && Date.now() >= expiresAt) return false;
    return true;
  }

  function getAuthenticatedFetch() {
    if (!isAuthenticated()) {
      throw Object.assign(
        new Error('createSolidAuthNode.getAuthenticatedFetch: not authenticated'),
        { code: 'NOT_AUTHENTICATED' },
      );
    }
    return session.fetch.bind(session);
  }

  async function logout() {
    const s = session;
    session = null;
    webid = null;
    expiresAt = null;

    if (s?.logout) {
      try { await s.logout({ logoutType: 'app' }); } catch { /* ignore */ }
    }
    try { await vault.delete(VAULT_KEY_REFRESH_TOKEN); } catch { /* ignore */ }
    try { await vault.delete(VAULT_KEY_ISSUER);        } catch { /* ignore */ }
    try { await vault.delete(VAULT_KEY_CLIENT_ID);     } catch { /* ignore */ }
    try { await vault.delete(VAULT_KEY_CLIENT_SECRET); } catch { /* ignore */ }
  }

  async function restoreFromVault({ onWarning } = {}) {
    let refreshToken;
    let storedIssuer;
    let storedClientId;
    let storedClientSecret;
    try {
      refreshToken       = await vault.get(VAULT_KEY_REFRESH_TOKEN);
      storedIssuer       = await vault.get(VAULT_KEY_ISSUER);
      storedClientId     = await vault.get(VAULT_KEY_CLIENT_ID);
      storedClientSecret = await vault.get(VAULT_KEY_CLIENT_SECRET);
    } catch (err) {
      onWarning?.(`createSolidAuthNode.restoreFromVault: vault read failed: ${err?.message ?? err}`);
      return false;
    }
    if (!refreshToken || !storedIssuer) return false;

    let s;
    try {
      s = await newSession();
    } catch (err) {
      onWarning?.(`createSolidAuthNode.restoreFromVault: session-factory failed: ${err?.message ?? err}`);
      return false;
    }
    session      = s;
    issuerUrl    = storedIssuer;
    clientId     = storedClientId ?? null;
    clientSecret = storedClientSecret ?? null;

    wireTokenListeners();

    try {
      const loginOpts = {
        oidcIssuer:    storedIssuer,
        refreshToken,
        handleRedirect: () => {},
      };
      if (clientId)     loginOpts.clientId     = clientId;
      if (clientSecret) loginOpts.clientSecret = clientSecret;
      await s.login(loginOpts);
    } catch (err) {
      session = null;
      issuerUrl = null;
      clientId = null;
      clientSecret = null;
      onWarning?.(`createSolidAuthNode.restoreFromVault: refresh failed: ${err?.message ?? err}`);
      return false;
    }

    if (!s.info?.isLoggedIn) {
      session = null;
      onWarning?.('createSolidAuthNode.restoreFromVault: refresh did not produce a logged-in session');
      return false;
    }

    await captureSessionState();
    return true;
  }

  return {
    start,
    handleCallback,
    getStatus,
    isAuthenticated,
    getAuthenticatedFetch,
    logout,
    restoreFromVault,
    get webid() { return webid; },
  };
}
