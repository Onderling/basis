/**
 * PolicyEngine — single entry point for all inbound permission checks.
 *
 * Called by taskExchange.handleTaskRequest and other protocol handlers
 * before invoking a skill handler.
 *
 * Check order:
 *   1. TrustRegistry → peer tier
 *   2. skill.visibility vs tier (public < authenticated < trusted < private)
 *   3. skill.policy vs tier
 *   4. (Group D+) resource limit checks via AgentConfig
 *
 * Throws PolicyDeniedError on any denial; returns { tier, allowed: true } otherwise.
 */
import { TIER_LEVEL }    from './TrustRegistry.js';
import { CapabilityToken, offeringMatches } from './CapabilityToken.js';
import { roleRank }        from './Roles.js';

export class PolicyDeniedError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PolicyDeniedError';
    this.code = code;
  }
}

/**
 * Union several revocation sources into the ONE resolver a `PolicyEngine` takes at construction.
 *
 * A `PolicyEngine` holds exactly one revocation resolver and it is fixed at construction, so a
 * composer that has several sources of revocation truth — a grants lane, an issuer-side
 * `TokenRegistry`, a bot registry, a task-grant manager — has to combine them itself. This is that
 * combination, defined once so the deny-wins semantics are identical wherever it happens:
 *
 *   • sources are asked IN ORDER and the first truthy answer short-circuits (already revoked);
 *   • a source that THROWS propagates, and `checkInbound` turns that into a denial — a broken
 *     revocation source must never read as "not revoked" (safety over liveness);
 *   • `null` / `undefined` entries are skipped, so a composer can write a conditional source; any
 *     other non-function is a TypeError HERE, at compose time, rather than a silently missing
 *     source discovered at verify time.
 *
 * Sources are FUNCTIONS, not objects, on purpose: most real sources are built after the engine is,
 * so a composer passes a thunk that reads the variable when the check actually runs
 * (`(id) => registry?.isRevoked(id)`).
 *
 * @param {Array<((tokenId: string) => boolean | Promise<boolean>) | null | undefined>} sources
 * @returns {(tokenId: string) => Promise<boolean>} the resolver to pass as `isRevoked`
 */
export function anyRevoked(sources) {
  if (!Array.isArray(sources)) {
    throw new TypeError('anyRevoked: expected an array of revocation sources');
  }
  const fns = [];
  for (const s of sources) {
    if (s == null) continue;
    if (typeof s !== 'function') {
      throw new TypeError('anyRevoked: every revocation source must be a function (tokenId) => boolean|Promise<boolean>');
    }
    fns.push(s);
  }
  return async (tokenId) => {
    for (const fn of fns) {
      if (await fn(tokenId)) return true;
    }
    return false;
  };
}

/**
 * Central inbound permission gate. `checkInbound()` resolves the caller's trust tier
 * via the TrustRegistry, then checks it against the skill's visibility and policy,
 * honouring capability tokens, group roles (when a GroupManager is wired), and the
 * issuer-side revocation resolver it was constructed with. Throws PolicyDeniedError on any denial;
 * returns { tier, allowed: true } otherwise.
 */
export class PolicyEngine {
  #trustRegistry;
  #skillRegistry;
  #agentPubKey;   // this agent's pubKey, used to verify token.agentId binding

  #groupManager;
  #isRevoked;
  #actorResolver;  // Phase 50.9.1 — optional ActorResolver (pubKey ↔ webid ↔ agentUri)

  /**
   * @param {object} opts
   * @param {import('./TrustRegistry.js').TrustRegistry}         opts.trustRegistry
   * @param {import('../skills/SkillRegistry.js').SkillRegistry} opts.skillRegistry
   * @param {string} [opts.agentPubKey]  — this agent's Ed25519 pubKey (base64url)
   * @param {import('./GroupManager.js').GroupManager} [opts.groupManager]  — enables `requiredRole` checks
   * @param {(tokenId: string) => boolean | Promise<boolean>} [opts.isRevoked]
   *   The issuer-side revocation resolver, and the ONLY way one gets in —
   *   an engine's revocation truth is fixed at construction and cannot be
   *   swapped afterwards. When supplied, `checkInbound` calls it after the
   *   token's signature/expiry/subject/skill/issuer-trust checks pass; if
   *   it returns truthy the token is rejected as `INVALID_TOKEN: revoked`.
   *   Lets an agent maintain a local revocation list independent of the
   *   holder's `TokenRegistry.revoke` (which only protects the holder side).
   *
   *   ONE engine, ONE resolver — when several sources hold revocation truth
   *   (a grants lane, a bot registry, a task-grant manager), the site that
   *   BUILDS the engine unions them with `anyRevoked` and passes the result
   *   here. There is deliberately no setter: a settable resolver is
   *   last-writer-wins, and on 2026-08-19 that silently disarmed connection
   *   revocation — unpairing left the connection working.
   * @param {import('./ActorResolver.js').ActorResolver} [opts.actorResolver]
   *   Phase 50.9.1 — optional resolver mapping any of pubKey / webid /
   *   agentUri to an `ActorRecord`. Core defines the interface but never
   *   imports `@onderling/agent-registry`; the resolver is supplied by
   *   the caller (typically via the `@onderling/agent-provisioning`
   *   facade). When set, `resolveActor(identifier)` becomes available
   *   to callers + the token-verification path can accept URI-shaped
   *   agent IDs (Phase 50.10).
   */
  constructor({
    trustRegistry,
    skillRegistry,
    agentPubKey   = null,
    groupManager  = null,
    isRevoked     = null,
    actorResolver = null,
  }) {
    this.#trustRegistry = trustRegistry;
    this.#skillRegistry = skillRegistry;
    this.#agentPubKey   = agentPubKey;
    this.#groupManager  = groupManager;
    this.#isRevoked     = typeof isRevoked === 'function' ? isRevoked : null;
    this.#actorResolver = (actorResolver && typeof actorResolver.resolve === 'function')
      ? actorResolver
      : null;
  }

  /**
   * Phase 50.9.1 — resolve an identifier (any of pubKey / webid /
   * agentUri) to an `ActorRecord` via the injected `ActorResolver`.
   *
   * Returns `null` when no resolver is wired (or the identifier doesn't
   * resolve). Callers that need the actor record should treat `null`
   * as "unknown" and fall back to whatever they did before — typically
   * pubKey-only lookups.
   *
   * @param {string} identifier
   * @returns {Promise<import('./ActorResolver.js').ActorRecord|null>}
   */
  async resolveActor(identifier) {
    if (!this.#actorResolver) return null;
    const v = this.#actorResolver.resolve(identifier);
    // Support both sync and async resolvers.
    return (v && typeof v.then === 'function') ? await v : v;
  }

  /** Phase 50.9.1 — read-only access to the injected resolver (or null). */
  get actorResolver() { return this.#actorResolver; }

  /**
   * Check whether a peer is allowed to call a skill.
   *
   * @param {object}  opts
   * @param {string}  opts.peerPubKey   — caller's Ed25519 pubKey
   * @param {string}  opts.skillId
   * @param {string}  [opts.action='call']
   * @param {object}  [opts.token]      — raw CapabilityToken JSON from the RQ payload
   * @param {string}  [opts.agentPubKey] — this agent's pubKey (overrides constructor value)
   * @returns {Promise<{ tier: string, allowed: true }>}
   * @throws  {PolicyDeniedError}
   */
  async checkInbound({ peerPubKey, skillId, action = 'call', token = null, agentPubKey = null }) {
    const myPubKey = agentPubKey ?? this.#agentPubKey;
    const tier     = await this.#trustRegistry.getTier(peerPubKey);
    const skill    = this.#skillRegistry.get(skillId);

    if (!skill) {
      throw new PolicyDeniedError('NOT_FOUND', `Unknown skill: "${skillId}"`);
    }
    if (!skill.enabled) {
      throw new PolicyDeniedError('DISABLED', `Skill "${skillId}" is disabled`);
    }

    // Unknown values fail CLOSED, in opposite directions (2026-07-27).
    //
    // An unrecognised CALLER tier is treated as the lowest (`public`): we do not know who they are, so they
    // get the least. An unrecognised SKILL visibility is treated as the highest (`private`): we do not know
    // what it guards, so it is guarded most.
    //
    // Both used to default to 1 (`authenticated`). `defineSkill` validates visibility against the same four
    // tiers, so a registry built through it cannot contain an unknown one — but a hand-built registry (a
    // test, a future host, a typo in a migration) could, and the failure would have been silent and OPEN:
    // a skill nobody could name would have been reachable by any known peer.
    const callerLevel = TIER_LEVEL[tier]              ?? TIER_LEVEL.public;
    const required    = TIER_LEVEL[skill.visibility]  ?? TIER_LEVEL.private;

    if (callerLevel < required) {
      throw new PolicyDeniedError(
        'INSUFFICIENT_TIER',
        `Skill "${skillId}" requires tier "${skill.visibility}" but caller has "${tier}"`,
      );
    }

    // 'never' policy blocks all inbound callers unconditionally.
    if (skill.policy === 'never') {
      throw new PolicyDeniedError(
        'POLICY_NEVER',
        `Skill "${skillId}" is not available to external callers`,
      );
    }

    // role-aware group check.  A skill may declare
    //   requiredRole: { group: <groupId>, role: <roleId> }
    // to require the caller hold a group proof at or above the given role.
    if (skill.requiredRole) {
      if (!this.#groupManager) {
        throw new PolicyDeniedError(
          'NO_GROUP_MANAGER',
          `Skill "${skillId}" requires a group role but PolicyEngine has no GroupManager wired`,
        );
      }
      const { group, role } = skill.requiredRole;
      if (!group || !role) {
        throw new PolicyDeniedError(
          'INVALID_REQUIRED_ROLE',
          `Skill "${skillId}" requiredRole must specify { group, role }`,
        );
      }
      const callerRole = await this.#groupManager.getRole(peerPubKey, group);
      if (!callerRole) {
        throw new PolicyDeniedError(
          'NOT_A_MEMBER',
          `Skill "${skillId}" requires membership in group "${group}"`,
        );
      }
      const callerRank   = roleRank(callerRole) ?? 0;
      const requiredRank = roleRank(role)        ?? 0;
      if (callerRank < requiredRank) {
        throw new PolicyDeniedError(
          'INSUFFICIENT_ROLE',
          `Skill "${skillId}" requires role "${role}" in group "${group}" but caller has "${callerRole}"`,
        );
      }
    }

    if (skill.policy === 'always-allow') {
      return { tier, allowed: true };
    }

    // `requires-token` DEMANDS a token; every other policy merely verifies one
    // if offered (below). Token-less callers on a non-requires-token skill pass.
    if (skill.policy === 'requires-token' && !token) {
      throw new PolicyDeniedError(
        'NO_TOKEN',
        `Skill "${skillId}" requires a capability token`,
      );
    }

    // Invoke-time enforcement — the revocation/validity hole-closer. ANY
    // presented capability token is fully verified (signature · expiry · agent
    // binding · subject==caller · skill scope · issuer-trust · revocation),
    // whether or not the skill's policy demanded it. Previously verification ran
    // ONLY under `requires-token`, so a revoked/expired/forged token presented to
    // a default `on-request` skill passed on tier alone. An ABSENT token on a
    // non-requires-token skill still passes — trusted internal callers are
    // token-less by design. (Enabling this per-agent is a separate wiring/tier
    // decision; see PLAN-agent-management-surface.md.)
    if (token) {
      await this.#verifyPresentedToken(token, { skillId, peerPubKey, myPubKey });
    }

    return { tier, allowed: true };
  }

  /**
   * Fully verify a PRESENTED capability token, or throw `PolicyDeniedError`.
   * Shared by `requires-token` skills and the verify-when-present path so
   * revocation + validity are enforced identically everywhere a token is
   * offered — a revoked token can never slip through just because a skill's
   * policy is `on-request`.
   */
  async #verifyPresentedToken(token, { skillId, peerPubKey, myPubKey }) {
    let parsed;
    try {
      parsed = CapabilityToken.fromJSON(token);
    } catch {
      throw new PolicyDeniedError('INVALID_TOKEN', 'Token is malformed');
    }

    // Signature, expiry, and agentId binding. verify() may throw on malformed
    // data (e.g. a missing sig field) — treat any exception as invalid.
    let tokenOk;
    try { tokenOk = CapabilityToken.verify(parsed, myPubKey ?? undefined); }
    catch { tokenOk = false; }
    if (!tokenOk) {
      throw new PolicyDeniedError(
        'INVALID_TOKEN',
        'Token is expired, has an invalid signature, or targets a different agent',
      );
    }

    // Subject must be the caller — prevents token theft / forwarding.
    if (parsed.subject !== peerPubKey) {
      throw new PolicyDeniedError(
        'INVALID_TOKEN',
        'Token subject does not match the calling peer',
      );
    }

    // Skill must match: exact, wildcard '*', or `prefix.*` pattern.
    if (!offeringMatches(parsed.skill, skillId)) {
      throw new PolicyDeniedError(
        'INVALID_TOKEN',
        `Token grants skill "${parsed.skill}", not "${skillId}"`,
      );
    }

    // Issuer must be at least 'trusted' in this agent's TrustRegistry.
    const issuerTier  = await this.#trustRegistry.getTier(parsed.issuer);
    const issuerLevel = TIER_LEVEL[issuerTier] ?? 0;
    if (issuerLevel < TIER_LEVEL['trusted']) {
      throw new PolicyDeniedError(
        'INVALID_TOKEN',
        `Token issuer "${parsed.issuer.slice(0, 12)}…" is not trusted (tier: ${issuerTier})`,
      );
    }

    // issuer-side revocation list (optional). Catches "I revoked this
    // token I issued" before the handler runs, even when the holder still has
    // it stored locally.
    //
    // A THROWING check counts as REVOKED (2026-08-19). It used to be swallowed into
    // `revoked = false`, which meant an unreachable or broken revocation source admitted every token
    // it was supposed to be guarding — the one failure mode this list exists to prevent, and silent.
    // Safety over liveness: for a security boundary, deny wins. A caller whose
    // revocation source is flaky sees denials, which is loud and fixable; the alternative was
    // admitting revoked tokens, which is neither.
    if (this.#isRevoked) {
      let revoked = true;
      let checkFailed = null;
      try { revoked = await this.#isRevoked(parsed.id); } catch (e) { revoked = true; checkFailed = e; }
      if (revoked) {
        throw new PolicyDeniedError(
          'INVALID_TOKEN',
          checkFailed
            ? `Revocation check failed (${checkFailed?.message ?? 'unknown'}) — denying`
            : 'Token has been revoked',
        );
      }
    }
  }

  /**
   * Check whether we are allowed to call a skill on a peer (outbound).
   * Phase 1: always allow; Token attachment is Group E+.
   */
  async checkOutbound({ peerId, skillId }) {
    return { allowed: true };
  }
}
