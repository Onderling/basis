/**
 * TokenRegistry — vault-backed storage for held CapabilityTokens.
 *
 * "Held" tokens are tokens WE received from peers so we can present them
 * when calling skills on those agents.
 *
 * Vault keys:
 *   'token:<tokenId>'   → JSON-serialised token
 *   'revoked:<tokenId>' → '1'
 */
import { CapabilityToken, offeringMatches } from './CapabilityToken.js';

/**
 * Vault-backed store for CapabilityTokens received from peers ("held" tokens). `get()`
 * returns the latest-expiring valid token matching an agent+skill; `revoke()` marks a
 * token locally revoked; `cleanup()` deletes expired tokens from the vault.
 */
export class TokenRegistry {
  #vault;

  /** @param {import('@onderling/vault').Vault} vault */
  constructor(vault) {
    if (!vault) throw new Error('TokenRegistry requires a vault');
    this.#vault = vault;
  }

  /** Store a received token. */
  async store(token) {
    const t = token instanceof CapabilityToken ? token : CapabilityToken.fromJSON(token);
    await this.#vault.set(`token:${t.id}`, JSON.stringify(t.toJSON()));
  }

  /**
   * Find the best (latest-expiring, non-expired) token for a peer+skill.
   * @returns {Promise<CapabilityToken|null>}
   */
  async get(agentId, skill) {
    const keys = (await this.#vault.list()).filter(k => k.startsWith('token:'));
    let best = null;
    for (const k of keys) {
      const raw = await this.#vault.get(k);
      if (!raw) continue;
      const t = CapabilityToken.fromJSON(raw);
      if (t.isExpired) continue;
      if (await this.isRevoked(t.id)) continue;
      if (t.agentId !== agentId) continue;
      if (!offeringMatches(t.skill, skill)) continue;
      if (!best || t.expiresAt > best.expiresAt) best = t;
    }
    return best;
  }

  /** Whether this registry holds the token with this id (issued here and stored, whatever its state). */
  async holds(tokenId) {
    return typeof tokenId === 'string' && tokenId !== '' && this.#vault.has(`token:${tokenId}`);
  }

  /** Mark a token as locally revoked. */
  async revoke(tokenId) {
    await this.#vault.set(`revoked:${tokenId}`, '1');
  }

  /** @returns {Promise<boolean>} */
  async isRevoked(tokenId) {
    return this.#vault.has(`revoked:${tokenId}`);
  }

  /** Remove expired tokens from the vault. */
  async cleanup() {
    const keys = (await this.#vault.list()).filter(k => k.startsWith('token:'));
    for (const k of keys) {
      const raw = await this.#vault.get(k);
      if (!raw) continue;
      const t = CapabilityToken.fromJSON(raw);
      if (t.isExpired) await this.#vault.delete(k);
    }
  }
}
