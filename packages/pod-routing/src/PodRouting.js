/**
 * createPodRouting — the substrate factory.
 *
 * Combines:
 *   - the default policy (built from anchorPodUri + deviceId);
 *   - the user's mappings + circle policies loaded from the config
 *     resource (or empty when no config exists yet);
 *   - the reachability cache;
 *   - the resolver pipeline (exact match → glob → default).
 *
 * Construction is synchronous + cheap. Call `await podRouting.reload()`
 * to pull persisted config from the pseudo-pod. Resolution falls
 * back to defaults when nothing is loaded yet.
 *
 * Standardisation Phase 52.3.
 */

import {
  CANONICAL_STORAGE_FUNCTIONS,
  matchMapping,
  substituteVars,
  joinUriTail,
} from './storageFunctions.js';
import { buildDefaultPolicy } from './defaultPolicy.js';
import { createReachabilityCache } from './reachability.js';
import { configResourceUri, readConfig, writeConfig, CONFIG_VERSION } from './configResource.js';

/**
 * @param {object} opts
 * @param {object} opts.pseudoPod                — required (used for config I/O)
 * @param {string} opts.deviceId                 — required
 * @param {string|null} [opts.anchorPodUri=null] — `null` for no-pod users
 * @param {number} [opts.reachabilityTTLms=30000]
 * @param {() => number} [opts.now]              — injectable clock (ms)
 */
export function createPodRouting({
  pseudoPod,
  deviceId,
  anchorPodUri = null,
  reachabilityTTLms = 30_000,
  now,
} = {}) {
  if (!pseudoPod || typeof pseudoPod.read !== 'function') {
    throw Object.assign(
      new Error('createPodRouting: `pseudoPod` is required (must expose read/write)'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    throw Object.assign(
      new Error('createPodRouting: `deviceId` is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  let defaults = buildDefaultPolicy({ anchorPodUri, deviceId });
  const reach  = createReachabilityCache({ ttlMs: reachabilityTTLms, now });
  let configUri = configResourceUri({ deviceId, anchorPodUri });

  /** @type {import('./configResource.js').StorageMappingConfig | null} */
  let loadedConfig = null;
  /** @type {Set<string>} */
  const extraStorageFns = new Set();

  function _vars(callerVars = {}) {
    return {
      deviceId,
      ...(anchorPodUri ? { 'anchor-pod': anchorPodUri, anchorPod: anchorPodUri } : {}),
      ...callerVars,
    };
  }

  function _effectiveMappings() {
    // User config overlays defaults.
    return { ...defaults.mappings, ...(loadedConfig?.mappings ?? {}) };
  }

  /**
   * Resolve a storage-function path to a concrete URI.
   *
   * For `group/<circleId>/...` paths we run the circle-policy lookup
   * first, since the policy decides whether the group lives on a
   * pod or in the pseudo-pod replication-ring.
   */
  function resolve(storageFn, callerVars = {}) {
    if (typeof storageFn !== 'string' || storageFn.length === 0) return null;
    const vars = _vars(callerVars);
    const mappings = _effectiveMappings();

    // Circle-aware group routing.
    if (storageFn.startsWith('group/')) {
      const rest = storageFn.slice('group/'.length);
      const slash = rest.indexOf('/');
      const circleId = slash === -1 ? rest : rest.slice(0, slash);
      const tail   = slash === -1 ? '' : rest.slice(slash + 1);
      if (circleId.length > 0) {
        // Explicit override mapping wins.
        const explicit = matchMapping(storageFn, mappings);
        if (explicit && explicit.pattern !== 'group/*') {
          return joinUriTail(substituteVars(explicit.uri, vars), substituteVars(explicit.tail, vars));
        }
        const policy = circlePolicy(circleId);
        if (policy.policy === 'shared' && policy.groupPodUri) {
          const base = _stripTrailingSlash(policy.groupPodUri) + `/${circleId}/`;
          return joinUriTail(base, tail);
        }
        if (policy.policy === 'personal') {
          // Each member keeps the circle's data on THEIR OWN pod;
          // cross-member reads ride cross-pod `embeds` refs (the
          // read/index path — Phase 3.3, `conventions/
          // cross-pod-refs.md`). No shared group pod → route to the
          // user's anchor pod, circle-scoped (same shape as
          // centralised, own pod instead of the group pod). A no-pod
          // user (no anchor) falls back to the replication ring.
          if (anchorPodUri) {
            const base = _stripTrailingSlash(anchorPodUri) + `/${circleId}/`;
            return joinUriTail(base, tail);
          }
          return `pseudo-pod://${deviceId}/group/${circleId}/${tail}`;
        }
        if (policy.policy === 'hybrid') {
          // Canonical ledger (the circle's `group/*` data) lives on the
          // shared group pod — identical to `centralised` for the
          // data Stoop emits today. Members' personal drafts are the
          // `personal-in-group/*` storage-function (resolved by the
          // generic mapping → own pod) and stay off this path; that
          // ledger-vs-draft split is all V1 models. No groupPodUri →
          // replication ring.
          if (policy.groupPodUri) {
            const base = _stripTrailingSlash(policy.groupPodUri) + `/${circleId}/`;
            return joinUriTail(base, tail);
          }
          return `pseudo-pod://${deviceId}/group/${circleId}/${tail}`;
        }
        if (policy.policy === 'none') {
          // Replication-ring (eager P2P fan-out; the groupMirror
          // substitute). No pod involved by design.
          return `pseudo-pod://${deviceId}/group/${circleId}/${tail}`;
        }
        // Unknown policy → fall through to generic mapping.
      }
    }

    const m = matchMapping(storageFn, mappings);
    if (!m) return null;
    const baseUri = substituteVars(m.uri, vars);
    return joinUriTail(baseUri, substituteVars(m.tail, vars));
  }

  function circlePolicy(circleId) {
    if (typeof circleId !== 'string' || circleId.length === 0) return defaults.circlePolicyDefault;
    const fromConfig = loadedConfig?.circlePolicies?.[circleId];
    if (fromConfig) return fromConfig;
    return defaults.circlePolicyDefault;
  }

  function isPodReachable(uri) {
    const target = _normalizePodKey(uri ?? anchorPodUri);
    if (!target) return false;
    return reach.isReachable(target);
  }

  function markPodReachable(uri)   { reach.markReachable(_normalizePodKey(uri ?? anchorPodUri)); }
  function markPodUnreachable(uri) { reach.markUnreachable(_normalizePodKey(uri ?? anchorPodUri)); }

  async function reload() {
    try {
      loadedConfig = await readConfig({ pseudoPod, uri: configUri });
    } catch (err) {
      if (err?.code === 'INVALID_CONFIG') throw err;
      // Read errors (e.g. missing) leave the loaded config null;
      // defaults remain in effect.
      loadedConfig = null;
    }
    return loadedConfig;
  }

  async function updateMapping({ fn, uri }) {
    if (typeof fn !== 'string' || fn.length === 0) {
      throw Object.assign(
        new Error('updateMapping: `fn` is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (typeof uri !== 'string' || uri.length === 0) {
      throw Object.assign(
        new Error('updateMapping: `uri` is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    const current = loadedConfig ?? {
      version: CONFIG_VERSION,
      mappings: {},
      circlePolicies: {},
    };
    const next = {
      ...current,
      mappings: { ...(current.mappings ?? {}), [fn]: uri },
    };
    await writeConfig({ pseudoPod, uri: configUri, config: next });
    await reload();
  }

  async function setCirclePolicy(circleId, policy) {
    if (typeof circleId !== 'string' || circleId.length === 0) {
      throw Object.assign(
        new Error('setCirclePolicy: `circleId` is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    const current = loadedConfig ?? {
      version: CONFIG_VERSION,
      mappings: {},
      circlePolicies: {},
    };
    const next = {
      ...current,
      circlePolicies: { ...(current.circlePolicies ?? {}), [circleId]: policy },
    };
    await writeConfig({ pseudoPod, uri: configUri, config: next });
    await reload();
  }

  /**
   * Re-point routing at a (newly known) anchor pod.
   *
   * `createPodRouting` takes `anchorPodUri` at construction; an app
   * that boots no-pod and later attaches a pod (Stoop's opt-in pod
   * sign-in) needs to switch the default policy + config-resource
   * location without rebuilding the whole stack (pod-routing is also
   * wired into notify-envelope).  Rebuilds `defaults` + `configUri`
   * and drops the loaded config (it was keyed to the OLD anchor's
   * resource); the caller `reload()`s from the new location.
   * Pass `null` to revert to no-pod.  Returns the new config URI.
   *
   * @param {string|null} newAnchorPodUri
   * @returns {string} the new config-resource URI
   */
  function setAnchor(newAnchorPodUri) {
    if (newAnchorPodUri != null && typeof newAnchorPodUri !== 'string') {
      throw Object.assign(
        new Error('setAnchor: anchorPodUri must be a string or null'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    anchorPodUri = (typeof newAnchorPodUri === 'string' && newAnchorPodUri.length > 0)
      ? newAnchorPodUri
      : null;
    defaults  = buildDefaultPolicy({ anchorPodUri, deviceId });
    configUri = configResourceUri({ deviceId, anchorPodUri });
    loadedConfig = null;
    return configUri;
  }

  function registerStorageFunction(name) {
    if (typeof name === 'string' && name.length > 0) extraStorageFns.add(name);
  }

  function listStorageFunctions() {
    return [...new Set([...CANONICAL_STORAGE_FUNCTIONS, ...extraStorageFns])].sort();
  }

  return {
    // Resolution
    resolve,
    circlePolicy,
    listStorageFunctions,
    registerStorageFunction,

    // Reachability
    isPodReachable,
    markPodReachable,
    markPodUnreachable,

    // Config I/O
    reload,
    updateMapping,
    setCirclePolicy,
    setAnchor,

    // Introspection
    get configResourceUri() { return configUri; },
    get anchorPodUri() { return anchorPodUri; },
    get deviceId() { return deviceId; },
    get config() { return loadedConfig; },
    get defaults() { return defaults; },
  };
}

function _stripTrailingSlash(s) {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

/**
 * Normalize a URI to its pod-key for reachability tracking. https://
 * URIs collapse to `protocol//host` (so cache hits on the anchor pod
 * URI cover all resources under it). pseudo-pod:// URIs pass through
 * untouched. Returns `null` for unusable input.
 */
function _normalizePodKey(uri) {
  if (typeof uri !== 'string' || uri.length === 0) return null;
  if (uri.startsWith('pseudo-pod://')) return uri;
  try {
    const u = new URL(uri);
    return `${u.protocol}//${u.host}`;
  } catch {
    return uri;
  }
}
