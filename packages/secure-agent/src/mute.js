/**
 * @onderling/secure-agent — persistent peer mute set.
 *
 * Layer: substrate.  Platform-neutral (depends only on the Vault
 * interface from @onderling/vault).
 *
 * Wires A.1 from the v0.7 security roadmap.  A mute applies to:
 *   - inbound HI       (rejected via the helloGate composition)
 *   - inbound envelopes (dropped before onPeerMessage fires)
 *   - outbound sendTo  (throws — refuse to talk to muted peers)
 *
 * Mute is matched on the NKN peer ADDRESS today.  Future S-slices
 * (S4 identity-resolver) will additionally match on stableId + webid
 * once those mappings are available at this layer.
 */

/**
 * Build a MuteSet bound to a vault key.  Persistence is opt-in: if
 * `vaultKey` is falsy the set is in-memory only (still useful for
 * the factory consumer that wants the API without persistence).
 *
 * @param {object} args
 * @param {object} args.vault             VaultMemory | VaultLocalStorage
 * @param {string|null} [args.vaultKey]   persistence slot; null → in-memory
 * @returns {Promise<MuteSet>}
 */
export async function loadMuteSet({ vault, vaultKey = null } = {}) {
  const set = new Map();   // key → { label, at } — what the person saw when they tapped block, and when
  if (vaultKey && vault) {
    try {
      const raw = await vault.get(vaultKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const e of parsed) {
            if (typeof e === 'string') set.set(e, { label: null, at: null });   // a block written before the label
            else if (e && typeof e.k === 'string') set.set(e.k, { label: typeof e.l === 'string' && e.l ? e.l : null, at: typeof e.at === 'number' ? e.at : null });
          }
        }
      }
    } catch {
      // Corrupt slot → start clean; next persist overwrites it.
    }
  }
  return new MuteSet({ set, vault, vaultKey });
}

/**
 * The block set: keys the receive path refuses, each with the LABEL the person saw when they blocked it and the
 * moment they did. The label is never used to match — only to say who it was, so a list of blocks is a list of
 * names ("Jan (geblokkeerd 6 nov)") and never a list of keys.
 */
export class MuteSet {
  #set;
  #vault;
  #key;

  constructor({ set, vault, vaultKey }) {
    this.#set   = set instanceof Map ? set : new Map([...(set ?? [])].map((k) => [k, { label: null, at: null }]));
    this.#vault = vault;
    this.#key   = vaultKey;
  }

  has(peerKey)  { return this.#set.has(peerKey); }
  list()        { return [...this.#set.keys()]; }
  /** @returns {Array<{key: string, label: string|null, at: number|null}>} */
  entries()     { return [...this.#set].map(([key, e]) => ({ key, label: e.label ?? null, at: e.at ?? null })); }
  get size()    { return this.#set.size; }

  /**
   * @param {string} peerKey
   * @param {{ label?: string|null, at?: number }} [meta]  the name the person saw, and when (default: now)
   */
  async add(peerKey, { label = null, at = Date.now() } = {}) {
    if (typeof peerKey !== 'string' || !peerKey) {
      throw new Error('MuteSet.add: peerKey must be a non-empty string');
    }
    if (this.#set.has(peerKey)) return false;
    this.#set.set(peerKey, { label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 80) : null, at });
    await this.#persist();
    return true;
  }

  async remove(peerKey) {
    if (!this.#set.has(peerKey)) return false;
    this.#set.delete(peerKey);
    await this.#persist();
    return true;
  }

  async clear() {
    if (this.#set.size === 0) return;
    this.#set.clear();
    await this.#persist();
  }

  async #persist() {
    if (!this.#key || !this.#vault) return;
    await this.#vault.set(this.#key, JSON.stringify([...this.#set].map(([k, e]) => ({ k, l: e.label, at: e.at }))));
  }
}
