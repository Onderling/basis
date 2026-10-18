/**
 * podSignIn — Pinboard Phase 20 (2026-05-06).
 *
 * Glue between `OidcSession` (browser-redirect Solid OIDC) and the
 * bundle's `CachingDataSource`.  Three operations:
 *
 *   - `startPodSignIn({ bundle, issuer, redirectUrl })`
 *       → Kicks off OIDC.  Returns the IdP authorize URL the browser
 *         should navigate to.
 *
 *   - `completePodSignIn({ bundle, callbackUrl, dataSourceFactory? })`
 *       → After the IdP redirect lands on `redirectUrl`, completes
 *         the dance + builds a `SolidPodSource` (or whatever
 *         `dataSourceFactory` returns) + calls
 *         `bundle.cache.attachInner(podSource)`.  Returns
 *         `{ ok, webid, podRoot }`.
 *
 *   - `signOutOfPod({ bundle })`
 *       → Clears OIDC session + detaches the inner DataSource (cache
 *         keeps local state so the user keeps working offline).
 *
 * The `OidcSession` instance lives on `bundle.oidcSession` (lazily
 * created on first sign-in attempt; reused across attempts).
 *
 * Phase 52.15.3 (2026-05-14) — `OidcSession.js` retired in favour
 * of `@onderling/oidc-session.createSolidAuthNode`. The `attachInner`
 * orchestration stays app-local — it composes existing primitives.
 */

import { SolidPodSource } from '@onderling/pod-client';
import { createSolidAuthNode } from '@onderling/oidc-session';
import { attachPodToBundle, detachPodFromBundle } from './attachPodToBundle.js';

/** Lazily build a vault for OIDC token storage. In we can
 *  swap this for `core.VaultMemory` or a fs-backed vault per
 *  bundle. */
function defaultVault() {
  const m = new Map();
  return {
    async get(k)    { return m.get(k); },
    async set(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
  };
}

function ensureSession(bundle) {
  if (!bundle.oidcSession) {
    bundle.oidcSession = createSolidAuthNode({
      vault: bundle.oidcVault ?? defaultVault(),
      clientName: 'Pinboard',
    });
  }
  return bundle.oidcSession;
}

/**
 * Phase 1 of sign-in.  Returns `{ ok, redirectUrl }` where
 * `redirectUrl` is the IdP authorize URL the browser should
 * navigate to.
 */
export async function startPodSignIn({ bundle, issuer, redirectUrl }) {
  if (!bundle?.cache || typeof bundle.cache.attachInner !== 'function') {
    return { ok: false, error: 'bundle missing CachingDataSource (was cache: false?)' };
  }
  if (!issuer)      return { ok: false, error: 'issuer required' };
  if (!redirectUrl) return { ok: false, error: 'redirectUrl required' };

  const oidc = ensureSession(bundle);
  try {
    const r = await oidc.start({ issuer, redirectUrl });
    return { ok: true, redirectUrl: r.redirectUrl };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/**
 * Phase 2 of sign-in.  Completes the OIDC dance + attaches a
 * pod-backed DataSource to the bundle's cache.
 */
export async function completePodSignIn({ bundle, callbackUrl, dataSourceFactory }) {
  if (!bundle?.cache || typeof bundle.cache.attachInner !== 'function') {
    return { ok: false, error: 'bundle missing CachingDataSource (was cache: false?)' };
  }
  if (!bundle?.oidcSession) {
    return { ok: false, error: 'no sign-in in progress; call startPodSignIn first' };
  }
  const oidc = bundle.oidcSession;
  let info;
  try {
    info = await oidc.handleCallback(callbackUrl);
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
  if (!oidc.isAuthenticated()) {
    return { ok: false, error: 'callback succeeded but session not authenticated' };
  }

  const podRoot = await derivePodRoot(oidc, info?.webid);
  if (!podRoot) {
    return { ok: false, error: 'could not derive podRoot from WebID profile' };
  }
  const fetchFn = oidc.getAuthenticatedFetch();
  const inner = dataSourceFactory
    ? dataSourceFactory({ podUrl: podRoot, fetch: fetchFn })
    : new SolidPodSource({ podUrl: podRoot, fetch: fetchFn });
  // Device-independent activation — the SAME helper Pinboard mobile
  // (`ServiceContext.attachPod`) calls: setAnchor + idempotent
  // provision + `_podCtx` (classify/reverse) + attachInner. So web ≡
  // mobile for pod routing/provisioning (platform-parity principle).
  await attachPodToBundle({
    bundle,
    source: inner,
    podRoot,
    webid:  info?.webid ?? oidc.webid ?? null,
    fetch:  fetchFn,
  });

  return { ok: true, webid: info?.webid ?? oidc.webid ?? null, podRoot };
}

/** Detach inner + clear OIDC session.  Local cache is preserved. */
export async function signOutOfPod({ bundle }) {
  detachPodFromBundle({ bundle });
  if (bundle?.cache?.attachInner) await bundle.cache.attachInner(null);
  if (bundle?.oidcSession?.logout) {
    try { await bundle.oidcSession.logout(); } catch { /* best-effort */ }
  }
  bundle.oidcSession = null;
  return { ok: true };
}

/** Read-only status. */
export function podSignInStatus({ bundle }) {
  const oidc = bundle?.oidcSession;
  if (!oidc) return { signedIn: false };
  // "Signed in" = a pod session EXISTS, not "the access token is currently unexpired". A present webid is a
  // refresh-capable session (getAuthenticatedFetch refreshes transparently), so don't lag back to "Local only"
  // the moment the access token expires; webid is cleared on sign-out, so this still goes false then.
  return {
    signedIn:    oidc.isAuthenticated() || !!oidc.webid,
    webid:       oidc.webid ?? null,
    podAttached: !!bundle.cache?.hasInner,
  };
}

/**
 * Resolve the pod root from the WebID's profile.  Tries the
 * `pim:storage` triple via the authenticated fetch; falls back to
 * the WebID's origin.  Returns null if neither works.
 */
async function derivePodRoot(oidc, webid) {
  if (!webid) return null;
  try {
    const fetchFn = oidc.getAuthenticatedFetch();
    const res = await fetchFn(webid, {
      headers: { Accept: 'text/turtle, application/ld+json;q=0.9, */*;q=0.5' },
    });
    if (res.ok) {
      const body = await res.text();
      const m = body.match(/pim:storage\s*<([^>]+)>/) ?? body.match(/"http:\/\/www\.w3\.org\/ns\/pim\/space#storage"\s*:\s*\{?\s*"@id"\s*:\s*"([^"]+)"/);
      if (m?.[1]) return m[1];
    }
  } catch { /* fall through */ }
  try {
    const u = new URL(webid);
    return `${u.origin}/`;
  } catch {
    return null;
  }
}
