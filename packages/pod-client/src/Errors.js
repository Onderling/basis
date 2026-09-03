/**
 * @onderling/pod-client — Errors taxonomy.
 *
 * Every error thrown by `PodClient` (and its convention helpers) extends
 * `PodClientError`, which itself extends `Error`.  The taxonomy below is
 * the public contract — see `Design-v3/pod-client-api.md` §Error model.
 *
 * `mapSourceCode(code, { uri, cause })` translates raw `.code` strings
 * thrown by `@onderling/core`'s storage layer (`SolidPodSource`,
 * the pod-storage convention helpers, retired 2026-09-03) into the
 * appropriate typed subclass.  Unknown codes fall back to the base
 * `PodClientError` with the raw code preserved.
 */

/**
 * Base class for every error thrown by `@onderling/pod-client`.
 *
 * @property {string}  code        — short machine-readable code (e.g. `'NOT_FOUND'`)
 * @property {string=} uri         — pod URI the error pertains to (when known)
 * @property {Error=}  cause       — underlying error (chain), if any
 * @property {boolean} retryable   — whether retrying the same op may succeed
 */
export class PodClientError extends Error {
  constructor(message, { code, uri, cause, retryable = false } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    if (uri) this.uri = uri;
    if (cause) this.cause = cause;
    this.retryable = retryable;
  }
}

/** Token invalid, expired, refresh failed. */
export class AuthError extends PodClientError {
  constructor(message, opts = {}) {
    super(message, { code: 'UNAUTHORIZED', ...opts });
  }
}

/** Token authentic but doesn't grant the requested operation. */
export class CapabilityError extends PodClientError {
  constructor(message, opts = {}) {
    super(message, { code: 'FORBIDDEN', ...opts });
  }
}

/** Resource doesn't exist. */
export class NotFoundError extends PodClientError {
  constructor(message, opts = {}) {
    super(message, { code: 'NOT_FOUND', ...opts });
  }
}

/** Write collision (HTTP 409 / 412), or append/patch retry budget exhausted. */
export class ConflictError extends PodClientError {
  constructor(message, opts = {}) {
    super(message, { code: 'CONFLICT', ...opts });
  }
}

/** Pod unreachable, timeout, DNS fail, 5xx, generic HTTP error.  Retryable by default. */
export class NetworkError extends PodClientError {
  constructor(message, opts = {}) {
    super(message, { code: 'NETWORK_ERROR', retryable: true, ...opts });
  }
}

/**
 * agent-proxy (§R3): the delegating DEVICE that proxies pod requests could not
 * be reached (offline / transport timeout / relay error).  Distinct from a
 * generic `NetworkError` so callers can degrade EXPLICITLY — BYO-real-Solid pod
 * data is only as available as the delegating device (§R3 decision #3), and a
 * caller must be able to tell "the device is offline" apart from "the pod is
 * down" or "a hang".  Code is the stable `'device-unreachable'` identity.
 */
export class DeviceUnreachableError extends PodClientError {
  constructor(message, opts = {}) {
    super(message, { code: 'device-unreachable', retryable: true, ...opts });
  }
}

/**
 * agent-proxy (§R3.3): a proxied pod body exceeds the negotiated
 * `maxBodyBytes` cap for the base64-over-WS relay frame, in EITHER direction —
 * an oversized REQUEST body (host→device, a big PUT: rejected on the host
 * BEFORE it is ever shipped) or an oversized RESPONSE body (device→host, a big
 * GET: the device refuses AFTER fetching and returns a distinct 413-shaped
 * reply carrying NO bytes).  Distinct from `NetworkError`/`device-unreachable`
 * so a caller can tell "that file is too big to proxy over the relay frame"
 * apart from "your device is offline" and "denied".  It is a LOUD, explicit
 * refusal — never a silently-truncated read/write (the repo no-silent-cap
 * principle).  Code is the stable `'payload-too-large'` identity; `.limit` and
 * `.size` (when known) say exactly what was refused.  Not retryable: the same
 * oversized payload will always exceed the same cap.
 */
export class PayloadTooLargeError extends PodClientError {
  constructor(message, { limit, size, ...opts } = {}) {
    super(message, { code: 'payload-too-large', retryable: false, ...opts });
    if (typeof limit === 'number') this.limit = limit;
    if (typeof size  === 'number') this.size  = size;
  }
}

/** Server-side policy denied (e.g. quota exceeded, rate-limited). */
export class PolicyError extends PodClientError {
  constructor(message, opts = {}) {
    super(message, { code: 'RATE_LIMITED', ...opts });
  }
}

/** Resource exists but parse failed (bad JSON, RDF parse error, etc.). */
export class MalformedResourceError extends PodClientError {
  constructor(message, opts = {}) {
    super(message, { code: 'MALFORMED_RESOURCE', ...opts });
  }
}

/** Encryption / decryption failed in the convention helpers. */
export class EncryptionError extends PodClientError {
  constructor(message, opts = {}) {
    super(message, { code: 'ENCRYPTION_FAILED', ...opts });
  }
}

/**
 * Reference-manifest parse failed, hash mismatch, external store unreachable,
 * external store not configured, etc.  Mirrors A3's convention codes.
 */
export class ConventionError extends PodClientError {
  constructor(message, opts = {}) {
    super(message, { code: 'CONVENTION_ERROR', ...opts });
  }
}

/**
 * The target pod does not support a sharing primitive the caller asked for.
 * Typically thrown by `client.sharing.{grant,revoke,list}` when neither
 * ACP nor WAC is available on the target resource.
 */
export class SharingUnsupportedError extends PodClientError {
  constructor(message, opts = {}) {
    super(message, { code: 'SHARING_NOT_SUPPORTED', ...opts });
  }
}

/* -------------------------------------------------------------------------- */

/**
 * Map a raw `.code` string (as thrown by `@onderling/core`'s storage layer)
 * to the appropriate `PodClientError` subclass.
 *
 * Returns a fully-constructed error instance — callers can `throw` it
 * directly.
 *
 * Unknown codes fall through to a base `PodClientError`, preserving the
 * raw code so callers retain forensic info.
 *
 * @param {string} code
 * @param {{ uri?: string, cause?: Error, message?: string }} [opts]
 * @returns {PodClientError}
 */
export function mapSourceCode(code, { uri, cause, message } = {}) {
  const msg = message || `pod operation failed: ${code}`;
  switch (code) {
    case 'NOT_FOUND':
      return new NotFoundError(msg, { uri, cause });
    case 'UNAUTHORIZED':
      return new AuthError(msg, { uri, cause });
    case 'FORBIDDEN':
      return new CapabilityError(msg, { uri, cause });
    case 'CONFLICT':
      // covers HTTP 409 + 412
      return new ConflictError(msg, { uri, cause });
    case 'RATE_LIMITED':
      return new PolicyError(msg, { uri, cause });
    case 'SERVER_ERROR':
    case 'HTTP_ERROR':
    case 'NETWORK_ERROR':
      return new NetworkError(msg, { uri, cause });
    case 'INVALID_ARGUMENT':
      return new PodClientError(msg, { code, uri, cause, retryable: false });
    // A3 convention codes
    case 'HASH_MISMATCH':
    case 'INVALID_MANIFEST':
    case 'EXTERNAL_STORE_NOT_CONFIGURED':
    case 'EXTERNAL_STORE_BAD_RESPONSE':
      return new ConventionError(msg, { code, uri, cause });
    default:
      // Preserve raw code on unrecognized inputs.
      return new PodClientError(msg, { code, uri, cause, retryable: false });
  }
}
