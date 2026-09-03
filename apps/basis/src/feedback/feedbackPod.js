// Browser-auth wiring (Tier 3c) — turn a logged-in Solid pod session into the participant's
// REAL feedback pod: call the activation service with the participant's WebID + cohort code
// to provision/get their ACP-locked container, then back a CssCentralPod (flat: their own
// container) with the session's authenticated, browser-key fetch. Pre-send: the floor runs
// on-device and the participant writes their OWN container — nothing raw leaves, and the
// write IS the consent.

// Single sanctioned import point into feedback (F1 boundary — the package `./public` barrel).
import { loadFeedbackPackage } from './feedbackPackage.js';

/** POST the activation service → the participant's container URI (podRef). */
export async function activateParticipant({ activationUrl, projectId, code, recoveryHash, webId, fetchImpl = fetch }) {
  if (!activationUrl || !projectId || !code || !webId) throw new Error('activateParticipant: activationUrl, projectId, code, webId required');
  const res = await fetchImpl(`${activationUrl.replace(/\/$/, '')}/activate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId, code, recoveryHash, webId }),
  });
  let json = {};
  try { json = await res.json(); } catch { /* leave {} */ }
  if (!res.ok || !json.ok) throw new Error(json.reason || `activation failed (HTTP ${res.status})`);
  return json.podRef;
}

/** Activate, then build a flat CssCentralPod over the browser session's authenticated fetch. */
export async function buildFeedbackPod({ session, activationUrl, projectId, code, recoveryHash, fetchImpl }) {
  const { makeCssCentralPod } = await loadFeedbackPackage();
  if (!session?.webid || typeof session.fetch !== 'function') throw new Error('buildFeedbackPod: a logged-in session {webid, fetch} is required');
  const podRef = await activateParticipant({ activationUrl, projectId, code, recoveryHash, webId: session.webid, fetchImpl });
  return makeCssCentralPod({ podBase: podRef, authedFetch: session.fetch, flat: true });
}

/** Derive the participant's OWN-pod root from their WebID (CSS: `<root>profile/card#me` → `<root>`). */
export function podRootFromWebId(webId) {
  const u = new URL(webId);
  const path = u.pathname.replace(/profile\/card.*$/, '');     // strip the profile doc + fragment
  return `${u.origin}${path.endsWith('/') ? path : `${path}/`}`;
}

/**
 * Discover the participant's REAL pod storage root from their WebID document's `pim:space#storage`
 * predicate (the Solid way stoop's pod-attach uses). Critical for providers where the WebID host is NOT
 * the storage host — e.g. Inrupt PodSpaces: WebID `https://id.inrupt.com/<user>` but storage
 * `https://storage.inrupt.com/<uuid>/`. Munging the WebID host (podRootFromWebId) writes to the identity
 * server → 404. The WebID doc is public, so a plain fetch suffices; falls back to host-munging (CSS pods).
 */
export async function discoverPodRoot(webId, fetchImpl = fetch) {
  // RETRY: a single flaky WebID read (a network blip on id.inrupt.com) must NOT silently fall back to the
  // host-munge — for Inrupt that writes to the IDENTITY host (id.inrupt.com/<name>/), which 404s every write.
  // Only fall back after 3 genuine misses.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetchImpl(webId, { headers: { accept: 'text/turtle' } });
      if (res.ok) {
        const ttl = await res.text();
        const m = ttl.match(/pim\/space#storage>\s*<([^>]+)>/);
        if (m?.[1]) return m[1].endsWith('/') ? m[1] : `${m[1]}/`;
      }
    } catch { /* retry, then fall through to host-munging */ }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
  }
  return podRootFromWebId(webId);
}

/**
 * Verify-summary loop wiring (own-pod-first) — activate, then return the three things the surface needs
 * from the participant's session. The raw never leaves the participant's own pod; only the verified
 * summary reaches central (proven live in scripts/verify-summary-css.js).
 *   • ownPod      — a container on the participant's OWN pod (raw stays; the central owner has no access)
 *   • centralPod  — the activation-provisioned container (owner-readable; the VERIFIED summary lands here)
 *   • controlStore — the shared `/control/` container (the lead opens rounds; the participant reads them)
 * @returns {Promise<{ownPod, centralPod, controlStore}>}
 */
export async function buildFeedbackVerifyPods({ session, activationUrl, projectId, code, recoveryHash, fetchImpl, ownPodBase, podRef: existingPodRef } = {}) {
  const { makeCssCentralPod, PodRoundControl } = await loadFeedbackPackage();
  if (!session?.webid || typeof session.fetch !== 'function') throw new Error('buildFeedbackVerifyPods: a logged-in session {webid, fetch} is required');
  // skip activation when we already hold the participant's container (re-open / reload) — the cohort code
  // is single-use, so re-activating would fail. Returns podRef so the caller can persist + reuse it.
  const podRef = existingPodRef || await activateParticipant({ activationUrl, projectId, code, recoveryHash, webId: session.webid, fetchImpl });
  const centralPod = await makeCssCentralPod({ podBase: podRef, authedFetch: session.fetch, flat: true });
  // discover the REAL storage root (pim:storage) — NOT the WebID host. Inrupt PodSpaces stores at
  // storage.inrupt.com/<uuid>/, so munging id.inrupt.com/<user> wrote to the identity server → 404.
  // read the WebID with the SESSION's authed fetch (refresh-capable, reliable) rather than a bare unauth
  // fetch — a flaky read here used to fall back to the identity host and 404 every write.
  const ownBase = ownPodBase || `${await discoverPodRoot(session.webid, session.fetch || fetchImpl)}feedback-own/`;
  // the own pod is the participant's OWN pod — the activation service can't reach it, so ensure the
  // container exists here with the participant's own session (they own it; idempotent — 2xx OR 409/412).
  await session.fetch(ownBase, { method: 'PUT', headers: { 'content-type': 'text/turtle', link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"' } }).catch(() => {});
  const ownPod = await makeCssCentralPod({ podBase: ownBase, authedFetch: session.fetch, flat: true });
  const controlBase = podRef.replace(/[^/]+\/$/, 'control/');   // sibling of the participant's container
  // the /control/ container is PUBLIC-read (the lead writes it) — read it UNAUTHENTICATED. Using the
  // participant's session token here breaks cross-login setups (an Inrupt login reading the local pod: the
  // pod server rejects the foreign token even for a public resource). A plain fetch always works for public.
  const publicFetch = (u, i) => fetch(u, i);
  const controlStore = new PodRoundControl({ pod: await makeCssCentralPod({ podBase: controlBase, authedFetch: publicFetch, flat: true }) });
  return { ownPod, centralPod, controlStore, podRef };
}

/** A stable client recovery hash kept in localStorage — the secret never leaves the device,
 *  only its hash is sent. Browser-only; Node callers pass recoveryHash directly. */
export async function getOrCreateRecoveryHash(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage || typeof crypto === 'undefined' || !crypto.subtle) throw new Error('recovery hash needs a browser (localStorage + crypto.subtle)');
  let secret = storage.getItem('fp.recovery');
  if (!secret) {
    secret = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
    storage.setItem('fp.recovery', secret);
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
