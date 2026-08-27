/**
 * remoteHandlers.js — B #63 Tier-2: the remote-handler dispatch tier.
 *
 * The functionality an op names can live "wherever": a local handler, an
 * external agent, a model, the pod, an MCP service, a scheduled job
 * (CLAUDE.md — "the model"). This module adds the **external-agent tier**
 * on top of the existing local-handler path, ADDITIVELY:
 *
 *   1. `RemoteHandlerRegistry` — a runtime, per-op registry mapping
 *      `opId → { remoteAddress, skillId, capabilityRequired }`. Registration
 *      is live: an op can be pointed at a remote agent at runtime
 *      (live-agent extensibility) and un-pointed again.
 *
 *   2. `dispatchRemoteOp` — when an op resolves to a remote handler, route
 *      the call to that remote agent over **A2A** via `agent.invoke(...)`
 *      (which is the kernel's `callSkill`). No custom transport, no custom
 *      gate: the call goes THROUGH the kernel's dispatch, so the receiver's
 *      `runGatedSkill` / PolicyEngine gate runs unchanged.
 *
 *   3. Authorisation is a kernel `CapabilityToken`: `callSkill` attaches the
 *      caller's held token (`agent.tokenRegistry.get(peer, skill)`) and the
 *      remote agent's `PolicyEngine.checkInbound` verifies it. **The grant
 *      IS the gate** for remote handlers. Revoking the grant — issuer-side
 *      (the host engine's `isRevoked`, composed when that engine is built) or
 *      holder-side (`TokenRegistry.revoke`, which makes `.get` skip it) —
 *      makes the same dispatch deny.
 *
 * Placement — substrate, NOT kernel (invariant #5). Everything here is
 * COMPOSITION of existing kernel pieces (`Agent.invoke`/`callSkill`,
 * `PolicyEngine`, `CapabilityToken`, `TokenRegistry`, the transport port).
 * It reinvents no kernel primitive, so it belongs in a substrate
 * (`@onderling/secure-agent`) and keeps `@onderling/core` lean. Crucially it does
 * NOT touch or bypass the `callSkill` security gate — it only decides
 * *where* an op is dispatched, then hands off to the kernel.
 */

/**
 * Sentinel returned by `dispatchRemoteOp` when an op is NOT registered as a
 * remote handler. The caller uses it to fall through to its existing local
 * dispatch — so the local-handler path is byte-unchanged.
 */
export const NOT_REMOTE = Symbol('remote-handler:not-remote');

/**
 * Live registry of op → remote-handler bindings.
 *
 * Kept deliberately tiny: a keyed map with runtime register/unregister so an
 * external agent can be bound (or rebound) to an op while the process runs.
 */
export class RemoteHandlerRegistry {
  /** @type {Map<string, { remoteAddress: string, skillId: string, capabilityRequired: boolean }>} */
  #byOp = new Map();

  /**
   * Bind an op to a remote handler (external agent). Last-write-wins, so an
   * op can be re-pointed at a different agent at runtime.
   *
   * @param {string} opId
   * @param {object} binding
   * @param {string} binding.remoteAddress        — the remote agent's address (pubKey)
   * @param {string} [binding.skillId]            — skill id on the remote agent (defaults to opId)
   * @param {boolean} [binding.capabilityRequired] — informational; the real gate is the
   *                                                 remote skill's `policy` + PolicyEngine
   * @returns {this}
   */
  register(opId, { remoteAddress, skillId, capabilityRequired = true } = {}) {
    if (typeof opId !== 'string' || !opId) {
      throw new Error('RemoteHandlerRegistry.register: opId (non-empty string) required');
    }
    if (typeof remoteAddress !== 'string' || !remoteAddress) {
      throw new Error(`RemoteHandlerRegistry.register("${opId}"): remoteAddress required`);
    }
    this.#byOp.set(opId, {
      remoteAddress,
      skillId:            skillId ?? opId,
      capabilityRequired: !!capabilityRequired,
    });
    return this;
  }

  /** @returns {{ remoteAddress: string, skillId: string, capabilityRequired: boolean }|null} */
  get(opId)        { return this.#byOp.get(opId) ?? null; }
  has(opId)        { return this.#byOp.has(opId); }
  /** @returns {boolean} true if a binding was removed */
  unregister(opId) { return this.#byOp.delete(opId); }
  /** @returns {string[]} the registered op ids */
  list()           { return [...this.#byOp.keys()]; }
  get size()       { return this.#byOp.size; }
}

/**
 * Dispatch an op through the remote-handler tier.
 *
 * If `opId` is bound to a remote handler, route the call to that remote agent
 * over A2A via `agent.invoke` (kernel `callSkill`), returning the skill's
 * result parts. The kernel attaches the held CapabilityToken and the remote
 * PolicyEngine gates the call — so an invalid / missing / wrong-scope /
 * revoked token DENIES (the invoke rejects).
 *
 * If `opId` is NOT bound remotely, returns the `NOT_REMOTE` sentinel so the
 * caller falls through to its existing local-handler dispatch (additive).
 *
 * @param {import('@onderling/core').Agent} agent          — the dispatching (caller) agent
 * @param {RemoteHandlerRegistry}        registry
 * @param {string}                       opId
 * @param {import('@onderling/core').Part[]} [parts=[]]
 * @param {object}                       [opts]          — forwarded to agent.invoke (timeout, ttl, …)
 * @returns {Promise<import('@onderling/core').Part[] | typeof NOT_REMOTE>}
 */
export async function dispatchRemoteOp(agent, registry, opId, parts = [], opts = {}) {
  const entry = registry?.get?.(opId);
  if (!entry) return NOT_REMOTE;
  // Route over A2A. `agent.invoke` === kernel callSkill: it looks up a held
  // CapabilityToken for (remoteAddress, skillId) and the remote agent's
  // PolicyEngine.checkInbound verifies it. We add nothing to the gate.
  return agent.invoke(entry.remoteAddress, entry.skillId, parts, opts);
}

/**
 * Issue an ocap grant for a remote handler and hand it to the caller.
 *
 * The **host** (the agent exposing the skill / the external agent) signs a
 * `CapabilityToken` granting `callerAgent` the right to call `skillId`, then
 * stores it in the caller's `TokenRegistry` so the kernel's `callSkill`
 * attaches it automatically on dispatch.
 *
 * This is convenience wiring only — it composes the existing
 * `Agent.issueCapabilityToken` + `TokenRegistry.store`. Apps may issue/store
 * the grant however they like; the tier only cares that a valid token is in
 * the caller's TokenRegistry at dispatch time.
 *
 * @param {object} p
 * @param {import('@onderling/core').Agent} p.hostAgent     — issues the grant (the remote/external agent)
 * @param {import('@onderling/core').Agent} p.callerAgent   — receives + holds the grant
 * @param {string}  p.skillId                            — skill id (or pattern) the grant covers
 * @param {number}  [p.expiresIn]                        — seconds; forwarded to issueCapabilityToken
 * @param {object}  [p.constraints]
 * @returns {Promise<import('@onderling/core').CapabilityToken>} the issued token
 */
export async function grantRemoteCapability({ hostAgent, callerAgent, skillId, expiresIn, constraints }) {
  if (!hostAgent?.issueCapabilityToken) {
    throw new Error('grantRemoteCapability: hostAgent must expose issueCapabilityToken');
  }
  if (!callerAgent?.tokenRegistry) {
    throw new Error('grantRemoteCapability: callerAgent must have a TokenRegistry');
  }
  const token = await hostAgent.issueCapabilityToken({
    subject: callerAgent.address,
    skill:   skillId,
    ...(expiresIn   != null ? { expiresIn }   : {}),
    ...(constraints != null ? { constraints } : {}),
  });
  await callerAgent.tokenRegistry.store(token);
  return token;
}
