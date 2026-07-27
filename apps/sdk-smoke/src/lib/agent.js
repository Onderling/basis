/**
 * createSmokeAgent — minimal SDK agent for the two-device smoke harness.
 *
 * Mirrors `apps/mesh-demo/src/agent.js`'s wiring (createMeshAgent +
 * KeychainVault, rendezvous off, sealed-forward / tunnel / oracle
 * enabled) but registers no chat skills.  Each scenario's `run()` is
 * what exercises the actual SDK call.
 *
 * The agent is created lazily by App.js on first scenario run, then
 * passed to every `run({ sdk })` call so scenarios share one identity
 * and one set of transports.  Constructed once per app session — to
 * reset, kill the app and relaunch.
 */
import {
  registerCapabilitiesSkill,
  registerTunnelReceiveSealed,
} from '@onderling/core';
import {
  createMeshAgent,
  KeychainVault,
} from '@onderling/react-native';

import {
  RELAY_URL,
  AGENT_LABEL,
  VAULT_SERVICE,
  PEER_GRAPH_PREFIX,
} from './config.js';

let _cached = null;
let _inFlight = null;

/**
 * Return the smoke agent, creating it on first call.  Subsequent calls
 * return the same instance (so two scenarios pressed in quick succession
 * don't construct two agents that fight for the same Keychain rows).
 */
export async function getSmokeAgent({ relayUrl = RELAY_URL } = {}) {
  if (_cached)   return _cached;
  if (_inFlight) return _inFlight;

  _inFlight = (async () => {
    const agent = await createMeshAgent({
      label: AGENT_LABEL,
      relayUrl,
      vault: new KeychainVault({ service: VAULT_SERVICE }),
      peerGraphPrefix: PEER_GRAPH_PREFIX,
      // Defer start() until any scenario-specific skill registration we
      // might add later runs — same pattern as mesh-demo so the first
      // hello-ack reflects the actual capabilities.
      autoStart: false,
      // Rendezvous OFF on phone — see CLAUDE.md "Decisions already made"
      // and apps/mesh-demo/src/agent.js for the full backstory.
      rendezvous: false,
    });

    agent.enableRelayForward({ policy: 'authenticated' });
    agent.enableAutoHello({ pullPeers: true });
    agent.startDiscovery({ gossipIntervalMs: 60_000 });

    // A demo mesh has no social graph to protect, so it opts into the OPEN scope explicitly. Since G7
  // (2026-07-27) the oracle discloses nothing unless a caller says what each peer may learn — a real app
  // passes a circle-aware scope here instead.
  agent.enableReachabilityOracle({ peerScope: (_caller, peers) => peers });
    registerCapabilitiesSkill(agent);
    agent.enableSealedForwardFor('mesh');
    agent.enableTunnelForward({ policy: 'authenticated' });
    registerTunnelReceiveSealed(agent);

    await agent.start();
    _cached = agent;
    return agent;
  })();

  try {
    return await _inFlight;
  } finally {
    _inFlight = null;
  }
}

/** Tear-down hook used by tests; production code never calls this. */
export function _resetSmokeAgent() { _cached = null; _inFlight = null; }
