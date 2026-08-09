/**
 * TaskGrant — "authority travels with the task" (task-scoped delegation).
 *
 * Generalizes the working `BotAgentRegistry` pattern (a per-binding, scoped,
 * revocable "act-AS" cap-token wired into `PolicyEngine.setRevocationCheck`)
 * into a REUSABLE primitive: when a task needs the assignee (bot or human) to
 * reach a pod, an agent, or a skill it otherwise couldn't, the assigner attaches
 * a **task-scoped grant** — exactly what the task needs, no more — and it is
 * REVOKED when the task completes or is cancelled. No lingering access.
 *
 * The design (NOTE-skills-vs-capabilities volley 5 — "authority travels with
 * the task"):
 *   1. A task may carry a set of task-scoped grants (skill / pod / circle
 *      capability tokens). `attachGrant` issues ONE per call, tracked by taskId.
 *   2. ATTENUATION (the safety floor): a grant is a sub-token delegated FROM the
 *      granter's OWN authority — you can only grant equal-or-narrower than what
 *      you hold. When the manager is constructed with a `parentToken`, the issued
 *      token is a real chained sub-token (`parentId`) and MUST pass
 *      `CapabilityToken.verifyChain([parent, child])` (skill equal-or-narrower,
 *      expiry equal-or-shorter) — a wider grant is rejected. Without a parent it
 *      is a direct issue, bounded by the granter's own identity (they are the
 *      issuer, and the verifier still requires that issuer be trusted).
 *   3. BOUND TO TASK LIFETIME: `revokeTaskGrants(taskId)` adds every token
 *      materialized for the task to the issuer-side `#revoked` set, so
 *      `PolicyEngine.checkInbound` rejects them even if the holder still has the
 *      blob stored — this is what a consumer calls on task complete/cancel.
 *   4. OFF BY DEFAULT: nothing is granted unless `attachGrant` is explicitly
 *      called. There is no implicit/default grant — least-authority.
 *   5. BROKER/PROXY DEFAULT for sensitive data: keys stay home; a grant may pin
 *      processing to an attested enclave via `constraints` (folio model — the
 *      companion brokers, TEE later). This manager stays mechanism-only; the
 *      broker/enclave posture rides in the grant's `constraints` and is enforced
 *      downstream, not here.
 *
 * REUSE map (mirrors `RoleGrant.RoleGrantManager`, which itself reuses the
 * `BotAgentRegistry` revocation pattern):
 *   • CapabilityToken.issue      — the grant substrate (attenuated sub-tokens)
 *   • CapabilityToken.verifyChain — the narrower-only attenuation check
 *   • #revoked Set + setRevocationCheck — the single revocation enforcement point
 *
 * Enforcement is UNCHANGED and has NO second gate: a materialized token is
 * checked through the existing `PolicyEngine.checkInbound` / cap-token verify
 * path. Attenuation is enforced at ISSUE time (here); validity + revocation at
 * VERIFY time (PolicyEngine).
 */
import { CapabilityToken } from './CapabilityToken.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '../params.js';

// Parameter register (#36) — default task-grant lifetime (scope:device, kind:internal). Per-grant/template
// TTL still overrides, as before.
const DEFAULT_TTL_MS = param({ key: 'taskGrant.ttlMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 24 * 60 * 60 * 1000 }); // 24h — temporary; a template/param TTL overrides.

/**
 * Normalise + validate one grant template — the SAME GrantTemplate shape as
 * `RoleBundle` (skill / pod / actingAs / constraints / expiresIn). Mirrored here
 * (RoleBundle's `normaliseGrant` is not exported) so a task grant can never
 * authorise nothing: at least one of skill / pod / actingAs is required.
 *
 * @param {object} g — { skill?, pod?, actingAs?, constraints?, expiresIn? }
 * @returns {object} the normalised template
 */
function normaliseTaskGrant(g) {
  if (!g || typeof g !== 'object' || Array.isArray(g)) {
    throw new Error('TaskGrant: grant must be an object { skill?, pod?, actingAs?, constraints? }');
  }
  const out = {};
  if (g.skill !== undefined) {
    if (typeof g.skill !== 'string' || g.skill.length === 0) {
      throw new Error('TaskGrant: grant.skill must be a non-empty string');
    }
    out.skill = g.skill;
  }
  if (g.pod !== undefined) {
    const pods = Array.isArray(g.pod) ? g.pod : [g.pod];
    if (pods.length === 0 || pods.some((p) => typeof p !== 'string' || p.length === 0)) {
      throw new Error('TaskGrant: grant.pod must be a non-empty string or array of them');
    }
    out.pod = Array.isArray(g.pod) ? [...pods] : g.pod;
  }
  if (g.actingAs !== undefined) {
    if (typeof g.actingAs !== 'string' || g.actingAs.length === 0) {
      throw new Error('TaskGrant: grant.actingAs must be a non-empty string');
    }
    out.actingAs = g.actingAs;
  }
  if (g.constraints !== undefined) {
    if (!g.constraints || typeof g.constraints !== 'object' || Array.isArray(g.constraints)) {
      throw new Error('TaskGrant: grant.constraints must be an object');
    }
    out.constraints = { ...g.constraints };
  }
  if (g.expiresIn !== undefined) {
    if (typeof g.expiresIn !== 'number' || !Number.isFinite(g.expiresIn) || g.expiresIn <= 0) {
      throw new Error('TaskGrant: grant.expiresIn must be a finite positive number of ms');
    }
    out.expiresIn = g.expiresIn;
  }
  if (out.skill === undefined && out.pod === undefined && out.actingAs === undefined) {
    throw new Error('TaskGrant: grant must specify at least one of skill / pod / actingAs');
  }
  return out;
}

/**
 * Materialize task-scoped capability tokens for a member, attenuated from the
 * granter's OWN authority and revocable with the task.
 *
 * OFF BY DEFAULT: a freshly-constructed manager has granted nothing. Authority
 * exists on a task ONLY after an explicit `attachGrant`.
 */
export class TaskGrantManager {
  #identity;
  #agentId;
  /** The granter's own parent cap-token, if any — the attenuation ceiling. */
  #parentToken;
  /** Issuer-side revocation set (BotAgentRegistry / RoleGrant pattern). Set<tokenId>. */
  #revoked = new Set();
  /** taskId → CapabilityToken[] materialized for that task. */
  #grants = new Map();

  /**
   * @param {object} opts
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} opts.identity
   *   — the granter (token issuer); their identity is the authority floor.
   * @param {string} [opts.agentId] — the CapabilityToken `agentId` binding; defaults to identity.pubKey.
   * @param {CapabilityToken|object} [opts.parentToken] — the granter's OWN token to attenuate FROM.
   *   When supplied, every grant is issued as a chained sub-token (`parentId`) and must be
   *   equal-or-narrower than it (`verifyChain`). Omit for a direct issue bounded by the granter's identity.
   */
  constructor({ identity, agentId, parentToken } = {}) {
    if (!identity) throw new Error('TaskGrantManager requires identity');
    this.#identity = identity;
    this.#agentId  = agentId ?? identity.pubKey;
    this.#parentToken = parentToken
      ? (parentToken instanceof CapabilityToken ? parentToken : CapabilityToken.fromJSON(parentToken))
      : null;
  }

  /**
   * Wire this manager's revocation set into a PolicyEngine, so any token it
   * revoked fails `checkInbound` at the verifier. Same wiring as
   * `RoleGrantManager.installRevocationCheck` / `BotAgentRegistry`.
   * @param {import('./PolicyEngine.js').PolicyEngine} policyEngine
   */
  installRevocationCheck(policyEngine) {
    if (typeof policyEngine?.setRevocationCheck === 'function') {
      policyEngine.setRevocationCheck((tokenId) => this.#revoked.has(tokenId));
    }
  }

  /**
   * Attach ONE task-scoped grant: issue an attenuated CapabilityToken for
   * `memberPubKey` scoped to the task's need, stamped `constraints.task = taskId`
   * for provenance + revocation targeting, and tracked under `taskId`.
   *
   * ATTENUATION: with a `parentToken` on the manager, the issued token is a
   * chained sub-token and must pass `verifyChain([parent, issued])` (skill
   * equal-or-narrower, expiry equal-or-shorter). A grant that would exceed the
   * parent is rejected with a clear error. Without a parent it is a direct issue
   * bounded by the granter's identity.
   *
   * @param {object} args
   * @param {string} args.taskId
   * @param {string} args.memberPubKey — the grantee (token subject)
   * @param {object} args.grant — GrantTemplate: { skill?, pod?, actingAs?, constraints?, expiresIn? }
   * @param {number} [args.expiresIn=DEFAULT_TTL_MS] — TTL (ms); grant.expiresIn overrides.
   * @returns {Promise<CapabilityToken>} the issued token
   */
  async attachGrant({ taskId, memberPubKey, grant, expiresIn = DEFAULT_TTL_MS }) {
    if (typeof taskId !== 'string' || !taskId)               throw new TypeError('TaskGrantManager.attachGrant: taskId required');
    if (typeof memberPubKey !== 'string' || !memberPubKey)   throw new TypeError('TaskGrantManager.attachGrant: memberPubKey required');
    const t = normaliseTaskGrant(grant);

    // Compile the template's facets into token constraints. `task` is stamped
    // LAST so a caller-supplied `constraints.task` can never spoof provenance.
    const constraints = {};
    if (t.actingAs) constraints.actingAs = t.actingAs;
    if (t.pod)      constraints.pod      = t.pod;
    if (t.constraints) Object.assign(constraints, t.constraints);
    constraints.task = taskId;

    const issueOpts = {
      subject:   memberPubKey,
      agentId:   this.#agentId,
      skill:     t.skill ?? '*',
      expiresIn: t.expiresIn ?? expiresIn,
      constraints,
    };
    // Chain to the granter's own token so provenance is auditable (confused-
    // deputy guard) and attenuation is checkable.
    if (this.#parentToken) issueOpts.parentId = this.#parentToken.id;

    const token = await CapabilityToken.issue(this.#identity, issueOpts);

    // ATTENUATION FLOOR: a grant may never exceed what the granter holds.
    // verifyChain enforces skill equal-or-narrower + expiry equal-or-shorter.
    if (this.#parentToken && !CapabilityToken.verifyChain([this.#parentToken, token])) {
      throw new Error(
        `TaskGrantManager.attachGrant: grant (skill "${issueOpts.skill}") exceeds the granter's `
        + 'own authority — a task grant must be equal-or-narrower than the parent token (attenuation)',
      );
    }

    const list = this.#grants.get(taskId) ?? [];
    list.push(token);
    this.#grants.set(taskId, list);
    return token;
  }

  /**
   * Revoke EVERY grant materialized for `taskId` — "grants expire with the
   * task". Adds each token to the issuer-side revocation set so
   * `PolicyEngine.checkInbound` rejects them, then drops the task's tracking.
   * Call this when the task completes or is cancelled.
   *
   * @param {string} taskId
   * @returns {{ revokedTokenIds: string[] }}
   */
  revokeTaskGrants(taskId) {
    const tokens = this.#grants.get(taskId) ?? [];
    const revokedTokenIds = [];
    for (const tok of tokens) {
      this.#revoked.add(tok.id);
      revokedTokenIds.push(tok.id);
    }
    this.#grants.delete(taskId);
    return { revokedTokenIds };
  }

  /** @returns {CapabilityToken[]} tokens currently materialized for `taskId` (empty if none). */
  tokensForTask(taskId) {
    return [...(this.#grants.get(taskId) ?? [])];
  }

  /** @returns {boolean} whether `tokenId` has been revoked on this side. */
  isRevoked(tokenId) { return this.#revoked.has(tokenId); }
}
