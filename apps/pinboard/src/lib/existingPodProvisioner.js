/**
 * existingPodProvisioner — Phase 2.2 of the pod-storage routing work
 * (decision -b: idempotent adopt-existing-pod provisioner).
 *
 * Pinboard users sign in to an Inrupt pod they ALREADY own (the OIDC
 * flow derives `podRoot` from the WebID's `pim:storage`).
 * `@onderling/pod-onboarding`'s `provisionDefault` is built around
 * *creating* a pod via an injected `podProvisioner.createPod()`; here
 * `createPod()` simply returns the already-authed existing pod, so we
 * reuse provisionDefault's steps 3-7 (containers + initial resources
 * + local pseudo-pod mirror) without any pod creation.
 *
 * Idempotent: `ensurePodProvisioned` HEADs `<podRoot>/private/
 * storage-mapping` and skips entirely if it already exists.
 *
 * Best-effort by design — provisioning failure must NEVER block local
 * use (`conventions/pod-independence.md`): the caller swallows it and
 * Pinboard keeps working no-pod / local-first.
 *
 * V1 limitations (documented, not bugs — Phase-3 refinements):
 *   - `setAcp` omitted: Inrupt pods are owner-private by default, so
 *     the canonical `/private/` + `/sharing/` containers are already
 *     owner-only. The `/sharing/public/` world-read ACP is deferred.
 *   - `patchWebidProfile` omitted: third-party `dec:`-pointer
 *     discovery is deferred; Pinboard reads its own routing config
 *     (the storage-mapping resource we PUT here + the pseudo-pod
 *     mirror) directly, so it does not need the WebID patch yet.
 *   `provisionDefault` skips both when the provisioner doesn't expose
 *   them (`typeof podProvisioner.X === 'function'`).
 */

import { provisionDefault } from '@onderling/pod-onboarding';

function _stripSlash(s) {
  return s.replace(/\/+$/, '');
}

/**
 * @param {object} a
 * @param {string} a.podRoot      e.g. `https://id.inrupt.com/alice/`
 * @param {string} a.webid
 * @param {(url:string, init?:object)=>Promise<Response>} a.fetch  authed fetch
 * @returns {object} a `podProvisioner` for `provisionDefault`
 */
export function createExistingPodProvisioner({ podRoot, webid, fetch: authedFetch }) {
  if (typeof podRoot !== 'string' || podRoot.length === 0) {
    throw Object.assign(new Error('createExistingPodProvisioner: podRoot required'),
      { code: 'INVALID_ARGUMENT' });
  }
  if (typeof authedFetch !== 'function') {
    throw Object.assign(new Error('createExistingPodProvisioner: fetch required'),
      { code: 'INVALID_ARGUMENT' });
  }
  const podUri = _stripSlash(podRoot) + '/';

  return {
    // The pod already exists — adopt it, no creation / OIDC here.
    async createPod() {
      return { podUri, webidUri: webid, fetch: authedFetch };
    },

    // Idempotent LDP container PUT. An already-existing container can
    // answer 200/204/205/409/412 depending on the server — none fatal.
    // Best-effort: a failure here must not abort provisioning of the
    // resources that matter (storage-mapping).
    async createContainer({ uri, fetch: f }) {
      try {
        await (f ?? authedFetch)(uri, {
          method:  'PUT',
          headers: {
            'Content-Type': 'text/turtle',
            Link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
          },
        });
      } catch { /* best-effort — server may already have it */ }
    },

    async putResource({ uri, body, contentType, fetch: f }) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      const res = await (f ?? authedFetch)(uri, {
        method:  'PUT',
        headers: { 'Content-Type': contentType || 'application/json' },
        body:    payload,
      });
      if (res && typeof res.ok === 'boolean' && !res.ok) {
        throw Object.assign(
          new Error(`putResource: PUT ${uri} → ${res.status}`),
          { code: 'PROVISIONER_FAILED', status: res.status },
        );
      }
    },

    // setAcp / patchWebidProfile intentionally NOT exposed — see the
    // module JSDoc (V1 limitations). `provisionDefault` skips them.
  };
}

/**
 * Idempotently ensure the user's existing pod has the canonical
 * containers + storage-mapping (+ agent-registry + local mirror).
 * Safe to call on every `attachPod` — it HEADs the storage-mapping
 * resource and no-ops if already provisioned.
 *
 * NEVER throws — provisioning failure returns `{provisioned:false,
 * error}` so the caller can keep running local-first.
 *
 * @param {object} a
 * @param {string} a.podRoot
 * @param {string} a.webid
 * @param {Function} a.fetch     authed fetch
 * @param {object} a.pseudoPod   the bundle's pseudo-pod (mirror copy)
 * @param {object} a.identity    AgentIdentity (has `.pubKey`)
 * @param {object} a.agentInfo   `{ deviceId, agentUri }`
 * @returns {Promise<{provisioned:boolean, skipped?:boolean, error?:Error}>}
 */
export async function ensurePodProvisioned({
  podRoot, webid, fetch: authedFetch, pseudoPod, identity, agentInfo,
}) {
  try {
    const smUri = _stripSlash(podRoot) + '/private/storage-mapping';
    try {
      const head = await authedFetch(smUri, { method: 'HEAD' });
      if (head && head.ok) return { provisioned: false, skipped: true };
    } catch { /* unreachable / not-found → fall through to provision */ }

    await provisionDefault({
      podProvisioner: createExistingPodProvisioner({ podRoot, webid, fetch: authedFetch }),
      pseudoPod,
      identity,
      agentInfo,
    });
    return { provisioned: true };
  } catch (error) {
    // pod-independence.md: never block local-first use.
    return { provisioned: false, error };
  }
}
