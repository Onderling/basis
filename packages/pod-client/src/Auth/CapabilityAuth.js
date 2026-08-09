/**
 * CapabilityAuth — token-based pod auth for apps.
 *
 * Wraps a signed `PodCapabilityToken` (issued by a user's agent) and
 * presents it as a bearer credential to outgoing pod requests.
 *
 * @see Design-v3/pod-client-api.md §CapabilityAuth
 *
 * Usage:
 *   const auth = new CapabilityAuth({ token, mode: 'pod-direct' });
 *   const client = new PodClient({ podRoot, auth });
 *
 * The constructor verifies the token's signature + expiry on
 * construction; an invalid or expired token throws synchronously.
 *
 * `mode: 'pod-direct'` — the holder talks straight to the pod with the token
 * in the `Authorization` header.
 *
 * `mode: 'agent-proxy'` (R3.0) — the holder does NOT talk to the pod at all.
 * It hands every request off to the ISSUING device for proxying: the device
 * holds the pod's real OIDC session (mints DPoP per request on-device) and is
 * the authoritative scope check, so no pod secret ever reaches the holder
 * (the companion host).  This mode exposes `getAuthenticatedFetch()` — a
 * proxying fetch that packages `{ method, url, headers-minus-auth, bodyB64? }`
 * and calls an injected `invoke(deviceAddr, 'pod.proxyRequest', { token, req })`
 * back to the device, reconstructing a real `Response` from the reply.  There
 * is NO header to present in this mode; `getAuthHeaders` throws (the whole
 * point is that the token is never presented over a direct network path from
 * the holder — it travels to the device inside the proxied request instead).
 * On an unreachable/failed invoke it throws a distinct `DeviceUnreachableError`
 * (code `device-unreachable`) so callers can degrade explicitly rather than
 * hang (§R3 decision #3).
 */
import { PodCapabilityToken, b64encode, b64decode } from '@onderling/core';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';

import { Auth }                          from './Auth.js';
import { AuthError, DeviceUnreachableError, PayloadTooLargeError } from '../Errors.js';

const SUPPORTED_MODES = new Set(['pod-direct', 'agent-proxy']);

/**
 * Default `maxBodyBytes` cap for an `agent-proxy` proxied body, in EITHER
 * direction (§R3.3).  16 MiB.
 *
 * GROUNDING (a chosen default with margin below a DISCOVERED hard limit — not
 * itself discovered):  the agent-proxy request/response body travels base64'd
 * inside a JSON envelope over a single `ws` WebSocket message on the relay.
 * The `ws` library caps a message at `maxPayload`, whose default is **100 MiB
 * (104857600 bytes)** on BOTH ends of this hop — the relay `WebSocketServer`
 * (`packages/relay/src/server.js` constructs it with no override) and the
 * `RelayTransport` `ws` client (`packages/transports/src/RelayTransport.js`) —
 * so a frame over 100 MiB is dropped and the socket closed (ws close 1009).
 * That 100 MiB is the real transport ceiling.  A 16 MiB RAW body becomes
 * ~22 MiB of base64 (×4/3) which, wrapped in the JSON envelope and even after
 * SecurityLayer encryption, stays comfortably (~4×) under the 100 MiB frame —
 * headroom for the token, headers, and encoding overhead.  Configurable via the
 * `maxBodyBytes` option; raise it only with the 100 MiB ceiling (and the
 * base64 + envelope inflation) in mind.
 */
// Parameter register (#36) — max request body bytes to proxy (scope:device, kind:internal).
export const DEFAULT_MAX_BODY_BYTES = param({ key: 'podClient.maxBodyBytes', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 16 * 1024 * 1024 });

/** Header names that must NEVER leave the holder toward the device (§R3 #1). */
const STRIPPED_HEADERS = new Set(['authorization', 'dpop']);

/** Drop auth-bearing headers from an outgoing (to-be-proxied) request. */
function sanitizeHeaders(headers) {
  const out = {};
  if (!headers) return out;
  const entries = typeof headers.entries === 'function'
    ? [...headers.entries()]
    : Object.entries(headers);
  for (const [k, v] of entries) {
    if (STRIPPED_HEADERS.has(String(k).toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Normalise a fetch body into RAW bytes (a `Uint8Array`), or null.  We measure
 * the raw length against `maxBodyBytes` BEFORE base64-encoding so the cap is
 * expressed in real payload bytes (base64 inflates ×4/3), and so an oversized
 * request is refused WITHOUT ever allocating/encoding the giant frame.
 */
async function bodyToBytes(body) {
  if (body == null) return null;
  if (typeof body === 'string')        return new TextEncoder().encode(body);
  if (body instanceof Uint8Array)      return body;
  if (body instanceof ArrayBuffer)     return new Uint8Array(body);
  // Blob / other — best-effort via arrayBuffer().
  if (typeof body.arrayBuffer === 'function') {
    return new Uint8Array(await body.arrayBuffer());
  }
  return new TextEncoder().encode(String(body));
}

/**
 * `Auth` for apps holding a signed `PodCapabilityToken` issued by the user's agent. Two modes:
 * `'pod-direct'` presents the serialized token as a Bearer header; `'agent-proxy'` ships every
 * request back to the issuing device via the injected `invoke` callback — auth-bearing headers
 * are stripped and a request body over `maxBodyBytes` is refused before anything is sent.
 * An unknown mode throws an `AuthError` (`AUTH_MODE_NOT_SUPPORTED`).
 */
export class CapabilityAuth extends Auth {
  /** @type {PodCapabilityToken|null} */
  #token = null;
  /** @type {string|null} — serialized JSON form, used for the Bearer header */
  #serialized = null;
  /** @type {string} */
  #mode;
  /** @type {Function|null} — agent-proxy: invoke(deviceAddr, skill, payload) → reply data */
  #invoke = null;
  /** @type {string|null} — agent-proxy: the delegating device's mesh address */
  #deviceAddr = null;
  /** @type {number} — agent-proxy: request-body cap (§R3.3 safety floor). */
  #maxBodyBytes = DEFAULT_MAX_BODY_BYTES;

  /**
   * @param {object} opts
   * @param {string|object|PodCapabilityToken} opts.token
   *   A signed `PodCapabilityToken` — either a `PodCapabilityToken` instance,
   *   a plain JSON object, or a JSON string.
   * @param {'pod-direct'|'agent-proxy'} opts.mode
   *   Auth mode.  `'pod-direct'` presents the token as a Bearer header.
   *   `'agent-proxy'` (R3.0) proxies every request back to the issuing device
   *   via `opts.invoke`; requires `opts.invoke` + `opts.deviceAddr`.  An
   *   unknown mode throws an `AuthError` with code `AUTH_MODE_NOT_SUPPORTED`.
   * @param {(deviceAddr: string, skill: string, payload: object) => Promise<any>} [opts.invoke]
   *   agent-proxy only — the callback that ships a `pod.proxyRequest` to the
   *   device and resolves to the device handler's reply DATA
   *   (`{ status, statusText, headers, bodyB64 }`).  The companion host wires
   *   this to `Parts.data(await agent.invoke(...))`.
   * @param {string} [opts.deviceAddr]
   *   agent-proxy only — the delegating device's mesh address (proxy origin).
   * @param {number} [opts.maxBodyBytes]
   *   agent-proxy only — the max RAW body size (bytes) this holder will ship in
   *   a single proxied REQUEST (§R3.3).  A request body over this cap is refused
   *   on THIS side with a `PayloadTooLargeError` (code `payload-too-large`)
   *   BEFORE any invoke — the giant frame is never sent (the relay would drop
   *   it, ws close 1009).  Defaults to {@link DEFAULT_MAX_BODY_BYTES} (16 MiB).
   *   Should match the device's `registerPodProxy({ maxBodyBytes })` so both
   *   directions share one cap.  A non-positive/invalid value falls back to the
   *   default.
   */
  constructor({ token, mode, invoke, deviceAddr, maxBodyBytes } = {}) {
    super();

    if (!SUPPORTED_MODES.has(mode)) {
      throw new AuthError(
        `CapabilityAuth: mode '${String(mode)}' is not supported in v1; ` +
        `supported modes: ${[...SUPPORTED_MODES].join(', ')}`,
        { code: 'AUTH_MODE_NOT_SUPPORTED' },
      );
    }

    if (token == null) {
      throw new AuthError('CapabilityAuth: token is required', { code: 'INVALID_TOKEN' });
    }

    // Parse → PodCapabilityToken instance.
    let parsed;
    try {
      parsed = token instanceof PodCapabilityToken
        ? token
        : PodCapabilityToken.fromJSON(token);
    } catch (cause) {
      throw new AuthError(
        'CapabilityAuth: failed to parse token JSON',
        { code: 'INVALID_TOKEN', cause },
      );
    }

    if (!(parsed instanceof PodCapabilityToken)) {
      throw new AuthError(
        'CapabilityAuth: parsed token is not a PodCapabilityToken instance',
        { code: 'INVALID_TOKEN' },
      );
    }

    // Expiry check first so we report TOKEN_EXPIRED rather than
    // INVALID_TOKEN for a token that's well-formed but stale (verify()
    // returns false for both cases — disambiguate up front).
    if (typeof parsed.expiresAt === 'number' && Date.now() >= parsed.expiresAt) {
      throw new AuthError(
        'CapabilityAuth: token has expired',
        { code: 'TOKEN_EXPIRED' },
      );
    }

    if (!PodCapabilityToken.verify(parsed)) {
      throw new AuthError(
        'CapabilityAuth: token signature verification failed',
        { code: 'INVALID_TOKEN' },
      );
    }

    this.#token      = parsed;
    this.#serialized = parsed.toString();
    this.#mode       = mode;

    // ── agent-proxy (R3.0): wire the device-proxy transport ──────────────────
    // Only this mode exposes `getAuthenticatedFetch` (as an OWN property), so
    // `PodClient.#buildFetch` uses the proxying fetch for agent-proxy and the
    // header-injection path for pod-direct — pod-direct is byte-identical
    // (no getAuthenticatedFetch present → falls through to getAuthHeaders).
    if (mode === 'agent-proxy') {
      if (typeof invoke !== 'function') {
        throw new AuthError(
          "CapabilityAuth: mode 'agent-proxy' requires an invoke(deviceAddr, skill, payload) callback",
          { code: 'INVALID_ARGUMENT' },
        );
      }
      if (typeof deviceAddr !== 'string' || deviceAddr.length === 0) {
        throw new AuthError(
          "CapabilityAuth: mode 'agent-proxy' requires a non-empty deviceAddr",
          { code: 'INVALID_ARGUMENT' },
        );
      }
      this.#invoke     = invoke;
      this.#deviceAddr = deviceAddr;
      this.#maxBodyBytes = (typeof maxBodyBytes === 'number' && maxBodyBytes > 0)
        ? maxBodyBytes
        : DEFAULT_MAX_BODY_BYTES;
      // Assign as an own property so pod-direct instances never expose it.
      this.getAuthenticatedFetch = () => this.#makeProxyFetch();
    }
  }

  /** Auth mode this instance was constructed with. */
  get mode() { return this.#mode; }

  /**
   * agent-proxy (R3.0) — build the proxying fetch.  Instead of hitting the
   * network it packages the request and ships it to the delegating device via
   * `invoke('pod.proxyRequest')`, then reconstructs a real `Response` from the
   * device's reply.  The device is the pod-secret holder AND the authoritative
   * scope check; this holder never touches the pod or its credentials.
   *
   * @returns {(input: RequestInfo, init?: RequestInit) => Promise<Response>}
   */
  #makeProxyFetch() {
    const invoke       = this.#invoke;
    const deviceAddr   = this.#deviceAddr;
    const maxBodyBytes = this.#maxBodyBytes;
    // Wire form of the signed capability (NOT a pod secret — a scoped grant).
    const wireToken  = this.#token.toJSON();

    return async (input, init = {}) => {
      const url    = typeof input === 'string' ? input : input?.url;
      const method = (init.method || 'GET').toUpperCase();
      const req    = {
        method,
        url,
        headers: sanitizeHeaders(init.headers),   // Authorization/DPoP stripped
      };

      // ── REQUEST-SIDE cap (§R3.3 safety floor) ────────────────────────────────
      // Measure the RAW body BEFORE base64-encoding and BEFORE invoking. An
      // over-cap request is refused HERE, loudly and distinctly, and the giant
      // frame is NEVER shipped — the relay would drop it (ws close 1009) and the
      // device would never see it. NO silent truncation: we fail with an
      // explicit PayloadTooLargeError the caller can branch on by `.code`.
      const bytes = await bodyToBytes(init.body);
      if (bytes != null && bytes.length > maxBodyBytes) {
        throw new PayloadTooLargeError(
          `agent-proxy: request body ${bytes.length} B exceeds maxBodyBytes ${maxBodyBytes} B; ` +
          `refused before proxying (not sent) — the relay frame cannot carry it`,
          { limit: maxBodyBytes, size: bytes.length, uri: url },
        );
      }
      if (bytes != null) req.bodyB64 = b64encode(bytes);

      let reply;
      try {
        reply = await invoke(deviceAddr, 'pod.proxyRequest', { token: wireToken, req });
      } catch (cause) {
        // Any invoke failure (offline device, transport timeout, relay error)
        // becomes an EXPLICIT device-unreachable — never a hang or a generic
        // network error the caller can't distinguish (§R3 decision #3).
        throw new DeviceUnreachableError(
          `agent-proxy: device ${String(deviceAddr).slice(0, 12)}… did not answer pod.proxyRequest`,
          { cause },
        );
      }
      if (!reply || typeof reply !== 'object' || typeof reply.status !== 'number') {
        throw new DeviceUnreachableError(
          'agent-proxy: device returned no/invalid proxy reply',
        );
      }

      // ── RESPONSE-SIDE cap (§R3.3 safety floor) ───────────────────────────────
      // The DEVICE fetched the resource, saw its body exceed maxBodyBytes, and
      // returned a DISTINCT 413-shaped oversize marker carrying NO bytes (never
      // a truncated body). Surface it as the SAME loud, distinct
      // PayloadTooLargeError as the request-side cap — the caller branches on
      // `.code === 'payload-too-large'`. We do NOT reconstruct a Response for
      // this: there are no bytes to hand back, and a silent partial read is the
      // exact footgun the cap exists to prevent.
      if (reply.oversize === true) {
        throw new PayloadTooLargeError(
          `agent-proxy: response body${typeof reply.size === 'number' ? ` ${reply.size} B` : ''} ` +
          `exceeds maxBodyBytes${typeof reply.limit === 'number' ? ` ${reply.limit} B` : ''}; ` +
          `device refused it (no bytes returned) — the relay frame cannot carry it`,
          {
            limit: typeof reply.limit === 'number' ? reply.limit : maxBodyBytes,
            size:  typeof reply.size  === 'number' ? reply.size  : undefined,
            uri:   url,
          },
        );
      }

      // Reconstruct a real Response from the device's reply shape.
      const status  = reply.status;
      const headers = new Headers(reply.headers || {});
      const hasBody = reply.bodyB64 != null && status !== 204 && status !== 205 && status !== 304;
      const body    = hasBody ? b64decode(reply.bodyB64) : null;
      const res     = new Response(body, {
        status,
        statusText: reply.statusText || '',
        headers,
      });
      // Inrupt (getSourceUrl) needs a resolvable Response.url.
      try { Object.defineProperty(res, 'url', { value: url }); } catch { /* ignore */ }
      return res;
    };
  }

  /**
   * Returns headers for outgoing pod requests.  Just `{ Authorization:
   * 'Bearer <serialized-token>' }` in v1 — constraint headers (rate-limit,
   * audit, …) may be added later if/when the convention requires them.
   *
   * Throws `AuthError` (`INVALID_TOKEN`) if the auth has been `close()`d.
   *
   * @param {string} _uri
   * @param {string} _method
   * @returns {Promise<Record<string,string>>}
   */
  // eslint-disable-next-line no-unused-vars
  async getAuthHeaders(_uri, _method) {
    if (this.#mode === 'agent-proxy') {
      // No header to present: the token travels to the device INSIDE the
      // proxied request, never as a Bearer on a direct network path from this
      // holder. Callers must use getAuthenticatedFetch() instead.
      throw new AuthError(
        "CapabilityAuth: mode 'agent-proxy' presents no headers; use getAuthenticatedFetch()",
        { code: 'AUTH_USE_AUTHENTICATED_FETCH' },
      );
    }
    if (!this.#serialized) {
      throw new AuthError(
        'CapabilityAuth: token has been cleared (close() was called)',
        { code: 'INVALID_TOKEN' },
      );
    }
    return { Authorization: `Bearer ${this.#serialized}` };
  }

  /**
   * The token's `subject` — the recipient pubkey this token grants to.
   * Stable for the lifetime of the token; used by `PodClient` for logging
   * and conflict-detection state keying.
   *
   * @returns {string}
   */
  identity() {
    if (!this.#token) {
      throw new AuthError(
        'CapabilityAuth: token has been cleared (close() was called)',
        { code: 'INVALID_TOKEN' },
      );
    }
    return this.#token.subject;
  }

  /**
   * Capability tokens don't refresh — they expire and must be re-issued
   * by the issuing agent.  Throwing here would surprise callers that
   * blindly call `refresh()`, so we resolve to a no-op (parent class
   * default) instead.
   */
  // refresh() inherited from Auth (no-op).

  /**
   * Clear in-memory token references.  Idempotent — safe to call multiple
   * times.  After `close()`, `getAuthHeaders` and `identity` throw.
   */
  async close() {
    this.#token      = null;
    this.#serialized = null;
  }
}
