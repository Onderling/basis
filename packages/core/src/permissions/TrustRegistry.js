/**
 * TrustRegistry — persists peer trust tiers in the Vault.
 *
 * Tier string → numeric level mapping:
 *   public        → 0  (unauthenticated, any caller)
 *   authenticated → 1  (known pubKey, no group required)
 *   trusted       → 2  (group member or capability token holder)
 *   private       → 3  (admin / self)
 *
 * Vault keys:  'trust:<pubKeyB64>' → JSON { tier, groups, tokenIds }
 */

/** @typedef {'public'|'authenticated'|'trusted'|'private'} Tier */

export const TIER_LEVEL = Object.freeze({
  public:        0,
  authenticated: 1,
  trusted:       2,
  private:       3,
});

/**
 * Vault-backed store of per-peer trust records ('trust:<pubKey>' → { tier, groups,
 * tokenIds }). Unknown peers default to tier 'authenticated'. Used by PolicyEngine to
 * resolve a caller's trust tier.
 */
export class TrustRegistry {
  #vault;

  /** @param {import('@onderling/vault').Vault} vault */
  constructor(vault) {
    if (!vault) throw new Error('TrustRegistry requires a vault');
    this.#vault = vault;
  }

  // ── Tier ─────────────────────────────────────────────────────────────────

  /** @param {Tier} tier */
  async setTier(pubKey, tier) {
    await this.#mutate(pubKey, (rec) => { rec.tier = tier; });
  }

  /** @returns {Tier} defaults to 'authenticated' for unknown peers */
  async getTier(pubKey) {
    const rec = await this.#load(pubKey);
    return rec.tier ?? 'authenticated';
  }

  /**
   * Whether this identity has a record at all — `getTier`/`getRecord` answer a default for an unknown one, so a
   * caller that treats "unknown" differently (a door's stranger is `public`, not `authenticated`) asks this first.
   * The key is any identity string: a pubKey for a peer, a contact id (`telegram:123`) for a person at a door.
   */
  async has(pubKey) {
    return (await this.#vault.get(`trust:${pubKey}`)) != null;
  }

  /** @returns {{ tier: Tier, groups: string[], tokenIds: string[] }} */
  async getRecord(pubKey) {
    return this.#load(pubKey);
  }

  // ── Groups ────────────────────────────────────────────────────────────────

  async addGroup(pubKey, groupId) {
    await this.#mutate(pubKey, (rec) => { if (!rec.groups.includes(groupId)) rec.groups.push(groupId); });
  }

  async removeGroup(pubKey, groupId) {
    await this.#mutate(pubKey, (rec) => { rec.groups = rec.groups.filter(g => g !== groupId); });
  }

  // ── Token grants ──────────────────────────────────────────────────────────

  async addTokenGrant(pubKey, tokenId) {
    await this.#mutate(pubKey, (rec) => { if (!rec.tokenIds.includes(tokenId)) rec.tokenIds.push(tokenId); });
  }

  // ── Enumerate ─────────────────────────────────────────────────────────────

  /** @returns {Promise<Record<string, object>>} */
  async all() {
    const keys  = await this.#vault.list();
    const trust = keys.filter(k => k.startsWith('trust:'));
    const out   = {};
    for (const k of trust) {
      const pubKey = k.slice(6);
      out[pubKey]  = await this.#load(pubKey);
    }
    return out;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  async #load(pubKey) {
    const raw = await this.#vault.get(`trust:${pubKey}`);
    return raw ? JSON.parse(raw) : { tier: 'authenticated', groups: [], tokenIds: [] };
  }

  /**
   * Change one record and write it ONLY when it changed: a start sets the same tiers and groups again, and every write
   * is a seal on the start's busiest seconds (the upgrade walk, 2026-11-20). A record that was absent is written.
   */
  async #mutate(pubKey, change) {
    const raw = await this.#vault.get(`trust:${pubKey}`);
    const rec = raw ? JSON.parse(raw) : { tier: 'authenticated', groups: [], tokenIds: [] };
    change(rec);
    const next = JSON.stringify(rec);
    if (raw != null && next === raw) return;
    await this.#vault.set(`trust:${pubKey}`, next);
  }
}
