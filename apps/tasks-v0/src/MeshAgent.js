/**
 * MeshAgent — Tasks process-level shared agent.
 *
 * Lifts the `core.Agent` + `policyEngine` + `trustRegistry` +
 * `tokenRegistry` + identity vault out of `createCircleAgent` so a
 * single agent serves every circle the process knows about. Mirrors
 * Stoop's 2026-05-08 single-agent refactor (see
 * `Project Files/Stoop/single-agent-refactor-2026-05-08.md` § "Tasks-app
 * fix propagation"). Per-circle state lives in `CircleState` (see
 * `./Circle.js`); skills register once via `./wireSkills.js` with a
 * `bundleResolver` that picks the right CircleState per call.
 *
 * Why one agent per process:
 *   - One transport stack (one mDNS registration, one relay socket,
 *     one InternalBus listener per channel).
 *   One PolicyEngine + TrustRegistry + TokenRegistry — self-trust
 *     is set once.
 *   One identity vault — 's restart-survival snapshot lives at
 *     a process-level path, not per-circle.
 *   Cap-token-bound bot agents still spin up per binding;
 *     they share the same bus the meshAgent uses, so they reach the
 *     meshAgent transparently.
 */

import { Agent, AgentIdentity, InternalBus, InternalTransport, TrustRegistry, PolicyEngine, anyRevoked } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

const DEFAULT_IDENTITY_VAULT_PATH = 'mem://tasks/process/agent-identity-vault.json';

/**
 * @param {object} args
 * @param {object} [args.identity]
 * @param {object} [args.transport]
 * @param {object} [args.localStoreBundle]
 *   When supplied + `identityVault` is set, the vault snapshot is
 *   read/written via `localStoreBundle.cache` so the agent identity
 *   survives CLI restarts. (mechanism, lifted to process scope.)
 * @param {string} [args.identityVault=mem://tasks/process/agent-identity-vault.json]
 * @param {string} [args.label='TasksMeshAgent']
 * @param {() => Iterable<object>} [args.circleStates]
 *   The live CircleStates this agent serves — the agent's REVOCATION TRUTH. A PolicyEngine takes
 *   one revocation resolver at construction and it can never be replaced, so this is where the
 *   sources are unioned: every circle's `taskGrantManager` (task-scoped grants) and
 *   `botAgentRegistry` (bot cap-tokens). Passed as a PROVIDER because the circles are built after
 *   the agent is, and because the multi-circle runtime adds more of them while the process runs.
 *   Omitted → no revocation source, so no token is ever rejected as revoked.
 * @returns {Promise<{
 *   meshAgent:       object,
 *   vault:           object,
 *   identity:        object,
 *   identityVault:   string,
 *   policyEngine:    object,
 *   trustRegistry:   object,
 * }>}
 */
export async function buildMeshAgent({
  identity,
  transport,
  localStoreBundle,
  identityVault = DEFAULT_IDENTITY_VAULT_PATH,
  label = 'TasksMeshAgent',
  circleStates,
  agent: existingAgent,
  // The vault the grant managers use as their durable store. A SHARED agent (the basis composition)
  // carries no vault of its own, so without this the managers got `null` and warned "revocations are
  // MEMORY-ONLY" on every boot — on the phone too (W19). The caller hands the host's identity vault.
  vault: providedVault = null,
} = {}) {
  // Multi-circle runtime (2026-05-14, Tasks V2 sixth slice) — when a
  // pre-built `core.Agent` is supplied, reuse it instead of creating
  // a fresh one. The caller owns identity/transport/vault/policy/trust
  // wiring. Used by `bin/tasks-ui.js` to share one agent across N
  // circle bundles. Returns the same surface shape as the
  // build-from-scratch path.
  if (existingAgent) {
    return {
      meshAgent:     existingAgent,
      vault:         existingAgent.vault ?? providedVault ?? null,
      identity:      existingAgent.identity,
      identityVault,
      policyEngine:  existingAgent.policyEngine ?? null,
      trustRegistry: existingAgent.trustRegistry ?? null,
    };
  }

  // ── Vault + identity (vault-snapshot persistence) ────────────────────
  let vault;
  let id;
  let restoredFromSnapshot = false;
  const persistVault = !!(identityVault && localStoreBundle?.cache);
  if (persistVault && !identity) {
    try {
      const raw = await localStoreBundle.cache.read(identityVault);
      if (raw) {
        const snap = typeof raw === 'string' ? JSON.parse(raw) : raw;
        vault = VaultMemory.fromSnapshot(snap);
        id    = await AgentIdentity.restore(vault);
        restoredFromSnapshot = true;
      }
    } catch { /* fall through to generate */ }
  }
  if (!vault) {
    vault = new VaultMemory();
    id    = identity ?? await AgentIdentity.generate(vault);
  }

  // ── Transport ─────────────────────────────────────────────────────────────
  const tx = transport ?? new InternalTransport(new InternalBus(), id.pubKey);

  // ── TrustRegistry + self-trust (— required by PolicyEngine for
  //    self-issued cap-tokens to validate). Idempotent.
  const trustRegistry = new TrustRegistry(vault);
  await trustRegistry.setTier(id.pubKey, 'trusted');

  // ── Agent ────────────────────────────────────────────────────────────────
  const agent = new Agent({
    identity:       id,
    transport:      tx,
    label,
    trustRegistry,
  });

  // PolicyEngine wires SkillRegistry (already on agent.skills) + the
  // trust registry above. Same pattern as Circle.js — shadow the
  // read-only getter on the instance with an own property.
  //
  // ONE revocation resolver, composed HERE, because that is the only place a PolicyEngine will take
  // one. Each circle owns its own issuer-side revocation truth (task grants, bot cap-tokens); asking
  // ALL of them means a second circle can no longer disarm the first — which is what happened while
  // each source pushed itself in and the last writer won. A source that throws propagates, and
  // `checkInbound` turns that into a denial.
  const policyEngine = new PolicyEngine({
    trustRegistry,
    skillRegistry: agent.skills,
    agentPubKey:   id.pubKey,
    isRevoked: anyRevoked([
      typeof circleStates === 'function'
        ? async (tokenId) => {
          for (const cs of circleStates() ?? []) {
            if (await cs?.taskGrantManager?.isRevoked(tokenId)) return true;
            if (await cs?.botAgentRegistry?.isRevoked(tokenId)) return true;
          }
          return false;
        }
        : null,
    ]),
  });
  Object.defineProperty(agent, 'policyEngine', { value: policyEngine, configurable: true });

  // ── Persist vault snapshot on first boot ─────────────────────────────────
  if (persistVault && !restoredFromSnapshot) {
    try {
      await localStoreBundle.cache.write(identityVault, JSON.stringify(vault.snapshot()));
    } catch { /* persistence failure must not break boot */ }
  }

  return {
    meshAgent:     agent,
    vault,
    identity:      id,
    identityVault,
    policyEngine,
    trustRegistry,
  };
}

export { DEFAULT_IDENTITY_VAULT_PATH };
