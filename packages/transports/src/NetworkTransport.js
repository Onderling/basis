/**
 * NetworkTransport — inject-a-channel A2A transport across a network boundary.
 *
 * The #63 remote-handler tier (`@onderling/secure-agent/remoteHandlers`) proved
 * `agent.invoke(remoteAddress, skillId, parts)` routing to a truly-remote
 * agent's gated `callSkill` — but only over the in-process `InternalTransport`
 * (same-process A2A). This is the network tail: the SAME `agent.invoke` carried
 * over a genuine network channel to a remote agent, and the skill result
 * returned — WITHOUT weakening the capability gate.
 *
 * ── How it plugs into the port ─────────────────────────────────────────────
 * It is a plain `Transport` subclass (the same port `InternalTransport` /
 * `RelayTransport` / `NknTransport` satisfy). It overrides only the one
 * required primitive, `_put(to, envelope)`, and drives inbound envelopes into
 * the inherited `_receive()`. Everything else — request/response correlation
 * (`_id`/`_re`), auto-ACK, SecurityLayer encrypt/decrypt, the `task` /
 * `task-result` wire payload shape — is the UNCHANGED kernel machinery
 * (`packages/core/src/protocol/taskExchange.js`, `Transport.js`). We invent no
 * parallel envelope: `agent.invoke` builds the exact same RQ `{ type:'task',
 * … }` it builds for every other transport; we just carry the bytes.
 *
 * ── The injected channel (hermetic; real sockets DEFERRED) ──────────────────
 * Following the established substrate convention (`@onderling/blob-gateway`,
 * `@onderling/confidential-llm`, `@onderling/data-connectors` — injected adapter,
 * mock-tested, real drivers deferred), the wire itself is INJECTED:
 *
 *   createNetworkTransport({ identity, send })
 *
 * `send(frameString)` is the ONLY thing that touches "the wire": it hands a
 * JSON string to some channel (a WebSocket, an HTTP POST, a relay). Inbound
 * frames are fed back with `transport.receiveFrame(frameString)`. A real
 * HTTP/WebSocket driver + DPoP-bound auth + a listening server are DEFERRED —
 * this module is proven end-to-end over a mock in-memory loopback channel and
 * never opens a real socket.
 *
 * Two shapes of channel are supported over the same code:
 *   1. Bidirectional / push (WebSocket-like): each side has a NetworkTransport;
 *      `send` delivers a frame to the peer, the peer feeds it to `receiveFrame`.
 *      Requests, responses and one-way task OWs all flow uniformly.
 *   2. Request/response (fetch/HTTP-like): the server decodes an inbound RQ
 *      frame with `handleNetworkRequest(transport, frame)` and gets back the
 *      correlated response frame to return as the HTTP body — no push channel
 *      needed for the common request→result case.
 *
 * ── The gate is NOT touched ─────────────────────────────────────────────────
 * The capability token rides INSIDE the RQ payload, which SecurityLayer
 * encrypts wholesale into `payload._box` before it ever reaches `send`. On the
 * receiver the frame is decoded, decrypted, and driven through `_receive` →
 * the agent's normal dispatch → `handleTaskRequest` → `runGatedSkill` →
 * `PolicyEngine.checkInbound`. The gate is the only consumer of the token and
 * always runs. Serialization carries opaque ciphertext; it cannot smuggle a
 * token past the gate, and an ungranted / wrong-scope / revoked capability is
 * denied across the network exactly as in-process.
 */
import { Transport } from '@onderling/core';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';

/** Wire-frame version + kind — lets a real multiplexed channel demux. */
const FRAME_V    = 1;
const FRAME_KIND = 'a2a';

/**
 * Encode an outbound frame to a JSON string (the wire representation).
 *
 * Deep JSON round-trip guarantees the frame is wire-safe and strips any live
 * object references (e.g. a stray `_transport` back-ref that `_receive` tags on
 * a decrypted envelope) so nothing non-serializable — or circular — leaks onto
 * the channel.
 *
 * @param {{ to: string, from: string, envelope: object }} p
 * @returns {string}
 */
export function encodeFrame({ to, from, envelope }) {
  const { _transport, ...clean } = envelope ?? {};   // never serialize the live back-ref
  return JSON.stringify({ v: FRAME_V, kind: FRAME_KIND, to, from, envelope: clean });
}

/**
 * Decode an inbound frame (string or already-parsed object) back to its parts.
 *
 * @param {string|object} frame
 * @returns {{ to: string, from: string, envelope: object }}
 */
export function decodeFrame(frame) {
  const obj = typeof frame === 'string' ? JSON.parse(frame) : frame;
  if (!obj || obj.kind !== FRAME_KIND || !obj.envelope) {
    throw Object.assign(new Error('NetworkTransport: malformed frame'), { code: 'BAD_FRAME' });
  }
  return { to: obj.to, from: obj.from, envelope: obj.envelope };
}

// Parameter register (#36) — server-side serve timeout (scope:device, kind:internal).
const DEFAULT_SERVE_TIMEOUT = param({ key: 'transports.serveTimeoutMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30_000 });  // ms — fetch/HTTP server-side wait for the RS

/**
 * Channel-agnostic A2A `Transport` over an injected `send(frame)` function — WebSocket, TCP,
 * HTTP, anything that can carry a JSON string. Overrides only `_put`, encoding envelopes with
 * `encodeFrame`; inbound frames are driven into the inherited `_receive` via `receiveFrame`. In
 * fetch/HTTP mode, a response envelope whose `_re` matches a request currently served by
 * `handleNetworkRequest` resolves that capture instead of being pushed outbound. Envelopes arrive
 * SecurityLayer-encrypted, so the receiving agent's capability gate is unchanged.
 */
export class NetworkTransport extends Transport {
  /** @type {(frame: string) => void|Promise<void>} */
  #send;
  /** Fetch/HTTP-mode captures: request envelope `_id` → { resolve }. */
  #captures = new Map();

  /**
   * @param {object} opts
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} [opts.identity]
   * @param {string} [opts.address]  — wire address; defaults to `identity.pubKey`
   * @param {(frame: string) => void|Promise<void>} opts.send  — injected outbound channel
   */
  constructor(opts = {}) {
    const address = opts.address ?? opts.identity?.pubKey;
    if (!address)                       throw new Error('NetworkTransport requires identity or address');
    if (typeof opts.send !== 'function') throw new Error('NetworkTransport requires a send(frame) channel');
    super({ address, identity: opts.identity });
    this.#send = opts.send;
  }

  /**
   * Put one (already SecurityLayer-encrypted) envelope on the wire toward `to`.
   *
   * Fetch/HTTP mode: if this envelope is the RS to a request currently being
   * served by `handleNetworkRequest` (its `_re` matches a captured request
   * `_id`), resolve that capture with the response frame instead of pushing a
   * fresh outbound — so an HTTP handler can return the RS as its body without a
   * back-channel. Otherwise hand the frame to the injected channel.
   *
   * @param {string} to
   * @param {object} envelope
   */
  async _put(to, envelope) {
    const frame = encodeFrame({ to, from: this.address, envelope });

    if (envelope?._re != null && this.#captures.has(envelope._re)) {
      const cap = this.#captures.get(envelope._re);
      this.#captures.delete(envelope._re);
      cap.resolve(frame);
      return;
    }

    await this.#send(frame);
  }

  /**
   * Inbound: feed a frame pulled off the channel into the transport. Decodes,
   * then hands the envelope to the inherited `_receive()` — which runs
   * SecurityLayer decrypt/verify, reply-correlation, auto-ACK and dispatch to
   * the agent exactly as for any transport.
   *
   * @param {string|object} frame
   */
  receiveFrame(frame) {
    const { envelope } = decodeFrame(frame);
    this._receive(envelope);
  }

  /**
   * Serve one request/response (fetch/HTTP) exchange: feed an inbound RQ frame
   * into this transport and resolve with the correlated response frame the
   * agent produces (the RS the skill/gate emits via `respond`). Used by the
   * module-level `handleNetworkRequest` helper.
   *
   * @param {string|object} frame
   * @param {object} [opts]
   * @param {number} [opts.timeout=30000]
   * @returns {Promise<string>} the response frame (JSON string)
   */
  _serveRequest(frame, { timeout = DEFAULT_SERVE_TIMEOUT } = {}) {
    const { envelope } = decodeFrame(frame);
    const id = envelope?._id;
    if (id == null) {
      return Promise.reject(
        Object.assign(new Error('handleNetworkRequest: frame carries no request id'), { code: 'BAD_FRAME' }),
      );
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#captures.delete(id);
        reject(Object.assign(
          new Error(`handleNetworkRequest: no response for ${id} within ${timeout}ms`),
          { code: 'TIMEOUT' },
        ));
      }, timeout);
      this.#captures.set(id, {
        resolve: (respFrame) => { clearTimeout(timer); resolve(respFrame); },
      });
      // Drives _receive → agent dispatch → handleTaskRequest → runGatedSkill →
      // respond → _put, whose _re === id resolves the capture above.
      this._receive(envelope);
    });
  }
}

/**
 * Factory mirroring the other concrete transports (`create*` convention).
 * @param {ConstructorParameters<typeof NetworkTransport>[0]} opts
 * @returns {NetworkTransport}
 */
export function createNetworkTransport(opts) {
  return new NetworkTransport(opts);
}

/**
 * Server-side helper for the request/response (fetch/HTTP) channel shape.
 *
 * Decodes an inbound RQ frame, drives it through the local agent (wired as the
 * transport's owner) — gate included — and resolves with the correlated
 * response frame to hand back as the HTTP response body. The transport passed
 * MUST be the receiving agent's transport (so its `receiveHandler` routes into
 * the agent's dispatch loop).
 *
 * @param {NetworkTransport} transport
 * @param {string|object} frame
 * @param {object} [opts]
 * @param {number} [opts.timeout]
 * @returns {Promise<string>} response frame (JSON string)
 */
export function handleNetworkRequest(transport, frame, opts) {
  if (!(transport instanceof NetworkTransport)) {
    throw new Error('handleNetworkRequest: first arg must be a NetworkTransport');
  }
  return transport._serveRequest(frame, opts);
}
