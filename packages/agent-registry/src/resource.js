/**
 * Agent-registry resource shape + read/write helpers.
 *
 * Lives at `<anchor-pod>/private/agent-registry` (or
 * `pseudo-pod://<deviceId>/private/agent-registry` for no-pod
 * users). The substrate reads + writes through the pseudo-pod —
 * cache mode handles real-pod write-through, replication-ring
 * mode keeps a no-pod replica in sync across the user's devices.
 *
 * Wire shape (forward-additive):
 *
 *   {
 *     v: 2,
 *     agents: [{
 *       agentId, pubKey, webid?, agentUri, role, name?, deviceId?,
 *       capabilities, grants, signedAt, revokedAt
 *     }],
 *     updatedAt: ISO
 *   }
 *
 * `grants[]` (v2+) holds the fine-grained signed-token authorities
 * `{ tokenId, skill, expiresAt, subject, capability }`. The token is the
 * enforced authority; `capabilities[]` only mirrors the coarse
 * `capability` of each grant. v1 resources (no `grants`) migrate
 * forward with `grants → []`.
 */

import { normaliseProperties } from './profileProperties.js';
import { normalizeExposure } from './skillExposure.js';

// v3 (identity step 2) — added per-profile `properties` (own/inherit graph) + `ownerFingerprint`
// (the owner-root binding). Additive + forward-compatible: v2 entries simply lack them (→ {} / null).
/** Current agent-registry wire-format version (v3 = v2 + per-profile `properties` + `ownerFingerprint`). */
export const RESOURCE_VERSION = 3;

/**
 * Default registry-resource path for a given pod / device.
 *
 * **Pseudo-pod-authoritative by default.** The registry lives on the
 * *pseudo-pod*: `pod-onboarding` seeds it there during provisioning, and
 * the underlying pseudo-pod can only write to `pseudo-pod://`
 * URIs. Pod-side mirroring at `<anchorPodUri>/private/agent-registry`
 * is later work — wired through cache-mode pseudo-pod once
 * the consuming app composes the registry's pseudo-pod in cache mode.
 *
 * Callers that want the pod-side path today can pass `preferPodUri: true`
 * (forces the https:// path; the pseudo-pod must accept it, i.e. be
 * cache-mode or wrap a pod-client).
 */
export function registryResourceUri({ anchorPodUri, deviceId, preferPodUri = false }) {
  if (preferPodUri && typeof anchorPodUri === 'string' && anchorPodUri.length > 0) {
    const base = anchorPodUri.endsWith('/') ? anchorPodUri.slice(0, -1) : anchorPodUri;
    return `${base}/private/agent-registry`;
  }
  if (typeof deviceId === 'string' && deviceId.length > 0) {
    return `pseudo-pod://${deviceId}/private/agent-registry`;
  }
  if (typeof anchorPodUri === 'string' && anchorPodUri.length > 0) {
    const base = anchorPodUri.endsWith('/') ? anchorPodUri.slice(0, -1) : anchorPodUri;
    return `${base}/private/agent-registry`;
  }
  throw Object.assign(
    new Error('registryResourceUri: deviceId (preferred) or anchorPodUri is required'),
    { code: 'INVALID_ARGUMENT' },
  );
}

/**
 * Default empty resource body.
 */
export function emptyResource() {
  return Object.freeze({
    v:         RESOURCE_VERSION,
    agents:    Object.freeze([]),
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Normalise a resource read from the pseudo-pod. Tolerates absent
 * fields; freezes the result.
 */
export function normaliseResource(raw) {
  if (!raw || typeof raw !== 'object') return emptyResource();
  const agents = Array.isArray(raw.agents) ? raw.agents : [];
  return Object.freeze({
    v:         typeof raw.v === 'number' ? raw.v : RESOURCE_VERSION,
    agents:    Object.freeze(agents.map(_normaliseAgent)),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  });
}

function _normaliseAgent(a) {
  if (!a || typeof a !== 'object') return Object.freeze({ ...emptyAgent() });
  return Object.freeze({
    agentId:      typeof a.agentId === 'string' ? a.agentId : '',
    pubKey:       typeof a.pubKey  === 'string' ? a.pubKey  : '',
    webid:        typeof a.webid   === 'string' ? a.webid   : null,
    agentUri:     typeof a.agentUri === 'string' ? a.agentUri : '',
    role:         typeof a.role    === 'string' ? a.role    : 'device',
    name:         typeof a.name    === 'string' ? a.name    : null,
    deviceId:     typeof a.deviceId === 'string' ? a.deviceId : null,
    capabilities: Array.isArray(a.capabilities) ? Object.freeze([...a.capabilities]) : Object.freeze([]),
    grants:       Array.isArray(a.grants) ? Object.freeze(a.grants.map(_normaliseGrant).filter(Boolean)) : Object.freeze([]),
    signedAt:     typeof a.signedAt === 'string' ? a.signedAt : new Date().toISOString(),
    revokedAt:    typeof a.revokedAt === 'string' ? a.revokedAt : null,
    // identity step 2 — profile fields (additive; absent on v2 entries → {} / null)
    properties:       normaliseProperties(a.properties),
    ownerFingerprint: typeof a.ownerFingerprint === 'string' ? a.ownerFingerprint : null,
    // property layer (personas) — the PERSISTED per-context disclosure policy for this profile
    // (what this persona shares, per circle/context). Additive; absent → empty. Shape mirrors
    // @onderling/agent-registry disclosure.js ({ perContext: { ctx: { key: {enabled, rung} } } }).
    disclosure:       _normaliseDisclosure(a.disclosure),
    // Per-skill EXPOSURE (which skills this agent ADVERTISES, per circle). Additive; absent → nothing
    // hidden. A discovery filter only — the dispatch grant is the enforcement. → src/skillExposure.js.
    exposure:         normalizeExposure(a.exposure),
  });
}

/** Strict-allowlist normalise for a persisted disclosure policy. Frozen. Absent/malformed → empty. */
function _normaliseDisclosure(d) {
  const per = d && typeof d === 'object' && d.perContext && typeof d.perContext === 'object' ? d.perContext : {};
  const out = {};
  for (const [ctx, entries] of Object.entries(per)) {
    if (!entries || typeof entries !== 'object') continue;
    const c = {};
    for (const [key, choice] of Object.entries(entries)) {
      if (!choice || typeof choice !== 'object') continue;
      // Persist ALL THREE independent disclosure axes (disclosure.js): disclosed
      // (enabled+rung) · matchable · requestable. Previously this allowlist kept only
      // {enabled,rung}, silently dropping matchable/requestable on persistence — so a
      // persona's `requestable` offering never survived the registry round-trip and the
      // requestable-bridge guard (`isRequestable`) always read false. Additive +
      // backward-compatible: an old entry lacking the axes reads them as false.
      c[key] = Object.freeze({
        enabled:     choice.enabled === true,
        rung:        typeof choice.rung === 'string' ? choice.rung : null,
        matchable:   choice.matchable === true,
        requestable: choice.requestable === true,
      });
    }
    out[ctx] = Object.freeze(c);
  }
  return Object.freeze({ perContext: Object.freeze(out) });
}

/**
 * Strict-allowlist normalise for a single grant. Drops entries without
 * a usable `tokenId`; coerces the rest. Frozen.
 */
function _normaliseGrant(g) {
  if (!g || typeof g !== 'object') return null;
  if (typeof g.tokenId !== 'string' || g.tokenId.length === 0) return null;
  return Object.freeze({
    tokenId:    g.tokenId,
    skill:      typeof g.skill      === 'string' ? g.skill      : null,
    expiresAt:  typeof g.expiresAt  === 'string' ? g.expiresAt  : null,
    subject:    typeof g.subject    === 'string' ? g.subject    : null,
    capability: typeof g.capability === 'string' ? g.capability : null,
    // identity step 2.3 — a grant may NAME a profile the grantee (a device) may run,
    // so "delegate profile X to device D, revocably" rides the same token-first path.
    profile:    typeof g.profile    === 'string' ? g.profile    : null,
  });
}

function emptyAgent() {
  return {
    agentId:   '',
    pubKey:    '',
    webid:     null,
    agentUri:  '',
    role:      'device',
    name:      null,
    deviceId:  null,
    capabilities: [],
    grants:    [],
    signedAt:  new Date().toISOString(),
    revokedAt: null,
    properties: {},
    ownerFingerprint: null,
    disclosure: { perContext: {} },
    exposure: { hidden: [], perCircle: {} },
  };
}
