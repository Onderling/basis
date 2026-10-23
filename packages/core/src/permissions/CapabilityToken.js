/**
 * CapabilityToken — signed capability grants.
 *
 * A token gives a specific subject (peer pubKey) permission to call a
 * specific skill (or '*' for all) on a specific agent, until expiry.
 *
 * Tokens can be chained: a holder can issue attenuated sub-tokens
 * (same or narrower permissions, same or shorter expiry).
 *
 * Wire format (JSON-serialisable):
 * {
 *   id:         uuid,
 *   issuer:     pubKeyB64,
 *   subject:    pubKeyB64,
 *   agentId:    string,
 *   skill:      string | '*',
 *   constraints?: object,
 *   issuedAt:   unix-ms,
 *   expiresAt:  unix-ms,
 *   parentId?:  uuid,
 *   sig:        base64url
 * }
 */
import { AgentIdentity }                            from '../identity/AgentIdentity.js';
import { encode as b64encode, decode as b64decode } from '../crypto/b64.js';
import { genId }                                    from '../Envelope.js';
import { parseUntrustedJson } from '../security/untrustedJson.js';

/**
 * Immutable wrapper around a signed capability grant: `issuer` gives `subject`
 * permission to call `skill` (exact id, '<prefix>.*', or '*') on `agentId` until
 * `expiresAt`. Issue via the static `issue()`; check with `verify()` / `verifyAsync()`
 * / `verifyChain()`; `fromJSON()` re-hydrates a stored or wire token.
 */
export class CapabilityToken {
  #raw;

  constructor(raw) { this.#raw = raw; }

  get id()          { return this.#raw.id; }
  get issuer()      { return this.#raw.issuer; }
  get subject()     { return this.#raw.subject; }
  get agentId()     { return this.#raw.agentId; }
  get skill()       { return this.#raw.skill; }
  get constraints() { return this.#raw.constraints ?? {}; }
  get issuedAt()    { return this.#raw.issuedAt; }
  get expiresAt()   { return this.#raw.expiresAt; }
  get parentId()    { return this.#raw.parentId ?? null; }
  get isExpired()   { return Date.now() >= this.#raw.expiresAt; }

  /** Serialise for storage or wire transfer. */
  toJSON()  { return { ...this.#raw }; }
  toString(){ return JSON.stringify(this.#raw); }

  // ── Issuance ──────────────────────────────────────────────────────────────

  /**
   * Issue a signed CapabilityToken.
   *
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} identity
   * @param {object} opts
   * @param {string}  opts.subject      — recipient's pubKey (base64url)
   * @param {string}  opts.agentId      — this agent's id / pubKey
   * @param {string}  [opts.skill='*']  — skill id or '*' for all
   * @param {number}  [opts.expiresIn=3600000] — ms from now
   * @param {object}  [opts.constraints]
   * @param {string}  [opts.parentId]   — parent token id for chaining
   */
  static async issue(identity, opts) {
    const now = Date.now();
    const unsigned = {
      id:         genId(),
      issuer:     identity.pubKey,
      subject:    opts.subject,
      agentId:    opts.agentId,
      skill:      opts.skill   ?? '*',
      issuedAt:   now,
      expiresAt:  now + (opts.expiresIn ?? 3_600_000),
      ...(opts.constraints ? { constraints: opts.constraints } : {}),
      ...(opts.parentId    ? { parentId:    opts.parentId    } : {}),
      sig: null,
    };

    const sig = identity.sign(_canonical(unsigned));
    return new CapabilityToken({ ...unsigned, sig: b64encode(sig) });
  }

  // ── Verification ──────────────────────────────────────────────────────────

  /**
   * Verify signature and expiry.
   *
   * `agentId` may be either pubKey-shaped (legacy) or URI-shaped
   * (post-Phase 50.10: WebID-rooted agent URI, or
   * `pseudo-pod://<deviceId>/agent` for no-pod users). When
   * `expectedAgentId` doesn't match `token.agentId` literally **and** an
   * `actorResolver` is supplied, the resolver is consulted to bridge
   * the two shapes (e.g. expected=pubKey, token=URI → resolve URI →
   * compare its pubKey).
   *
   * @param {CapabilityToken|object} token
   * @param {string} [expectedAgentId]  — if set, verify token.agentId matches
   * @param {object} [opts]
   * @param {import('./ActorResolver.js').ActorResolver} [opts.actorResolver]
   *   Phase 50.10.2 — bridge pubKey ↔ URI-shaped agent IDs by resolving
   *   either side and comparing the resulting `ActorRecord`. Note: this
   *   verify path is **synchronous** when the resolver returns
   *   synchronously; async resolvers should use `verifyAsync`.
   */
  static verify(token, expectedAgentId, { actorResolver = null } = {}) {
    const raw = token instanceof CapabilityToken ? token.toJSON() : token;
    if (Date.now() >= raw.expiresAt) return false;

    if (expectedAgentId && raw.agentId !== expectedAgentId) {
      // Phase 50.10.2 — fall back to resolver-bridged comparison.
      if (!actorResolver || typeof actorResolver.resolve !== 'function') return false;
      const expectedRec = actorResolver.resolve(expectedAgentId);
      const tokenRec    = actorResolver.resolve(raw.agentId);
      // Both must resolve to the same record (or at least the same
      // pubKey, which is the canonical identity field).
      if (
        !expectedRec || !tokenRec ||
        (expectedRec.pubKey ?? '__a') !== (tokenRec.pubKey ?? '__b')
      ) return false;
    }

    const { sig, ...unsigned } = raw;
    unsigned.sig = null;
    return AgentIdentity.verify(_canonical(unsigned), b64decode(sig), raw.issuer);
  }

  /**
   * Async variant of `verify` for resolvers whose `resolve(...)` returns
   * a Promise. Verifies signature + expiry first (sync), then awaits
   * the resolver for the URI ↔ pubKey bridge if needed.
   *
   * @param {CapabilityToken|object} token
   * @param {string} [expectedAgentId]
   * @param {object} [opts]
   * @param {import('./ActorResolver.js').ActorResolver} [opts.actorResolver]
   * @returns {Promise<boolean>}
   */
  static async verifyAsync(token, expectedAgentId, { actorResolver = null } = {}) {
    const raw = token instanceof CapabilityToken ? token.toJSON() : token;
    if (Date.now() >= raw.expiresAt) return false;

    if (expectedAgentId && raw.agentId !== expectedAgentId) {
      if (!actorResolver || typeof actorResolver.resolve !== 'function') return false;
      const expectedRec = await actorResolver.resolve(expectedAgentId);
      const tokenRec    = await actorResolver.resolve(raw.agentId);
      if (
        !expectedRec || !tokenRec ||
        (expectedRec.pubKey ?? '__a') !== (tokenRec.pubKey ?? '__b')
      ) return false;
    }

    const { sig, ...unsigned } = raw;
    unsigned.sig = null;
    return AgentIdentity.verify(_canonical(unsigned), b64decode(sig), raw.issuer);
  }

  /**
   * Verify a token chain: walk parentId links, check attenuation (skill must
   * be equal-or-narrower, expiry must be equal-or-shorter than parent).
   * For Phase 1 this just verifies each link independently.
   */
  static verifyChain(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) return false;
    for (const t of tokens) {
      if (!CapabilityToken.verify(t)) return false;
    }
    // Check attenuation: each child must not exceed parent's permissions.
    for (let i = 1; i < tokens.length; i++) {
      const parent = tokens[i - 1] instanceof CapabilityToken ? tokens[i-1].toJSON() : tokens[i-1];
      const child  = tokens[i]     instanceof CapabilityToken ? tokens[i].toJSON()   : tokens[i];
      if (!skillAttenuates(parent.skill, child.skill)) return false;
      if (child.expiresAt > parent.expiresAt)                   return false;
    }
    return true;
  }

  // ── Parse ─────────────────────────────────────────────────────────────────

  static fromJSON(obj) {
    return new CapabilityToken(typeof obj === 'string' ? parseUntrustedJson(obj) : obj);
  }
}

/**
 * Match a token's `skill` field against a concrete skill id.
 *
 * Three pattern shapes are supported:
 *   - `'*'`           — wildcard, matches every skill
 *   - `'<exact-id>'`  — must equal the skill id
 *   - `'<prefix>.*'`  — matches any skill id that starts with `<prefix>.`
 *                      (added to scope cap-token-bound
 *                       bot agents to the `bot.*` surface only).
 *
 * Returns `false` for any other shape; callers should treat unknown
 * patterns as "no match" so a malformed token can never widen access.
 */
export function offeringMatches(pattern, skillId) {
  if (typeof pattern !== 'string' || typeof skillId !== 'string') return false;
  if (pattern === '*') return true;
  if (pattern === skillId) return true;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -1);          // 'bot.' from 'bot.*'
    return skillId.startsWith(prefix) && skillId.length > prefix.length;
  }
  return false;
}

/**
 * Test whether `child` is equal-or-narrower than `parent` for chain
 * attenuation. Used by `verifyChain`. Rules:
 *   - parent `'*'`        → any child
 *   - parent `'p.*'`      → child `'p.*'` OR child `'p.x'`
 *   - parent `'p.x'`      → child must equal `'p.x'`
 */
export function skillAttenuates(parent, child) {
  if (parent === '*') return true;
  if (parent === child) return true;
  if (typeof parent !== 'string' || typeof child !== 'string') return false;
  if (parent.endsWith('.*')) {
    const prefix = parent.slice(0, -1);
    if (child === parent) return true;             // identical prefixes
    if (child.endsWith('.*')) {
      const childPrefix = child.slice(0, -1);
      return childPrefix.startsWith(prefix);       // narrower or equal prefix
    }
    return child.startsWith(prefix) && child.length > prefix.length;
  }
  return false;
}

function _canonical(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}
