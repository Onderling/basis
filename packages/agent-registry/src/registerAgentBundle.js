/**
 * registerAgentBundle — convenience helper for the typical bundle
 * bring-up flow: build a registry against the bundle's pseudoPod
 * and register the bundle's agent.
 *
 * Soft-fail by default: failures return `null` instead of throwing,
 * so bundle bring-up stays robust against transient pseudo-pod
 * issues. Re-registration is idempotent (CAS upsert keyed on
 * `agentId`).
 *
 * Standardisation Phase 52.10. Originally lived as a Pinboard-internal
 * helper (`apps/pinboard/src/substrateMirror.js#registerAgentInRegistry`);
 * lifted here 2026-05-14 so Tasks-v0 and other adopting apps can use
 * the same shape without a cross-app dependency on Pinboard.
 *
 * @param {object} args
 * @param {object} args.pseudoPod      — bundle's pseudoPod (write target)
 * @param {string} args.podDeviceId    — pseudoPod's URI authority (= `agent.address` in
 *                                       the typical `buildSubstrateStack`-style setup)
 * @param {object} args.agent          — the live `core.Agent` instance
 * @param {object} [args.opts]         — `{capabilities?, name?, role?, agentUri?, anchorPodUri?}`
 * @param {(err: Error) => void} [args.onError] — optional debug hook called on a soft-fail
 * @returns {Promise<object|null>} the live registry handle, or `null` on failure
 */
import { createAgentRegistry } from './AgentRegistry.js';

/**
 * Bring up an agent registry against a bundle's pseudo-pod and register the bundle's agent in it
 * (the module doc above details each field). Soft-fail: a thrown error returns `null` after the
 * optional `onError` hook, and a missing pubKey / `pseudoPod` / `podDeviceId` also returns `null`.
 * Re-registration is idempotent (CAS upsert keyed on `agentId`).
 * @param {object} args — `{ pseudoPod, podDeviceId, agent, opts?, onError? }`
 * @returns {Promise<object|null>} the live registry handle, or `null` on failure
 */
export async function registerAgentBundle({
  pseudoPod,
  podDeviceId,
  agent,
  opts = {},
  onError = null,
} = {}) {
  try {
    const pubKey = agent?.identity?.pubKey ?? agent?.address ?? null;
    if (!pubKey || !pseudoPod || !podDeviceId) return null;
    // The pseudoPod's local URI authority comes from `podDeviceId`.
    // The agent's *install-scoped* deviceId (Phase 33.1 UUIDv4) is what
    // the registry entry tracks as "which hardware install is this".
    const installDeviceId = agent?.identity?.deviceId ?? podDeviceId;
    const registry = createAgentRegistry({
      pseudoPod,
      deviceId:     podDeviceId,
      anchorPodUri: opts.anchorPodUri ?? null,
    });
    await registry.register({
      agentId:      pubKey,
      pubKey,
      agentUri:     opts.agentUri ?? `agent://${pubKey}`,
      role:         opts.role ?? 'device',
      deviceId:     installDeviceId,
      ...(typeof opts.name === 'string' ? { name: opts.name } : {}),
      capabilities: Array.isArray(opts.capabilities) ? opts.capabilities : [],
    });
    return registry;
  } catch (err) {
    if (typeof onError === 'function') {
      try { onError(err); } catch { /* swallow */ }
    }
    return null;
  }
}
