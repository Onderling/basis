/**
 * podSignIn — Tasks V2 substrate-adoption (2026-05-14).
 *
 * Mirror of Pinboard's `apps/pinboard/src/lib/podSignIn.js`. Glue between
 * `createSolidAuthNode` (browser-redirect Solid OIDC, via
 * `@onderling/oidc-session`) and the circle bundle's
 * `CachingDataSource`. Four operations:
 *
 *   - `startPodSignIn({ circle, issuer, redirectUrl })`
 *       → Kicks off OIDC. Returns the IdP authorize URL the browser
 *         should navigate to.
 *
 *   - `completePodSignIn({ circle, callbackUrl, dataSourceFactory? })`
 *       → After the IdP redirect lands on `redirectUrl`, completes
 *         the dance + builds a `SolidPodSource` (or whatever
 *         `dataSourceFactory` returns) + calls
 *         `circle.dataSource.attachInner(podSource)`. Returns
 *         `{ ok, webid, podRoot }`.
 *
 *   - `signOutOfPod({ circle })`
 *       → Clears OIDC session + detaches the inner DataSource (cache
 *         keeps local state so the user keeps working offline).
 *
 *   - `podSignInStatus({ circle })`
 *       → Read-only `{signedIn, webid, podAttached}`.
 *
 * The `oidcSession` instance lives on `circle.oidcSession` (lazily
 * created on first sign-in attempt; reused across attempts). Tasks
 * runs one circle per process today so per-circle session-state is fine;
 * when multi-circle runtime lands, each circle gets its own session slot.
 *
 * ── Session-injection seam (Tasks V2 mobile S5, 2026-05-18) ──
 *
 * The default OIDC session is the Node browser-redirect
 * `createSolidAuthNode` (web path — UNCHANGED). React Native cannot
 * use it (`@inrupt/solid-client-authn-browser` needs `window`), and
 * its RN equivalent (`@onderling/oidc-session-rn`) acquires tokens via a
 * hook-driven PKCE flow + `adoptTokens(tokens)` rather than
 * `start()`/`handleCallback()`. So an OPTIONAL `sessionFactory`
 * argument may be threaded through all four operations to inject the
 * device-specific session — mirrors the existing `dataSourceFactory`
 * seam in `completePodSignIn`. When omitted, behaviour is
 * byte-identical to before (lazy `createSolidAuthNode`).
 *
 * `completePodSignIn` additionally accepts an alternative `tokens`
 * input: when the caller already holds OIDC tokens (the RN hook
 * path), it adopts them onto the (injected) session instead of
 * running `handleCallback(callbackUrl)`. The shareable post-auth
 * orchestration — `derivePodRoot` → `SolidPodSource` →
 * `dataSource.attachInner` → status/sign-out — stays common to both
 * platforms. Web callers pass `callbackUrl` exactly as before.
 */

import { SolidPodSource } from '@onderling/pod-client';
import { createSolidAuthNode } from '@onderling/oidc-session';
import { attachTasksBundle, detachTasksBundle } from './attachTasksBundle.js';

/** Lazily build a vault for OIDC token storage. */
function defaultVault() {
  const m = new Map();
  return {
    async get(k)    { return m.get(k); },
    async set(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
  };
}

/**
 * Ensure `circle.oidcSession` exists, building it via the default Node
 * factory unless an injected `sessionFactory` is supplied.
 *
 * @param {object} circle
 * @param {(opts: {vault: object, clientName: string}) => object} [sessionFactory]
 *   Optional. When provided, used INSTEAD of `createSolidAuthNode`
 *   to construct the per-circle session. The default (no factory) path
 *   is unchanged — same lazy `createSolidAuthNode({vault, clientName})`
 *   call the web app has always used.
 */
function ensureSession(circle, sessionFactory) {
  if (!circle.oidcSession) {
    const make = typeof sessionFactory === 'function'
      ? sessionFactory
      : createSolidAuthNode;
    circle.oidcSession = make({
      vault: circle.oidcVault ?? defaultVault(),
      clientName: 'Tasks',
    });
  }
  return circle.oidcSession;
}

/**
 * Phase 1 of sign-in. Returns `{ ok, redirectUrl }` where
 * `redirectUrl` is the IdP authorize URL the browser should
 * navigate to.
 */
export async function startPodSignIn({ circle, issuer, redirectUrl, sessionFactory }) {
  if (!circle?.dataSource || typeof circle.dataSource.attachInner !== 'function') {
    return { ok: false, error: 'circle missing CachingDataSource (was cache: false?)' };
  }
  if (!issuer)      return { ok: false, error: 'issuer required' };
  if (!redirectUrl) return { ok: false, error: 'redirectUrl required' };

  const oidc = ensureSession(circle, sessionFactory);
  try {
    const r = await oidc.start({ issuer, redirectUrl });
    return { ok: true, redirectUrl: r.redirectUrl };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/**
 * Phase 2 of sign-in. Completes the OIDC dance + attaches a
 * pod-backed DataSource to the circle's CachingDataSource.
 *
 * Two mutually-exclusive auth-completion inputs:
 *   - `callbackUrl` (web / Node default): runs
 *     `oidc.handleCallback(callbackUrl)` on the existing session
 *     created by `startPodSignIn`. UNCHANGED behaviour.
 *   - `tokens` (RN path): the caller already ran the PKCE flow (the
 *     `@onderling/oidc-session-rn` hook) and holds tokens. We adopt
 *     them onto the (optionally injected) session. `startPodSignIn`
 *     need not have run first in this mode.
 *
 * @param {object}   args.circle
 * @param {string}   [args.callbackUrl]        web path
 * @param {object}   [args.tokens]             RN path (adoptTokens)
 * @param {Function} [args.dataSourceFactory]  existing seam (unchanged)
 * @param {Function} [args.sessionFactory]     session-injection seam
 */
export async function completePodSignIn({
  circle, callbackUrl, tokens, dataSourceFactory, sessionFactory,
}) {
  if (!circle?.dataSource || typeof circle.dataSource.attachInner !== 'function') {
    return { ok: false, error: 'circle missing CachingDataSource (was cache: false?)' };
  }

  let oidc;
  let info;
  if (tokens) {
    // RN path — adopt pre-acquired tokens onto the (injected)
    // session. ensureSession honours an injected sessionFactory; the
    // RN caller injects an `OidcSessionRN`-shaped session whose
    // `adoptTokens` persists the bearer token.
    oidc = ensureSession(circle, sessionFactory);
    if (typeof oidc.adoptTokens !== 'function') {
      return { ok: false, error: 'session does not support adoptTokens (tokens path needs an RN-style session)' };
    }
    try {
      await oidc.adoptTokens(tokens);
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) };
    }
    info = { webid: tokens.webid ?? oidc.webid ?? null };
  } else {
    // Web path — UNCHANGED. Requires a session started by
    // startPodSignIn, then handleCallback(callbackUrl).
    if (!circle?.oidcSession) {
      return { ok: false, error: 'no sign-in in progress; call startPodSignIn first' };
    }
    oidc = circle.oidcSession;
    try {
      info = await oidc.handleCallback(callbackUrl);
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) };
    }
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

  // M4: device-independent pod-attach activation — the SAME helper
  // tasks-mobile's ServiceContext.attachPod calls. Wires setAnchor +
  // _podCtx (classify/reverse) + cache.attachInner so routing/
  // provisioning behave identically on web and mobile (platform-parity
  // principle, mirror of pinboard commit 11a269a).
  //
  // `circle` here is a `{dataSource: CachingDataSource, …}` shaped holder
  // — it maps to `bundle.cache` in the attachTasksBundle contract.
  // We adapt: pass `cache: circle.dataSource` as the bundle so the helper
  // calls `circle.dataSource.attachInner(inner)`.
  const bundleProxy = {
    cache:             circle.dataSource,
    _podCtx:           circle._podCtx     ?? null,
    podRouting:        circle.podRouting  ?? null,
    pseudoPod:         circle.pseudoPod   ?? null,
    substrateDeviceId: circle.substrateDeviceId ?? null,
    circleId:            circle.circleId      ?? null,
  };
  await attachTasksBundle({
    bundle: bundleProxy,
    source: inner,
    podRoot,
    webid:  info?.webid ?? oidc.webid ?? null,
    fetch:  fetchFn,
    circleId: circle.circleId ?? null,
  });

  return { ok: true, webid: info?.webid ?? oidc.webid ?? null, podRoot };
}

/** Detach inner + clear OIDC session. Local cache is preserved. */
export async function signOutOfPod({ circle }) {
  // M4: deactivate routing (_podCtx.active = false + revert anchor).
  detachTasksBundle({ bundle: { _podCtx: circle?._podCtx ?? null, podRouting: circle?.podRouting ?? null } });
  if (circle?.dataSource?.attachInner) await circle.dataSource.attachInner(null);
  if (circle?.oidcSession?.logout) {
    try { await circle.oidcSession.logout(); } catch { /* best-effort */ }
  }
  circle.oidcSession = null;
  return { ok: true };
}

/** Read-only status. */
export function podSignInStatus({ circle }) {
  const oidc = circle?.oidcSession;
  if (!oidc) return { signedIn: false };
  return {
    signedIn:    oidc.isAuthenticated(),
    webid:       oidc.webid ?? null,
    podAttached: !!circle.dataSource?.hasInner,
  };
}

/**
 * Resolve the pod root from the WebID's profile. Tries the
 * `pim:storage` triple via the authenticated fetch; falls back to
 * the WebID's origin. Returns null if neither works.
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
