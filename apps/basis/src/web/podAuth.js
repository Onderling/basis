/**
 * **Platform: web** — composes `@inrupt/solid-client-authn-browser`.
 *
 * basis — real Solid OIDC auth wrapper (J6 real binding).
 *
 * v0.7. (2026-05-23): replaces the v0.6.2 mock externalFlow with
 * a real Inrupt redirect-based OIDC flow.
 *
 *   - `start({issuer, redirectUrl, clientName})` — triggers a full-
 *     page redirect to the chosen Solid OIDC issuer.  After the
 *     user authenticates, the issuer redirects back to redirectUrl.
 *   - `handleRedirect({restorePreviousSession?})` — runs on every
 *     page load; if the URL carries an Inrupt redirect (?code=...
 *     &state=...&iss=...), completes the OIDC exchange + restores
 *     the session.  Returns `{webid, isLoggedIn, fetch}` or null.
 *   - `getCurrentSession()` — pulls the live session (null when
 *     logged out).
 *   - `signOut()` — clears the session + persisted state.
 *
 * Session shape returned by the helpers:
 *   { webid: string, isLoggedIn: boolean, fetch: typeof fetch }
 *
 * The authenticated `fetch` is what unlocks real pod attach
 * (v0.7. — pseudo-pod cache mode @onderling pod-client).
 *
 * Sister module: @onderling/oidc-session (Node) + @onderling/oidc-session-rn
 * (React Native).  No browser substrate yet; when a second browser
 * consumer appears, this wrapper gets extracted to
 * `@onderling/oidc-session-browser` per the rule-of-two precedent.
 *
 * Test seam: the `injectAuth(impl)` export lets tests substitute a
 * fake login() / getDefaultSession() / handleIncomingRedirect();
 * production code uses the real Inrupt module.
 */

import {
  login,
  handleIncomingRedirect,
  getDefaultSession,
  logout,
} from '@inrupt/solid-client-authn-browser';

// Curated default issuer list.  Mirrors @onderling/oidc-session/issuers.js
// (canonical source) but copied here because we can't import a Node-
// only substrate into the browser bundle.
export const KNOWN_ISSUERS = Object.freeze([
  { id: 'inrupt',          name: 'Inrupt PodSpaces',         url: 'https://login.inrupt.com'   },
  { id: 'solidcommunity',  name: 'SolidCommunity.net',       url: 'https://solidcommunity.net' },
  { id: 'solidweb',        name: 'SolidWeb.org',             url: 'https://solidweb.org'       },
]);

// Default issuer is env-overridable so a deployment (or local test against a
// self-hosted CSS) can point sign-in at its OWN pod instead of Inrupt PodSpaces.
// `resolveIssuer` accepts a full URL, so VITE_POD_DEFAULT_ISSUER can be e.g.
// `http://localhost:3002/`.
export const DEFAULT_ISSUER_ID =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_POD_DEFAULT_ISSUER)
  || 'inrupt';

/** Resolve an issuer by short id, URL, or undefined → default (which may itself be an id OR a full URL). */
export function resolveIssuer(idOrUrl) {
  const target = idOrUrl || DEFAULT_ISSUER_ID;   // fall back to the (possibly-URL) default
  const known = KNOWN_ISSUERS.find((i) => i.id === target || i.url === target);
  if (known) return known;
  // Custom URL (e.g. a self-hosted CSS) — treat as a one-off.
  try {
    const url = new URL(target);
    return { id: 'custom', name: url.host, url: url.origin };
  } catch {
    return null;
  }
}

let authImpl = { login, handleIncomingRedirect, getDefaultSession, logout };

/**
 * Test seam — swap the auth module functions for tests.  Production
 * code calls the helpers below which delegate to `authImpl`.
 */
export function _injectAuth(impl) {
  authImpl = { ...authImpl, ...impl };
}

/**
 * Start the OIDC redirect dance.  Returns a promise that NEVER
 * resolves on success — the browser navigates away.  Resolves with
 * an error if the redirect setup fails.
 *
 * @param {object} opts
 * @param {string}  opts.issuer       short id ('inrupt') / URL / custom
 * @param {string}  [opts.redirectUrl=window.location.href]
 * @param {string}  [opts.clientName='basis']
 */
export async function startSignIn({ issuer, redirectUrl, clientName } = {}) {
  const resolved = resolveIssuer(issuer);
  if (!resolved) throw new Error(`Unknown issuer "${issuer}"`);
  const redirect = redirectUrl
    ?? (typeof window !== 'undefined' ? window.location.href : undefined);
  if (!redirect) throw new Error('redirectUrl required (no window)');
  await authImpl.login({
    oidcIssuer:  resolved.url,
    redirectUrl: redirect,
    clientName:  clientName ?? 'basis',
  });
}

/**
 * Complete the OIDC round-trip on page load.  Returns the session
 * snapshot OR null if not signed in.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.restorePreviousSession=true]
 * @returns {Promise<{ webid: string, isLoggedIn: boolean, fetch: typeof fetch } | null>}
 */
export async function handleRedirect({ restorePreviousSession = true } = {}) {
  // The library reports a failed redirect (a refused token exchange, a client it would not re-register) as an `error`
  // EVENT on the session and resolves as if nothing happened; kept here so the screens can say why, not just "local".
  signInError = null;
  const session = authImpl.getDefaultSession?.();
  const said = (v) => (v == null ? '' : String(v?.message ?? v));
  const onError = (code, description) => { signInError = [description, code].map(said).find(Boolean) || 'sign-in failed'; };
  try { session?.events?.on?.('error', onError); } catch { /* a session without events: only throws are seen */ }
  try {
    await authImpl.handleIncomingRedirect({ restorePreviousSession });
  } catch (err) {
    signInError = err?.message ?? String(err);
    throw err;
  } finally {
    try { session?.events?.off?.('error', onError); } catch { /* listener stays; it only writes this module's note */ }
  }
  return getCurrentSession();
}

let signInError = null;

/** Why the last redirect did not sign in (the library's words), or null — read by `whoami`. */
export function lastSignInError() {
  return signInError;
}

/**
 * Synchronous read of the current session.
 *
 * @returns {{ webid: string, isLoggedIn: boolean, fetch: typeof fetch } | null}
 */
export function getCurrentSession() {
  const sess = authImpl.getDefaultSession();
  if (!sess?.info?.isLoggedIn) return null;
  return {
    webid:       sess.info.webId,
    isLoggedIn:  true,
    fetch:       sess.fetch.bind(sess),
  };
}

/**
 * v0.7.P3c diagnostic — return the raw session state shape WITHOUT
 * the isLoggedIn gate, so /whoami can show 'session exists but
 * isLoggedIn=false' and similar diagnostic states.
 *
 * @returns {{ sessionExists: boolean, isLoggedIn: boolean, webId?: string, sessionId?: string }}
 */
export function getRawSessionInfo() {
  const sess = authImpl.getDefaultSession();
  if (!sess) return { sessionExists: false, isLoggedIn: false };
  return {
    sessionExists: true,
    isLoggedIn:    !!sess?.info?.isLoggedIn,
    webId:         sess?.info?.webId,
    sessionId:     sess?.info?.sessionId,
  };
}

/**
 * Sign out — clears the session AND removes any persisted tokens.
 *
 * @param {object} [opts]
 * @param {string} [opts.postLogoutUrl=window.location.href]
 */
export async function signOut({ postLogoutUrl } = {}) {
  const sess = authImpl.getDefaultSession();
  if (sess?.info?.isLoggedIn) {
    // Inrupt's logout has two paths: 'app' (local-only) + 'idp' (full
    // round-trip).  Default: app-only so the user stays on the page.
    await authImpl.logout({ logoutType: 'app' });
  }
  if (postLogoutUrl && typeof window !== 'undefined') {
    window.location.href = postLogoutUrl;
  }
}
