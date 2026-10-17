/**
 * provisionAgent — compose an Agent + the standardisation substrates in
 * a single call.
 *
 * This is the **facade** that the strict layering keeps out of core.
 * Apps import this and get a working agent with the right opaque slots
 * (webid, pseudoPod, agentRegistry) populated by the available
 * substrates.
 *
 * What it does:
 *   1. Pick / generate a 24-word mnemonic.
 *   2. Pick a Vault (caller-supplied, or VaultMemory by default).
 *   3. Reconstitute / generate the AgentIdentity (deterministic from
 *      the mnemonic via core's `AgentIdentity.fromMnemonic`).
 *   4. (Optional, pod-having) Construct a SolidVault OIDC session.
 *   5. (Optional, pod-having) Construct a WebIdCache and refresh it
 *      against the user's pod (via the OIDC-authenticated fetch).
 *   6. Build the Agent, populating its opaque slots:
 *        - agent.webid          ← WebIdCache (or null)
 *        - agent.pseudoPod      ← caller-supplied or null
 *        - agent.agentRegistry  ← caller-supplied or null
 *   7. Start the agent and return it.
 *
 * Substrates not yet built (pseudo-pod, agent-registry, pod-onboarding)
 * are accepted as **opaque pre-constructed objects** the caller passes
 * in.  When they're available as proper substrates, the facade gains
 * the ability to construct them too.
 *
 * Apps that want bespoke shapes (Folio's CLI auth, Pinboard's relay
 * choice, Tasks's single-agent topology) keep composing
 * substrates manually — every substrate stands alone.  This facade
 * is the **canonical path**, not the only path.
 */

import {
  Agent,
  AgentIdentity,
} from '@onderling/core';
import { VaultMemory }    from '@onderling/vault';
import { SolidVault }     from '@onderling/oidc-session';
import { WebIdCache }     from '@onderling/webid-discovery';

/**
 * @typedef {object} OidcOpts
 * @property {string} webid          — the user's WebID URI
 * @property {string} oidcIssuer     — OIDC issuer URL
 * @property {string} clientId
 * @property {string} clientSecret
 * @property {string} [refreshToken] — skips full login when supplied
 */

/**
 * @typedef {object} ProvisionAgentOpts
 *
 * @property {string}   [mnemonic]   — restore from a 24-word phrase; omit to generate a fresh one
 * @property {object}   [vault]      — Vault-shaped store; defaults to a new VaultMemory()
 * @property {object}   transport    — required: a Transport-shaped object (caller constructs)
 * @property {OidcOpts} [oidc]       — pod-having mode; constructs a SolidVault
 * @property {string}   [vaultNamespace] — key prefix inside the Vault for identity blobs
 * @property {object}   [pseudoPod]      — pre-constructed pseudo-pod substrate; populates agent.pseudoPod
 * @property {object}   [agentRegistry]  — pre-constructed agent-registry substrate
 * @property {boolean}  [autoStart=true] — call agent.start() before returning
 * @property {number}   [webidHeartbeatMs=60000] — heartbeat for WebID-discovery cache
 * @property {Array}    [skills=[]]     — skills to pre-register on the Agent
 * @property {object}   [agentOpts={}]  — pass-through to Agent constructor (security, policyEngine, etc.)
 *
 * @typedef {object} ProvisionAgentResult
 * @property {import('@onderling/core').Agent}      agent
 * @property {import('@onderling/core').AgentIdentity} identity
 * @property {object}                              vault       — the vault used
 * @property {string}                              mnemonic    — the BIP-39 phrase (fresh or echoed)
 * @property {object|null}                         oidc        — the SolidVault session (or null)
 * @property {object|null}                         webid       — the WebIdCache (or null)
 */

/**
 * @param   {ProvisionAgentOpts} opts
 * @returns {Promise<ProvisionAgentResult>}
 */
export async function provisionAgent(opts = {}) {
  const {
    mnemonic: providedMnemonic,
    vault: providedVault,
    transport,
    oidc: oidcOpts,
    pseudoPod = null,
    agentRegistry = null,
    autoStart = true,
    webidHeartbeatMs = 60_000,
    skills = [],
    agentOpts = {},
  } = opts;

  if (!transport) {
    throw Object.assign(
      new Error('provisionAgent: `transport` is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  // 1. Vault.
  const vault = providedVault ?? new VaultMemory();

  // 2. Identity.  Either restore from mnemonic, or generate fresh.
  let identity;
  let mnemonic;
  if (providedMnemonic) {
    identity = await AgentIdentity.fromMnemonic(providedMnemonic, vault);
    mnemonic = providedMnemonic;
  } else {
    identity = await AgentIdentity.generate(vault);
    // AgentIdentity.generate doesn't expose the mnemonic directly because
    // it derives from random bytes; the caller of provisionAgent gets
    // null here (recovery requires a fresh provision with mnemonic
    // captured at first run from the higher layer).
    mnemonic = null;
  }

  // 3. OIDC session (optional, pod-having mode).
  let oidc = null;
  if (oidcOpts) {
    oidc = new SolidVault({
      webid:       oidcOpts.webid,
      oidcIssuer:  oidcOpts.oidcIssuer,
      vault,
    });
    await oidc.login({
      clientId:     oidcOpts.clientId,
      clientSecret: oidcOpts.clientSecret,
      ...(oidcOpts.refreshToken ? { refreshToken: oidcOpts.refreshToken } : {}),
    });
  }

  // 4. WebID-discovery cache (optional; requires an OIDC-authenticated
  //    fetch to read the user's profile).
  let webid = null;
  if (oidc && oidcOpts?.webid) {
    webid = new WebIdCache({
      webid:        oidcOpts.webid,
      fetch:        oidc.getAuthenticatedFetch(),
      read:         pseudoPod && typeof pseudoPod.read === 'function'
                      ? pseudoPod.read.bind(pseudoPod)
                      : undefined,
      heartbeatMs:  webidHeartbeatMs,
    });
    // Best-effort initial refresh; failures don't block bring-up.
    try { await webid.refresh(); } catch { /* offline-tolerant */ }
  }

  // 5. Construct the Agent with opaque slots populated.
  const agent = new Agent({
    identity,
    transport,
    skills,
    ...agentOpts,
    webid,
    pseudoPod,
    agentRegistry,
  });

  if (autoStart) {
    await agent.start();
  }

  return { agent, identity, vault, mnemonic, oidc, webid };
}
