/**
 * RoleGrant — assign a role AND materialize its capability bundle.
 *
 * The second half of the gap: `GroupManager.setRole` grants a STRING (a
 * signed governance proof) — but nothing turns the role's bundle into actual
 * authority the holder can PRESENT. `RoleGrantManager.grant` does both, in the
 * canonical order:
 *
 *   (a) set the governance role via `GroupManager.setRole` (signed, and — when
 *       an `actorPubKey` is supplied — gated by `canChangeRole → canPromote`);
 *       AND
 *   (b) MATERIALIZE the role's `RoleBundle`: issue one `CapabilityToken` per
 *       grant template (scoped skill + `actingAs` / pod / extra constraints +
 *       TTL as the template specifies), subject = the member, `agentId` = the
 *       granting agent.
 *
 * Enforcement is unchanged: a materialized token is checked through the
 * existing `PolicyEngine.checkInbound` / cap-token verify path — there is NO
 * second gate. Revocation is a local issuer-side `#revoked` set exposed as
 * `isRevoked`; the site that builds the agent's `PolicyEngine` unions that
 * source into the ONE resolver the engine takes at construction, so revoking
 * the role invalidates every token it materialized even if the holder still
 * has the blob stored.
 *
 * REUSE map:
 *   • RoleBundle       — the id → grants vocabulary (getRoleBundle)
 *   • GroupManager     — setRole / canChangeRole / revokeProof (governance)
 *   • CapabilityToken  — issue() the grant substrate
 *   • PolicyEngine     — the single enforcement point (reads `isRevoked` as one of its sources)
 */
import { CapabilityToken } from './CapabilityToken.js';
import { getRoleBundle }   from './RoleBundle.js';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h, matching GroupManager.setRole's default.

/** Composite key for the per-(group, member) materialized-token index. */
function mkey(groupId, memberPubKey) {
  return `${groupId}\u0000${memberPubKey}`;
}

/**
 * Materialize a RoleBundle for a member: issue one signed CapabilityToken per
 * grant template. Standalone (used by `RoleGrantManager.grant`, but callable on
 * its own for a token-only materialization without touching governance).
 *
 * @param {object} args
 * @param {import('../identity/AgentIdentity.js').AgentIdentity} args.identity — the granting agent (token issuer)
 * @param {string} args.agentId       — this agent's id / pubKey (the token's `agentId` binding)
 * @param {string} args.memberPubKey  — the grantee (token subject)
 * @param {string} args.groupId       — recorded in each token's constraints for provenance
 * @param {object} args.bundle        — a RoleBundle (`{ id, rank, grants }`)
 * @param {number} [args.expiresIn=DEFAULT_TTL_MS] — default TTL (ms); a template's own `expiresIn` overrides
 * @returns {Promise<CapabilityToken[]>}
 */
export async function materializeBundle({ identity, agentId, memberPubKey, groupId, bundle, expiresIn = DEFAULT_TTL_MS }) {
  if (!identity) throw new Error('materializeBundle: identity required');
  if (!bundle || !Array.isArray(bundle.grants)) {
    throw new Error('materializeBundle: a RoleBundle with grants[] is required');
  }
  const tokens = [];
  for (const g of bundle.grants) {
    // Compile the template's non-skill facets into token constraints. `role` +
    // `group` are stamped for provenance (who granted this, under which role).
    const constraints = { role: bundle.id, group: groupId };
    if (g.actingAs) constraints.actingAs = g.actingAs;
    if (g.pod)      constraints.pod      = g.pod;
    if (g.constraints) Object.assign(constraints, g.constraints);

    const token = await CapabilityToken.issue(identity, {
      subject:   memberPubKey,
      agentId,
      skill:     g.skill ?? '*',
      expiresIn: g.expiresIn ?? expiresIn,
      constraints,
    });
    tokens.push(token);
  }
  return tokens;
}

/** Vault key holding the serialized revocation set + materialized index. */
const STORE_KEY = 'role-grants';

/**
 * Grants a role to a member and materializes its bundle's capability tokens,
 * tracking the issued token ids so revoking the role invalidates them through
 * the PolicyEngine revocation hook.
 */
export class RoleGrantManager {
  #identity;
  #groupManager;
  #agentId;
  /** Issuer-side revocation set (BotAgentRegistry pattern). Set<tokenId>. */
  #revoked = new Set();
  /** mkey(groupId, memberPubKey) → string[] tokenIds currently materialized. */
  #materialized = new Map();
  /** Optional `{get,set}` persistence port — same shape TokenRegistry takes. */
  #store = null;
  /** Resolves once the persisted state has loaded; null when there is no store. */
  #ready = null;

  /**
   * @param {object} opts
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} opts.identity — the granting agent (issues tokens; the group admin)
   * @param {import('./GroupManager.js').GroupManager} opts.groupManager
   * @param {string} [opts.agentId] — the CapabilityToken `agentId` binding; defaults to identity.pubKey
   * @param {{get:(k:string)=>Promise<string|null>, set:(k:string,v:string)=>Promise<*>}} [opts.store]
   *   — persistence for the revocation set + materialized index. WITHOUT it both are memory-only, so a
   *   restart forgets every revocation while the tokens themselves stay signed and unexpired: the process
   *   re-admits holders it had already cut off, until TTL. That is the one failure this class exists to
   *   prevent, so omitting the store warns rather than degrading quietly. A PORT, not an adapter — the
   *   kernel never imports a concrete vault (invariant 5).
   */
  constructor({ identity, groupManager, agentId, store = null } = {}) {
    if (!identity)     throw new Error('RoleGrantManager requires identity');
    if (!groupManager) throw new Error('RoleGrantManager requires groupManager');
    this.#identity     = identity;
    this.#groupManager = groupManager;
    this.#agentId      = agentId ?? identity.pubKey;
    if (store && typeof store.get === 'function' && typeof store.set === 'function') {
      this.#store = store;
      this.#ready = this.#load();
    } else if (typeof console !== 'undefined') {
      console.warn(
        '[RoleGrantManager] no store — revocations are MEMORY-ONLY and will not survive a restart. '
        + 'Pass { store } (a vault-shaped {get,set}) to make revoke-wins durable.',
      );
    }
  }

  /** Hydrate the revocation set + materialized index. Best-effort: a corrupt blob starts empty. */
  async #load() {
    try {
      const raw = await this.#store.get(STORE_KEY);
      if (!raw) return;
      const { revoked = [], materialized = [] } = JSON.parse(raw);
      for (const id of revoked) this.#revoked.add(id);
      for (const [key, ids] of materialized) this.#materialized.set(key, ids);
    } catch { /* unreadable → start empty; the writes below will re-establish it */ }
  }

  /** Persist after any mutation. Best-effort: a failed write must not fail the grant/revoke itself. */
  async #persist() {
    if (!this.#store) return;
    try {
      await this.#store.set(STORE_KEY, JSON.stringify({
        revoked:      [...this.#revoked],
        materialized: [...this.#materialized.entries()],
      }));
    } catch { /* best-effort */ }
  }

  /**
   * Resolves once persisted state is loaded (immediately when there is no store). Callers that must not
   * act on a half-loaded registry await this.
   * @returns {Promise<void>}
   */
  async ready() { if (this.#ready) await this.#ready; }

  /**
   * Issuer-side revocation truth for this manager, and the seam a `PolicyEngine` composer reads:
   * `anyRevoked([(id) => mgr.isRevoked(id), …])` at engine construction. ASYNC on purpose — the check
   * must not answer "not revoked" from an unloaded set during the boot window; the engine awaits it,
   * and a throwing check denies.
   * @returns {Promise<boolean>} whether `tokenId` has been revoked on this side. Awaits the persisted
   *   set first, so a check during the boot window answers from the real state rather than an empty one.
   */
  async isRevoked(tokenId) {
    if (this.#ready) await this.#ready;
    return this.#revoked.has(tokenId);
  }

  /**
   * @returns {Promise<string[]>} tokenIds currently materialized for (groupId, memberPubKey).
   *   Async for the same reason as `isRevoked`: reading a half-loaded index would under-report.
   */
  async materializedTokenIds(memberPubKey, groupId) {
    if (this.#ready) await this.#ready;
    return [...(this.#materialized.get(mkey(groupId, memberPubKey)) ?? [])];
  }

  /**
   * Assign `roleId` to `memberPubKey` in `groupId` and materialize the role's
   * bundle. (a) governance proof via `GroupManager.setRole` (gated by
   * `canChangeRole` when `actorPubKey` is given), then (b) one cap-token per
   * bundle grant template. A re-grant revokes the member's PREVIOUS
   * materialized tokens for this group before issuing the fresh set.
   *
   * @param {object} args
   * @param {string} args.memberPubKey
   * @param {string} args.groupId
   * @param {string} args.roleId — must have a registered RoleBundle
   * @param {string} [args.actorPubKey] — if set, must out-rank the target (canChangeRole)
   * @param {number} [args.expiresIn=DEFAULT_TTL_MS]
   * @returns {Promise<{ proof: object, tokens: CapabilityToken[], roleId: string, rank: number }>}
   */
  async grant({ memberPubKey, groupId, roleId, actorPubKey = null, expiresIn = DEFAULT_TTL_MS }) {
    if (typeof memberPubKey !== 'string' || !memberPubKey) throw new TypeError('RoleGrantManager.grant: memberPubKey required');
    if (typeof groupId !== 'string' || !groupId)           throw new TypeError('RoleGrantManager.grant: groupId required');
    const bundle = getRoleBundle(roleId);
    if (!bundle) {
      throw new Error(`RoleGrantManager.grant: no role bundle registered for "${roleId}"`);
    }

    // Authority: when an actor is named, they must be allowed to set the
    // target's role (canChangeRole → canPromote). Left to the caller when
    // omitted (e.g. the circle admin materializing directly).
    if (actorPubKey) {
      const ok = await this.#groupManager.canChangeRole(actorPubKey, memberPubKey, groupId);
      if (!ok) {
        throw new Error(
          `RoleGrantManager.grant: "${actorPubKey.slice(0, 12)}…" may not grant role "${roleId}" in "${groupId}"`,
        );
      }
    }

    // (a) canonical, signed governance role change.
    const proof = await this.#groupManager.setRole(memberPubKey, groupId, roleId, { expiresIn });

    // (b) materialize the bundle's cap-tokens.
    const tokens = await materializeBundle({
      identity:     this.#identity,
      agentId:      this.#agentId,
      memberPubKey,
      groupId,
      bundle,
      expiresIn,
    });

    // Re-grant hygiene: the previous materialized set for this member+group is
    // now stale — revoke it so an old, broader role's tokens can't linger.
    // Awaited first so a grant during the boot window merges into the loaded state instead of
    // overwriting it — otherwise the persist below would erase every revocation on disk.
    if (this.#ready) await this.#ready;
    const key  = mkey(groupId, memberPubKey);
    const prev = this.#materialized.get(key) ?? [];
    for (const id of prev) this.#revoked.add(id);
    this.#materialized.set(key, tokens.map((t) => t.id));
    await this.#persist();

    return { proof, tokens, roleId: bundle.id, rank: bundle.rank };
  }

  /**
   * Revoke a member's role: invalidate every token materialized for
   * (groupId, memberPubKey) via the issuer-side revocation set, then remove
   * their governance proof. After this, the materialized tokens fail
   * `PolicyEngine.checkInbound` (revoked) and `getRole` returns null.
   *
   * @param {object} args
   * @param {string} args.memberPubKey
   * @param {string} args.groupId
   * @returns {Promise<{ revokedTokenIds: string[] }>}
   */
  async revoke({ memberPubKey, groupId }) {
    if (this.#ready) await this.#ready;
    const key = mkey(groupId, memberPubKey);
    const ids = this.#materialized.get(key) ?? [];
    for (const id of ids) this.#revoked.add(id);
    this.#materialized.delete(key);
    // Persist BEFORE the governance write: if the process dies between the two, a revocation that is
    // remembered but whose proof still stands is safe (the tokens are dead), while the reverse —
    // proof gone, revocation forgotten — would re-admit the holder on the next boot.
    await this.#persist();
    await this.#groupManager.revokeProof(memberPubKey, groupId);
    return { revokedTokenIds: [...ids] };
  }
}
