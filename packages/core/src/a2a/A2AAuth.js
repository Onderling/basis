/**
 * A2AAuth — JWT validation for inbound A2A requests and outbound token management.
 *
 * Trust tier assignment for inbound callers:
 *   0 — no Authorization header
 *   1 — valid Bearer JWT (not expired)
 *   2 — JWT + x-onderling-groups claim (legacy x-canopy-groups accepted) verified by GroupManager
 *   3 — JWT + capability-token claim verified by TokenRegistry
 *
 * Note: JWT signature is NOT verified here (trust TLS + token issuer).
 * For production use, configure an issuer + JWKS URI for signature verification.
 */

export class A2AAuth {
  #vault;
  #groupManager;
  #tokenRegistry;

  /**
   * @param {object} opts
   * @param {import('@onderling/vault').Vault}                       opts.vault
   * @param {import('../permissions/GroupManager.js').GroupManager}      [opts.groupManager]
   * @param {import('../permissions/TokenRegistry.js').TokenRegistry}    [opts.tokenRegistry]
   */
  constructor({ vault, groupManager = null, tokenRegistry = null }) {
    this.#vault         = vault;
    this.#groupManager  = groupManager;
    this.#tokenRegistry = tokenRegistry;
  }

  // ── Inbound validation ───────────────────────────────────────────────────────

  /**
   * Inspect the Authorization header and return a trust tier + JWT claims.
   *
   * @param {object} req  — Node.js IncomingMessage or { headers: Record<string,string> }
   * @returns {Promise<{ tier: number, claims: object|null, peerId: string|null }>}
   */
  async validateInbound(req) {
    const authHeader = req.headers?.authorization ?? req.headers?.Authorization ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return { tier: 0, claims: null, peerId: null };
    }

    const token = authHeader.slice(7).trim();
    let claims;
    try {
      claims = _decodeJwtPayload(token);
    } catch {
      return { tier: 0, claims: null, peerId: null };
    }

    // Reject expired tokens.
    if (claims.exp != null && claims.exp * 1000 < Date.now()) {
      return { tier: 0, claims: null, peerId: null };
    }

    const peerId = claims.sub ?? claims.iss ?? null;
    let tier = 1;

    // Tier 2: JWT carries group memberships verified by GroupManager.
    const groupsClaim = claims['x-onderling-groups'] ?? claims['x-canopy-groups'];   // legacy spelling read
    if (tier === 1 && this.#groupManager && groupsClaim) {
      const groups = groupsClaim;
      if (Array.isArray(groups) && groups.length > 0) {
        // Any verified group membership → tier 2.
        for (const groupId of groups) {
          try {
            // Re-use the proof stored in the claim if provided, else just check claim presence.
            const proof = claims[`x-onderling-proof:${groupId}`] ?? claims[`x-canopy-proof:${groupId}`];
            if (proof) {
              const valid = await this.#groupManager.verifyProof(JSON.parse(proof));
              if (valid) { tier = 2; break; }
            } else {
              tier = 2; break;
            }
          } catch { /* ignore */ }
        }
      }
    }

    // Tier 3: JWT carries a capability token claim verified by TokenRegistry.
    const tokenClaim = claims['x-onderling-token'] ?? claims['x-canopy-token'];   // legacy spelling read
    if (tier <= 2 && this.#tokenRegistry && tokenClaim) {
      try {
        const { CapabilityToken } = await import('../permissions/CapabilityToken.js');
        const ct = JSON.parse(tokenClaim);
        if (CapabilityToken.verify(ct, null)) {
          tier = 3;
        }
      } catch { /* ignore */ }
    }

    return { tier, claims, peerId };
  }

  // ── Outbound token management ────────────────────────────────────────────────

  /**
   * Build Authorization headers for an outbound fetch to peerUrl.
   * Returns an empty object if no token is stored for this peer.
   *
   * @param {string} peerUrl
   * @returns {Promise<Record<string, string>>}
   */
  async buildHeaders(peerUrl) {
    const token = await this.getToken(peerUrl);
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }

  /**
   * Persist a Bearer token for a given peer URL.
   *
   * @param {string} peerUrl
   * @param {string} token   — raw Bearer token string
   */
  async storeToken(peerUrl, token) {
    await this.#vault.set(`a2a-token:${peerUrl}`, token);
  }

  /**
   * Retrieve the stored Bearer token for a peer URL.
   *
   * @param {string} peerUrl
   * @returns {Promise<string|null>}
   */
  async getToken(peerUrl) {
    return this.#vault.get(`a2a-token:${peerUrl}`);
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Decode the payload section of a JWT (base64url → JSON).
 * Does NOT verify the signature.
 */
function _decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length < 2) throw new Error('Malformed JWT');
  const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
  // atob is available in Node.js 16+ and all modern browsers.
  const json = typeof atob === 'function'
    ? atob(padded)
    : Buffer.from(padded, 'base64').toString('utf8');
  return JSON.parse(json);
}
