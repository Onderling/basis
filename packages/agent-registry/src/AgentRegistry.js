/**
 * createAgentRegistry — the substrate factory.
 *
 * Reads + mutates the agent-registry pod resource via the pseudo-pod,
 * with etag-based optimistic concurrency. Apps inject the pseudo-pod;
 * the substrate owns the resource shape, validation, indexing, and
 * retry policy.
 *
 * Standardisation Phase 52.10.
 */

import {
  registryResourceUri,
  normaliseResource,
  emptyResource,
  RESOURCE_VERSION,
} from './resource.js';
import { withCAS } from './concurrency.js';
import { normalizeExposure } from './skillExposure.js';

/**
 * Build the live agent-registry handle over an injected pseudo-pod: etag-CAS reads/writes of the
 * registry resource with retry, plus optional per-write snapshots via a `versionStore`. Returns
 * `{register, lookup, revoke, purge, updateCapabilities, updateExposure, applyGrant, revokeGrant, list, reload,
 * resourceUri}`. The resource URI resolves from the `resourceUri` override, else `deviceId`
 * (pseudo-pod path), else `anchorPodUri`; throws INVALID_ARGUMENT without a usable `pseudoPod`.
 *
 * @param {object} opts
 * @param {object}  opts.pseudoPod
 * @param {string}  [opts.anchorPodUri]   — pod URI (metadata; pod-side mirroring
 *                                          lands with cache-mode pseudo-pod).
 * @param {string}  [opts.deviceId]       — strongly recommended; default store path.
 * @param {boolean} [opts.preferPodUri]   — force the https:// resource path
 *                                          (caller's pseudo-pod must accept it).
 * @param {string}  [opts.resourceUri]    — explicit override (wins over all defaults).
 * @param {number}  [opts.maxRetries=3]
 * @param {(err: Error) => void} [opts.onPersistentConflict]
 * @param {object}  [opts.versionStore]   — optional @onderling/versioning store; when supplied,
 *                                          every write snapshots the resource (best-effort).
 * @param {() => string} [opts.now]
 */
export function createAgentRegistry({
  pseudoPod,
  anchorPodUri,
  deviceId,
  preferPodUri = false,
  resourceUri,
  maxRetries,
  onPersistentConflict,
  // identity step 2.5 — optional @onderling/versioning store. When supplied, every registry write
  // snapshots the resource, so the profile set gets history / undoable recovery (the registry
  // lives on the pseudo-pod, which is NOT a versioned circle pod, so it gets none for free).
  versionStore = null,
  now = () => new Date().toISOString(),
} = {}) {
  if (!pseudoPod || typeof pseudoPod.read !== 'function') {
    throw Object.assign(
      new Error('createAgentRegistry: pseudoPod is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  const uri = resourceUri ?? registryResourceUri({ anchorPodUri, deviceId, preferPodUri });

  async function _readCurrent() {
    const rec = await pseudoPod.read(uri);
    if (!rec) return { body: emptyResource(), etag: null };
    return {
      body: normaliseResource(rec.bytes),
      etag: rec.etag ?? null,
    };
  }

  async function _writeNext(body, etag) {
    try {
      const result = await pseudoPod.write(uri, body, etag);
      // Snapshot the just-written resource (recovery). Best-effort: a versioning failure must
      // NEVER break the registry write.
      if (typeof versionStore?.capture === 'function') {
        try { await versionStore.capture(uri, JSON.stringify(body)); } catch { /* non-fatal */ }
      }
      return { etag: result?.etag };
    } catch (err) {
      // Pseudo-pod V0 / V1 doesn't yet enforce CAS — surface a CONFLICT
      // for any caller that supplies an etag-aware backend on top.
      if (err?.code === 'CONFLICT' || err?.code === 'PRECONDITION_FAILED') {
        throw Object.assign(new Error('agent-registry: write conflict'), { code: 'CONFLICT', cause: err });
      }
      throw err;
    }
  }

  function _agentMatches(a, identifier) {
    return a.agentId === identifier
        || a.pubKey === identifier
        || a.webid === identifier
        || a.agentUri === identifier
        || a.deviceId === identifier;
  }

  /**
   * Register a new agent OR update an existing entry (matched by
   * agentId). Etag-CAS retry on conflict.
   */
  async function register(entry = {}) {
    if (typeof entry.agentId !== 'string' || entry.agentId.length === 0) {
      throw Object.assign(
        new Error('register: entry.agentId is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (typeof entry.pubKey !== 'string' || entry.pubKey.length === 0) {
      throw Object.assign(
        new Error('register: entry.pubKey is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (typeof entry.agentUri !== 'string' || entry.agentUri.length === 0) {
      throw Object.assign(
        new Error('register: entry.agentUri is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    const signedAt = entry.signedAt ?? now();
    return withCAS({
      readCurrent: _readCurrent,
      writeNext:   _writeNext,
      maxRetries:  maxRetries ?? 3,
      onPersistentConflict,
      mutate(body /*, etag */) {
        const without = body.agents.filter(a => a.agentId !== entry.agentId);
        const next = {
          v:         RESOURCE_VERSION,
          agents:    [...without, {
            agentId:      entry.agentId,
            pubKey:       entry.pubKey,
            webid:        entry.webid ?? null,
            agentUri:     entry.agentUri,
            role:         entry.role ?? 'device',
            name:         entry.name ?? null,
            deviceId:     entry.deviceId ?? null,
            capabilities: Array.isArray(entry.capabilities) ? [...entry.capabilities] : [],
            grants:       Array.isArray(entry.grants) ? [...entry.grants] : [],
            signedAt,
            revokedAt:    entry.revokedAt ?? null,
            // identity step 2 — persist the profile fields (normalised on read via _normaliseAgent)
            properties:       entry.properties ?? {},
            ownerFingerprint: entry.ownerFingerprint ?? null,
            // property layer (personas) — persisted per-context disclosure policy
            disclosure:       entry.disclosure ?? { perContext: {} },
          }],
          updatedAt: now(),
        };
        return next;
      },
    });
  }

  /**
   * Look up an agent by any identifier (agentId / pubKey / webid /
   * agentUri / deviceId). Returns the frozen normalised entry, or
   * `null` on miss.
   */
  async function lookup(identifier) {
    if (typeof identifier !== 'string' || identifier.length === 0) return null;
    const { body } = await _readCurrent();
    return body.agents.find(a => _agentMatches(a, identifier)) ?? null;
  }

  /**
   * Mark an agent revoked (sets `revokedAt`). Idempotent — a
   * revoked agent stays revoked. Etag-CAS retry on conflict.
   */
  async function revoke(identifier) {
    return withCAS({
      readCurrent: _readCurrent,
      writeNext:   _writeNext,
      maxRetries:  maxRetries ?? 3,
      onPersistentConflict,
      mutate(body /*, etag */) {
        const ts = now();
        const next = {
          v:         RESOURCE_VERSION,
          agents:    body.agents.map(a =>
            _agentMatches(a, identifier) && !a.revokedAt
              ? { ...a, revokedAt: ts }
              : a,
          ),
          updatedAt: ts,
        };
        return next;
      },
    });
  }

  /**
   * Replace the `capabilities` array on a specific agent. Etag-CAS
   * retry on conflict.
   */
  async function updateCapabilities(identifier, caps) {
    if (!Array.isArray(caps)) {
      throw Object.assign(
        new Error('updateCapabilities: caps must be an array'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    return withCAS({
      readCurrent: _readCurrent,
      writeNext:   _writeNext,
      maxRetries:  maxRetries ?? 3,
      onPersistentConflict,
      mutate(body) {
        const ts = now();
        const next = {
          v:         RESOURCE_VERSION,
          agents:    body.agents.map(a =>
            _agentMatches(a, identifier)
              ? { ...a, capabilities: [...caps] }
              : a,
          ),
          updatedAt: ts,
        };
        return next;
      },
    });
  }

  /**
   * Replace an agent's per-skill EXPOSURE policy (which of its skills are advertised, per circle).
   *
   * The authority check does NOT live here — it belongs to the caller, which knows who signed the
   * change (`setSkillExposure` / `setCircleSkillExposure` in skillExposure.js return the new policy or
   * refuse). This is the persistence half only: same etag-CAS retry as every other entry mutation.
   *
   * @param {string} identifier   agentId or pubKey
   * @param {object} exposure     the new policy (normalised on write)
   */
  async function updateExposure(identifier, exposure) {
    return withCAS({
      readCurrent: _readCurrent,
      writeNext:   _writeNext,
      maxRetries:  maxRetries ?? 3,
      onPersistentConflict,
      mutate(body) {
        return {
          v:         RESOURCE_VERSION,
          agents:    body.agents.map(a =>
            _agentMatches(a, identifier) ? { ...a, exposure: normalizeExposure(exposure) } : a,
          ),
          updatedAt: now(),
        };
      },
    });
  }

  /**
   * HARD delete — removes the agent entry entirely (contrast `revoke`,
   * which only sets `revokedAt`). Idempotent: purging an absent id is a
   * no-op. Etag-CAS retry on conflict.
   */
  async function purge(identifier) {
    return withCAS({
      readCurrent: _readCurrent,
      writeNext:   _writeNext,
      maxRetries:  maxRetries ?? 3,
      onPersistentConflict,
      mutate(body /*, etag */) {
        const ts = now();
        const next = {
          v:         RESOURCE_VERSION,
          agents:    body.agents.filter(a => !_agentMatches(a, identifier)),
          updatedAt: ts,
        };
        return next;
      },
    });
  }

  /**
   * Upsert a fine-grained signed-token grant onto an agent AND mirror
   * its coarse `capability` into `capabilities[]` — atomically, in one
   * write. The token is the enforced authority; `capabilities[]` only
   * mirrors it. Dedupes grants by `tokenId` and capabilities by value.
   * Etag-CAS retry on conflict.
   */
  async function applyGrant(identifier, grant = {}) {
    const { tokenId, skill = null, expiresAt = null, subject = null, capability = null, profile = null } = grant;
    if (typeof tokenId !== 'string' || tokenId.length === 0) {
      throw Object.assign(
        new Error('applyGrant: grant.tokenId is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    return withCAS({
      readCurrent: _readCurrent,
      writeNext:   _writeNext,
      maxRetries:  maxRetries ?? 3,
      onPersistentConflict,
      mutate(body /*, etag */) {
        const ts = now();
        const next = {
          v:         RESOURCE_VERSION,
          agents:    body.agents.map(a => {
            if (!_agentMatches(a, identifier)) return a;
            const grants = [
              ...a.grants.filter(g => g.tokenId !== tokenId),
              { tokenId, skill, expiresAt, subject, capability, profile },
            ];
            const capabilities = (typeof capability === 'string' && !a.capabilities.includes(capability))
              ? [...a.capabilities, capability]
              : [...a.capabilities];
            return { ...a, grants, capabilities };
          }),
          updatedAt: ts,
        };
        return next;
      },
    });
  }

  /**
   * Remove a grant (by `tokenId`) from an agent. When no remaining grant
   * still references the mirrored `capability`, un-mirror it from
   * `capabilities[]` too. Idempotent. Etag-CAS retry on conflict.
   */
  async function revokeGrant(identifier, tokenId) {
    return withCAS({
      readCurrent: _readCurrent,
      writeNext:   _writeNext,
      maxRetries:  maxRetries ?? 3,
      onPersistentConflict,
      mutate(body /*, etag */) {
        const ts = now();
        const next = {
          v:         RESOURCE_VERSION,
          agents:    body.agents.map(a => {
            if (!_agentMatches(a, identifier)) return a;
            const removed = a.grants.find(g => g.tokenId === tokenId);
            if (!removed) return a;
            const grants = a.grants.filter(g => g.tokenId !== tokenId);
            const cap = removed.capability;
            const stillReferenced = typeof cap === 'string'
              && grants.some(g => g.capability === cap);
            const capabilities = (typeof cap === 'string' && !stillReferenced)
              ? a.capabilities.filter(c => c !== cap)
              : [...a.capabilities];
            return { ...a, grants, capabilities };
          }),
          updatedAt: ts,
        };
        return next;
      },
    });
  }

  async function list() {
    const { body } = await _readCurrent();
    return body.agents;
  }

  async function reload() {
    return _readCurrent();
  }

  return {
    register,
    lookup,
    revoke,
    purge,
    updateCapabilities,
    updateExposure,
    applyGrant,
    revokeGrant,
    list,
    reload,

    get resourceUri() { return uri; },
  };
}
