/**
 * basis v2 — real-pod routing for the per-circle producer (S4 circle OIDC).
 *
 * Turns an authenticated pod SESSION (`{ webid, isLoggedIn, fetch }` from the existing
 * browser Solid-OIDC wrapper `src/web/podAuth.js`) into the `makePodClient` + `circleRootUri`
 * a sealed circle's producer needs to store to a REAL Solid pod instead of the in-memory
 * pseudo-pod. Reuses `@onderling/pod-client`'s `SolidOidcAuth` (the folio `_podFactory` pattern):
 * the session's DPoP `fetch` is wrapped in an auth-vault.
 *
 * Deps are injectable for tests (no hard pod-client import needed to unit-test the routing
 * decision + URI shaping). Returns `null` when there is no live session → the caller falls
 * back to the pseudo-pod (offline / not-signed-in), so this is purely additive.
 */

import { isPodUrl } from './connectionPoints.js';

/** Derive a pod ROOT from a WebID (`https://me.pod/profile/card#me` → `https://me.pod/`).
 *  Heuristic FALLBACK only — prefer the host passing a `podRoot` resolved via the canonical
 *  `discoverPodRoot(session)` (src/web/podStorage.js — reads the WebID's `pim:storage`). */
export function podRootFromWebid(webid) {
  if (typeof webid !== 'string' || !webid) return null;
  const i = webid.indexOf('/profile/');
  let base = i >= 0 ? webid.slice(0, i + 1) : webid.replace(/[#?].*$/, '').replace(/\/[^/]*$/, '/');
  if (!base.endsWith('/')) base += '/';
  // The same rule as everywhere else (2026-07-30). This function used to accept any `http://` host, the
  // invite builder demanded `https://`, and the connection-point store agreed with the invite — so a
  // circle could be created on a pod that one component considered valid and another silently refused.
  return isPodUrl(base) ? base : null;
}

/**
 * @param {{ webid:string, isLoggedIn:boolean, fetch:Function }|null} session
 * @param {{ PodClient:Function, SolidOidcAuth:Function, circlesPath?:string, podRoot?:string }} deps
 *   `podRoot` (optional): the discovered pod root (from `discoverPodRoot`); falls back to the heuristic.
 * @returns {{ podRoot:string, makePodClient:(circleId:string)=>object, circleRootUri:(circleId:string)=>string } | null}
 */
export function realPodRouting(session, { PodClient, SolidOidcAuth, circlesPath = 'circles', podRoot: podRootArg } = {}) {
  if (!session || !session.isLoggedIn || typeof session.fetch !== 'function' || !session.webid) return null;
  if (typeof PodClient !== 'function' || typeof SolidOidcAuth !== 'function') return null;
  let podRoot = podRootArg || podRootFromWebid(session.webid);
  if (!podRoot) return null;
  if (!podRoot.endsWith('/')) podRoot += '/';

  // Wrap the session's DPoP fetch as the auth-vault SolidOidcAuth expects.
  const authVault = {
    getAuthenticatedFetch: () => session.fetch,
    get webid() { return session.webid; },
    refresh: async () => {},
  };
  const auth = new SolidOidcAuth({ vault: authVault });
  return {
    podRoot,
    makePodClient: () => new PodClient({ podRoot, auth }),
    circleRootUri: (circleId) => `${podRoot}${circlesPath}/${circleId}`,
  };
}
