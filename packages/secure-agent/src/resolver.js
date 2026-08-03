/**
 * @onderling/secure-agent — peer identity resolver wrapper.
 *
 * Wires A.4 from the v0.7 security roadmap.  Composes:
 *
 *   transport address  →  pubKey   (via Agent.security.getPeerKey)
 *   pubKey             →  member   (via MemberMap.resolveByPubKey)
 *   webid              →  member   (via MemberMap.resolveByWebid)
 *   stableId           →  member   (via MemberMap.resolveByStableId)
 *
 * The "member" shape — webid, pubKey, stableId, displayName, role —
 * is whatever the supplied resolver returns; this wrapper is
 * source-agnostic (it doesn't know whether the underlying source is
 * a hand-built MemberMap, an AgentRegistryMemberMap, or a pod-side
 * resolver).
 *
 * # Why
 *
 * Identity moves: a peer's NKN address changes on every reconnect,
 * their pubKey rotates every few weeks, their pod URL changes on
 * migration.  But "this is Alice" persists.  Apps want to act on
 * THAT (mute Alice, capability-grant Alice, audit Alice) — not on
 * the volatile address-of-the-moment.  This resolver gives the
 * stable identity for any volatile identifier we hold.
 *
 * # Mute integration
 *
 * The mute set stores opaque strings.  With a resolver wired, an
 * inbound envelope is checked against the mute set in TWO ways:
 *   1. Direct match on env._from (the volatile transport address)
 *   2. Resolved member fanout (webid / stableId / pubKey)
 *
 * So `sa.mute.add('https://alice.example/#me')` blocks Alice on every
 * device, every reconnect, after every key rotation.
 */

/**
 * Build a peer resolver bound to a SecurityLayer (for addr → pubKey)
 * and an optional MemberMap-like (for pubKey/webid/stableId → member).
 *
 * Either source may be absent:
 *   - no `security`: addr-based lookups return null
 *   - no `memberMap`: pubKey/webid-based lookups return null
 *
 * The wrapper itself never throws on missing sources — callers should
 * tolerate null returns ("no info" is the universal degraded state).
 *
 * @param {object} args
 * @param {object} [args.security]     SecurityLayer instance (for getPeerKey)
 * @param {object} [args.memberMap]    object exposing resolveByPubKey /
 *                                     resolveByWebid / resolveByStableId
 * @returns {PeerResolver}
 */
export function createPeerResolver({ security, memberMap } = {}) {
  return new PeerResolver({ security, memberMap });
}

export class PeerResolver {
  #security;
  #memberMap;
  /** @type {((addr:string)=>string|null)|null} host-supplied alias→canonical identity (Decision 4). */
  #identityForAddr;

  constructor({ security, memberMap, identityForAddr = null }) {
    this.#security  = security  ?? null;
    this.#memberMap = memberMap ?? null;
    // ── Decision 4 correction (2026-08-03) ──────────────────────────────────────────────────────────
    // `alias address → the person's CANONICAL identity key`. MUST be supplied by a host that has one,
    // because since Decision 4 the SecurityLayer can no longer answer it: a per-circle address is bound
    // to that CIRCLE's signing key, deliberately unrelated to the person. So `getPeerKey(circleAddress)`
    // returns a different answer per circle — correct for the wire, and exactly wrong for "who is this".
    //
    // Without this, wiring the resolver would fold a per-circle signing key into a person's alias set and
    // re-create the linkage Decision 4 exists to remove. `createSecureAgent` keeps the map for this
    // (`peerIdentityOf`, and its comment says why it lives on the device: "it is nobody else's to see").
    this.#identityForAddr = typeof identityForAddr === 'function' ? identityForAddr : null;
  }

  get hasMemberMap() { return !!this.#memberMap; }
  get hasSecurity()  { return !!this.#security; }

  /**
   * Look up the pubKey we know for a given transport address.
   * Returns null if no SecurityLayer or no HI received from this peer yet.
   */
  pubKeyForAddr(addr) {
    // The host's device-local identity link FIRST — see the constructor. Only it can answer "who is this"
    // correctly for a per-circle address; the SecurityLayer answers "which key signs here", a different
    // question with a different answer per circle.
    if (this.#identityForAddr) {
      const canonical = this.#identityForAddr(addr);
      if (canonical) return canonical;
    }
    if (!this.#security || typeof this.#security.getPeerKey !== 'function') return null;
    return this.#security.getPeerKey(addr);
  }

  /**
   * Resolve a peer's stable identity from anything we know.  Order:
   *   1. address → pubKey (via SecurityLayer) → member (via memberMap.resolveByPubKey)
   *   2. address treated as pubKey directly → member.resolveByPubKey
   *      (some transports use pubKey AS the address)
   *
   * @param {string} addr
   * @returns {Promise<object|null>}
   */
  async resolveByAddr(addr) {
    if (!addr) return null;
    const pubKey = this.pubKeyForAddr(addr);
    if (pubKey && this.#memberMap?.resolveByPubKey) {
      const m = await this.#memberMap.resolveByPubKey(pubKey);
      if (m) return m;
    }
    // Fallback: treat addr as pubKey (pubKey-addressed transports).
    if (this.#memberMap?.resolveByPubKey) {
      const m = await this.#memberMap.resolveByPubKey(addr);
      if (m) return m;
    }
    return null;
  }

  async resolveByPubKey(pubKey) {
    if (!pubKey || !this.#memberMap?.resolveByPubKey) return null;
    return this.#memberMap.resolveByPubKey(pubKey);
  }

  async resolveByWebid(webid) {
    if (!webid || !this.#memberMap?.resolveByWebid) return null;
    return this.#memberMap.resolveByWebid(webid);
  }

  async resolveByStableId(stableId) {
    if (!stableId || !this.#memberMap?.resolveByStableId) return null;
    return this.#memberMap.resolveByStableId(stableId);
  }

  /**
   * Compute the SET of identifiers we believe equate to this peer.
   * Used by mute-fanout: an inbound envelope is muted if ANY of these
   * is in the mute set.
   *
   * @param {string} addr
   * @returns {Promise<string[]>}   addr + pubKey + webid + stableId
   *                                (each only if known; deduped)
   */
  async aliasesFor(addr) {
    const set = new Set();
    if (addr) set.add(addr);
    const pubKey = this.pubKeyForAddr(addr);
    if (pubKey) set.add(pubKey);
    const m = await this.resolveByAddr(addr);
    if (m?.pubKey)   set.add(m.pubKey);
    if (m?.webid)    set.add(m.webid);
    if (m?.stableId) set.add(m.stableId);
    return [...set];
  }
}
