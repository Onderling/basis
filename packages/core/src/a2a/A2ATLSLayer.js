/**
 * A2ATLSLayer — security-layer adapter for A2ATransport.
 *
 * A2A uses HTTPS + Bearer JWT for auth, not nacl.box. This class satisfies
 * the SecurityLayer interface expected by Transport (encrypt / decryptAndVerify)
 * with pass-throughs, while also providing HTTP-level auth helpers used
 * directly by A2ATransport.
 */

export class A2ATLSLayer {
  #a2aAuth;

  /**
   * @param {object} opts
   * @param {import('./A2AAuth.js').A2AAuth} [opts.a2aAuth]
   */
  constructor({ a2aAuth = null } = {}) {
    this.#a2aAuth = a2aAuth;
  }

  // ── SecurityLayer interface (pass-throughs) ──────────────────────────────────

  /** A2A envelopes are not nacl-encrypted — return as-is. */
  encrypt(envelope) { return envelope; }

  /** A2A envelopes are not nacl-encrypted — return as-is. */
  decryptAndVerify(rawEnvelope) { return rawEnvelope; }

  /** Stub matching SecurityLayer.registerPeer (no-op for A2A). */
  registerPeer() {}

  /** Stub matching SecurityLayer.learnPeerKey — nothing to learn, no key map here. */
  learnPeerKey() { return 'unchanged'; }

  // ── HTTP-level auth helpers (called by A2ATransport directly) ────────────────

  /**
   * Add Authorization header to outbound fetch init.
   *
   * @param {string} peerUrl
   * @param {RequestInit} requestInit
   * @returns {Promise<RequestInit>}
   */
  async wrapOutbound(peerUrl, requestInit) {
    if (!this.#a2aAuth) return requestInit;
    const authHeaders = await this.#a2aAuth.buildHeaders(peerUrl);
    return {
      ...requestInit,
      headers: { ...requestInit.headers, ...authHeaders },
    };
  }

  /**
   * Validate inbound Bearer token.
   *
   * @param {object} req  — Node.js IncomingMessage or compatible headers object
   * @returns {Promise<{ tier: number, claims: object|null, peerId: string|null }>}
   */
  async validateInbound(req) {
    if (!this.#a2aAuth) return { tier: 0, claims: null, peerId: null };
    return this.#a2aAuth.validateInbound(req);
  }
}
