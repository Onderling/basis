/**
 * TaskGrant — "authority travels with the task" (task-scoped delegation).
 *
 * Generalizes the working `BotAgentRegistry` pattern (a per-binding, scoped,
 * revocable "act-AS" cap-token this manager holds as issuer-side truth)
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
 *   • #revoked Set + `isRevoked` — this manager is a revocation SOURCE, not a gate: the site
 *     that builds the agent's `PolicyEngine` unions it (with `anyRevoked`) into the ONE resolver
 *     the engine takes at construction. There is no way to push it in afterwards, on purpose.
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

/** Vault key holding the serialized revocation set + task index. */
const STORE_KEY = 'task-grants';

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
  /** Optional `{get,set}` persistence port — the same one `RoleGrantManager` takes. */
  #store = null;
  /** Resolves once the persisted state has loaded; already-resolved when there is no store. */
  #ready = Promise.resolve();

  /**
   * @param {object} opts
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} opts.identity
   *   — the granter (token issuer); their identity is the authority floor.
   * @param {string} [opts.agentId] — the CapabilityToken `agentId` binding; defaults to identity.pubKey.
   * @param {CapabilityToken|object} [opts.parentToken] — the granter's OWN token to attenuate FROM.
   *   When supplied, every grant is issued as a chained sub-token (`parentId`) and must be
   *   equal-or-narrower than it (`verifyChain`). Omit for a direct issue bounded by the granter's identity.
   * @param {{get:(k:string)=>Promise<string|null>, set:(k:string,v:string)=>Promise<*>}} [opts.store]
   *   — persistence for the revocation set + the task→tokens index. WITHOUT it both are memory-only,
   *   so a restart forgets every revocation while the tokens themselves stay signed and unexpired: the
   *   process re-admits holders it had already cut off, until TTL. `RoleGrantManager` has taken this
   *   same port since it was written; this class did not, and its header called its bare Set "the
   *   single revocation enforcement point". Omitting the store WARNS rather than degrading quietly.
   *   A PORT, not an adapter — the kernel never imports a concrete vault (invariant 5).
   */
  constructor({ identity, agentId, parentToken, store = null } = {}) {
    if (!identity) throw new Error('TaskGrantManager requires identity');
    this.#identity = identity;
    this.#agentId  = agentId ?? identity.pubKey;
    if (store && typeof store.get === 'function' && typeof store.set === 'function') {
      this.#store = store;
      this.#ready = this.#load();
    } else if (typeof console !== 'undefined') {
      console.warn(
        '[TaskGrantManager] no store — revocations are MEMORY-ONLY and will not survive a restart. '
        + 'Pass { store } (a vault-shaped {get,set}) to make revoke-wins durable.',
      );
    }
    this.#parentToken = parentToken
      ? (parentToken instanceof CapabilityToken ? parentToken : CapabilityToken.fromJSON(parentToken))
      : null;
  }

  /**
   * Await hydration. A composer that builds the `PolicyEngine` at boot should await this BEFORE the
   * engine can be asked anything: `isRevoked` is synchronous, so a check racing the load would report
   * "not revoked" for a token that is. (`RoleGrantManager` carries the same race and no seam to wait
   * on; worth closing there too.)
   * @returns {Promise<void>}
   */
  whenReady() { return this.#ready; }

  /** Hydrate the revocation set + the task index. Best-effort: a corrupt blob starts empty. */
  async #load() {
    try {
      const raw = await this.#store.get(STORE_KEY);
      if (!raw) return;
      const { revoked = [], grants = [] } = JSON.parse(raw);
      for (const id of revoked) this.#revoked.add(id);
      for (const [taskId, tokens] of grants) {
        this.#grants.set(taskId, tokens.map((t) => CapabilityToken.fromJSON(t)));
      }
    } catch { /* unreadable → start empty; the writes below re-establish it */ }
  }

  /** Persist after any mutation. Best-effort: a failed write must not fail the grant or the revoke. */
  async #persist() {
    if (!this.#store) return;
    try {
      await this.#store.set(STORE_KEY, JSON.stringify({
        revoked: [...this.#revoked],
        grants:  [...this.#grants.entries()].map(([taskId, tokens]) => [taskId, tokens.map((t) => t.toJSON())]),
      }));
    } catch { /* best-effort */ }
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
    await this.#persist();
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
  async revokeTaskGrants(taskId) {
    const tokens = this.#grants.get(taskId) ?? [];
    const revokedTokenIds = [];
    for (const tok of tokens) {
      this.#revoked.add(tok.id);
      revokedTokenIds.push(tok.id);
    }
    this.#grants.delete(taskId);
    // The in-memory effect is immediate — the await is the DURABILITY, which is the whole point of
    // this step: before it, a revoke survived exactly as long as the process did.
    await this.#persist();
    return { revokedTokenIds };
  }

  /** @returns {CapabilityToken[]} tokens currently materialized for `taskId` (empty if none). */
  tokensForTask(taskId) {
    return [...(this.#grants.get(taskId) ?? [])];
  }

  /**
   * Issuer-side revocation truth for this manager, and the seam a `PolicyEngine` composer reads:
   * `anyRevoked([(id) => mgr.isRevoked(id), …])` at engine construction.
   * @returns {boolean} whether `tokenId` has been revoked on this side.
   */
  isRevoked(tokenId) { return this.#revoked.has(tokenId); }
}
