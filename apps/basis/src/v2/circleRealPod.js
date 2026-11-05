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

/**
 * Does this device's pod hold the circle's root? Only then can it write the circle's access rules: on a central-pod
 * circle every other member reads and writes there under the owner's grants, and an attempt of theirs is refused.
 * @param {{ podRoot?: string|null, circleRootUri?: string|null }} a
 * @returns {boolean}
 */
export function ownsCircleRoot({ podRoot = null, circleRootUri = null } = {}) {
  if (typeof podRoot !== 'string' || !podRoot || typeof circleRootUri !== 'string' || !circleRootUri) return false;
  const base = podRoot.endsWith('/') ? podRoot : `${podRoot}/`;
  return `${circleRootUri.replace(/\/+$/, '')}/`.startsWith(base);
}

/**
 * Where a circle's pod data lives — one answer for every member and both shells. A CENTRAL-POD (shared / hybrid)
 * circle lives at the address it was given (the founder's storage policy; a joiner's pod connection point from the
 * invite): the founder and every joiner read and write THAT, each with their own session under the grants the circle
 * writes per member. With no recorded address there is no root — never quietly the member's own pod, which is how a
 * central-pod circle used to share nothing (each member wrote and read its own pod). A POD-ONLY (personal) circle keeps
 * each member's own pod.
 *
 * @param {object} a
 * @param {string} a.pod                  the circle's storage posture name ('none' | 'personal' | 'shared' | 'hybrid')
 * @param {string|null} [a.recordedPodUri] the circle's recorded pod address
 * @param {string|null} [a.ownCircleRoot] this member's own pod root for the circle (`routing.circleRootUri(id)`)
 * @returns {string|null}
 */
export function circleRootFor({ pod, recordedPodUri = null, ownCircleRoot = null } = {}) {
  if (pod === 'shared' || pod === 'hybrid') {
    if (typeof recordedPodUri !== 'string' || !/^https?:\/\//.test(recordedPodUri.trim())) return null;
    return recordedPodUri.trim().replace(/\/+$/, '');
  }
  return ownCircleRoot ?? null;
}

/**
 * The address a circle was given, as this device holds it: the founder's own storage policy, else the pod connection
 * point a joiner recorded from the invite. Null when neither is known.
 *
 * @param {{ callSkill: Function, points?: { pointsFor: (id: string) => Array<{kind: string, url: string}> }|null, circleId: string }} a
 * @returns {Promise<string|null>}
 */
export async function recordedCirclePodUri({ callSkill, points = null, circleId } = {}) {
  try {
    const r = await callSkill?.('pinboard', 'getCircleStoragePolicy', { groupId: circleId });
    if (typeof r?.groupPodUri === 'string' && r.groupPodUri) return r.groupPodUri;
  } catch { /* the joiner's point below */ }
  try {
    const p = (points?.pointsFor?.(circleId) ?? []).find((x) => x?.kind === 'pod' && typeof x?.url === 'string' && x.url);
    if (p) return p.url;
  } catch { /* none known */ }
  return null;
}
