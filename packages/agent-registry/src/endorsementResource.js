/**
 * Endorsement list resource — a curator's published endorsements
 * (commons-governance G1).
 *
 * ── Why a focused NEW resource, not a literal fork of AgentRegistry ────────
 * It mirrors the agent-registry resource IDIOM — a signed-list pod resource
 * with etag-CAS append/revoke — and REUSES the exact CAS machinery
 * (`withCAS` from concurrency.js) and the normalise-on-read shape. But it is a
 * sibling, not a reuse of `createAgentRegistry`, for two reasons the registry
 * can't absorb cleanly:
 *   1. Different schema + key. The registry is agentId-keyed with a fixed
 *      agent-entry schema; this list is id-keyed over free-standing signed
 *      endorsement CLAIMS. Parameterising createAgentRegistry to carry a
 *      second schema would bloat it.
 *   2. Different ACP posture. The registry lives at `/private/` and its
 *      authority IS that location (yours by construction). An endorsement is
 *      read cross-pod by strangers, so it lives at a SHARED-READABLE path and
 *      its authority is the SIGNATURE, not the location — a hostile host can
 *      withhold (availability) but not forge (integrity). See the
 *      `real-pod: public-read ACP` marker below.
 * Pod I/O is NOT reimplemented — the caller injects the pseudo-pod, exactly as
 * createAgentRegistry does.
 */

import { withCAS } from './concurrency.js';

/** Wire-format version stamped on endorsement-list resources (and defaulted in on read). */
export const ENDORSEMENT_RESOURCE_VERSION = 1;

/**
 * Shared-readable endorsement-list path for an endorser's pod / device.
 *
 * Lives under `/public/` (contrast the registry's `/private/`) because the
 * catalogue read-path reads it cross-pod. The pseudo-pod path is the default,
 * same as the registry.
 *
 * // real-pod: public-read ACP — on a real Solid pod this resource carries a
 * // public-READ / owner-WRITE access posture so any client can resolve+verify
 * // it while only the endorser can publish. That posture is now SET, not just
 * // marked: an injected best-effort `ensureAccess(uri)` hook (wired by the app
 * // to `@onderling/pod-client`'s `setResourceAccess` → public-read + owner-write)
 * // fires once after the first write to a real (https) pod URI, and is exposed
 * // as `ensureAccess()` for explicit/idempotent re-application. On the
 * // pseudo-pod (hermetic) the hook never fires — this stays a pure no-op and
 * // the read+verify path is unchanged. Proven live vs a WAC pod in
 * // `@onderling/pod-client`'s `setResourceAccess.css.test.js`; ACP-on-CSS is the
 * // pre-existing Inrupt-SDK interop gap (surfaced, not silently swallowed).
 */
export function endorsementResourceUri({ anchorPodUri, deviceId, preferPodUri = false } = {}) {
  if (preferPodUri && typeof anchorPodUri === 'string' && anchorPodUri.length > 0) {
    const base = anchorPodUri.endsWith('/') ? anchorPodUri.slice(0, -1) : anchorPodUri;
    return `${base}/public/endorsements`;
  }
  if (typeof deviceId === 'string' && deviceId.length > 0) {
    return `pseudo-pod://${deviceId}/public/endorsements`;
  }
  if (typeof anchorPodUri === 'string' && anchorPodUri.length > 0) {
    const base = anchorPodUri.endsWith('/') ? anchorPodUri.slice(0, -1) : anchorPodUri;
    return `${base}/public/endorsements`;
  }
  throw Object.assign(
    new Error('endorsementResourceUri: deviceId (preferred) or anchorPodUri is required'),
    { code: 'INVALID_ARGUMENT' },
  );
}

/** A frozen, empty endorsement-list body: current version, no endorsements, `updatedAt` = now. */
export function emptyEndorsementResource() {
  return Object.freeze({
    v:            ENDORSEMENT_RESOURCE_VERSION,
    endorsements: Object.freeze([]),
    updatedAt:    new Date().toISOString(),
  });
}

/**
 * Normalise a read resource. Light-touch: authority is the signature (verified
 * downstream by verifyEndorsement), so this only guards the LIST shape and
 * drops entries with no usable `id` — it does NOT re-sign or trust the fields.
 */
export function normaliseEndorsementResource(raw) {
  if (!raw || typeof raw !== 'object') return emptyEndorsementResource();
  const list = Array.isArray(raw.endorsements) ? raw.endorsements : [];
  return Object.freeze({
    v:            typeof raw.v === 'number' ? raw.v : ENDORSEMENT_RESOURCE_VERSION,
    endorsements: Object.freeze(list.filter((e) => e && typeof e === 'object' && typeof e.id === 'string' && e.id.length > 0)
                                    .map((e) => Object.freeze({ ...e }))),
    updatedAt:    typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  });
}

/**
 * createEndorsementResource — append/revoke/list over a shared-readable
 * endorsement list, with etag-CAS (reused from concurrency.js).
 *
 * @param {object} opts
 * @param {object}  opts.pseudoPod           — injected pod I/O (read/write)
 * @param {string}  [opts.anchorPodUri]
 * @param {string}  [opts.deviceId]          — strongly recommended; default store path
 * @param {boolean} [opts.preferPodUri]
 * @param {string}  [opts.resourceUri]       — explicit override (wins)
 * @param {number}  [opts.maxRetries=3]
 * @param {(err: Error) => void} [opts.onPersistentConflict]
 * @param {() => string} [opts.now]
 * @param {(uri: string) => (any|Promise<any>)} [opts.ensureAccess]
 *   — best-effort real-pod access-control hook. Wired by the app to
 *   `@onderling/pod-client`'s `setResourceAccess` (public-read + owner-write for
 *   G1; + admin-write for a G3 community catalogue). Fires once, best-effort,
 *   after the first successful write to a real (https) pod URI; NEVER on a
 *   `pseudo-pod://` URI (hermetic no-op). A throwing hook must NOT break the
 *   write. Also exposed as `ensureAccess()` for explicit/idempotent use.
 * @returns {{ append, revoke, list, get, ensureAccess, resourceUri: string }}
 */
export function createEndorsementResource({
  pseudoPod,
  anchorPodUri,
  deviceId,
  preferPodUri = false,
  resourceUri,
  maxRetries,
  onPersistentConflict,
  ensureAccess: ensureAccessHook,
  now = () => new Date().toISOString(),
} = {}) {
  if (!pseudoPod || typeof pseudoPod.read !== 'function') {
    throw Object.assign(new Error('createEndorsementResource: pseudoPod is required'), { code: 'INVALID_ARGUMENT' });
  }
  const uri = resourceUri ?? endorsementResourceUri({ anchorPodUri, deviceId, preferPodUri });
  // Only real (https) pod URIs carry Solid access control; pseudo-pod:// is the
  // hermetic store and the hook is a pure no-op there.
  const isRealPod = /^https?:\/\//i.test(uri);
  let _accessEnsured = false;

  /**
   * Apply the resource's real-pod access posture, best-effort + idempotent.
   * A no-op on the pseudo-pod or when no hook is injected. Never throws — a
   * failing/incompatible ACL set must not corrupt or block the resource.
   */
  async function ensureAccess() {
    if (!isRealPod || typeof ensureAccessHook !== 'function') return { skipped: true };
    try {
      const r = await ensureAccessHook(uri);
      _accessEnsured = true;
      return r ?? { ok: true };
    } catch (err) {
      // Surface via return (caller may inspect); never throw out of the write path.
      return { error: err?.message ?? String(err), code: err?.code };
    }
  }

  /** Fire ensureAccess once, best-effort, after the first real-pod write. */
  async function _maybeEnsureAccessOnce() {
    if (_accessEnsured || !isRealPod || typeof ensureAccessHook !== 'function') return;
    _accessEnsured = true;               // set before await → fire-once even if concurrent
    try { await ensureAccessHook(uri); } catch { /* best-effort; write already landed */ }
  }

  async function _readCurrent() {
    const rec = await pseudoPod.read(uri);
    if (!rec) return { body: emptyEndorsementResource(), etag: null };
    return { body: normaliseEndorsementResource(rec.bytes), etag: rec.etag ?? null };
  }

  async function _writeNext(body, etag) {
    try {
      const result = await pseudoPod.write(uri, body, etag);
      // Best-effort real-pod access posture, once, after the resource exists.
      await _maybeEnsureAccessOnce();
      return { etag: result?.etag };
    } catch (err) {
      if (err?.code === 'CONFLICT' || err?.code === 'PRECONDITION_FAILED') {
        throw Object.assign(new Error('endorsement-resource: write conflict'), { code: 'CONFLICT', cause: err });
      }
      throw err;
    }
  }

  /** Append (or replace, by `id`) a signed endorsement. Etag-CAS retry. */
  async function append(rec = {}) {
    if (!rec || typeof rec.id !== 'string' || rec.id.length === 0) {
      throw Object.assign(new Error('append: endorsement.id is required'), { code: 'INVALID_ARGUMENT' });
    }
    return withCAS({
      readCurrent: _readCurrent,
      writeNext:   _writeNext,
      maxRetries:  maxRetries ?? 3,
      onPersistentConflict,
      mutate(body) {
        const without = body.endorsements.filter((e) => e.id !== rec.id);
        return {
          v:            ENDORSEMENT_RESOURCE_VERSION,
          endorsements: [...without, { ...rec }],
          updatedAt:    now(),
        };
      },
    });
  }

  /** Remove an endorsement by `id` (the moderation revoke path). Etag-CAS. */
  async function revoke(id) {
    return withCAS({
      readCurrent: _readCurrent,
      writeNext:   _writeNext,
      maxRetries:  maxRetries ?? 3,
      onPersistentConflict,
      mutate(body) {
        return {
          v:            ENDORSEMENT_RESOURCE_VERSION,
          endorsements: body.endorsements.filter((e) => e.id !== id),
          updatedAt:    now(),
        };
      },
    });
  }

  async function list() {
    const { body } = await _readCurrent();
    return body.endorsements;
  }

  async function get(id) {
    if (typeof id !== 'string' || id.length === 0) return null;
    const { body } = await _readCurrent();
    return body.endorsements.find((e) => e.id === id) ?? null;
  }

  return {
    append,
    revoke,
    list,
    get,
    ensureAccess,
    get resourceUri() { return uri; },
  };
}
