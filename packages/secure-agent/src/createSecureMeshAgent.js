/**
 * createSecureMeshAgent — the UNIFIED secure-mesh factory (T5.3, OBJ-1 option iii).
 *
 * The convergence of the two stacks: `createSecureAgent` (security layer + the unified
 * RoutingStrategy + the transport seams, T5.1/T5.2) PLUS the multi-transport mesh, in ONE
 * agent. It stays PLATFORM-NEUTRAL: the RN-specific transport BUILDING (MdnsTransport /
 * BleTransport, which need native modules) is done by the caller and INJECTED here via
 * `transports`, so this file has no react-native dependency. The web app injects nothing
 * extra (it gets nkn/relay via `sa.peer`/`sa.relay` + WebRTC rendezvous); the RN app builds
 * mdns/ble and passes them in.
 *
 * Every injected transport flows through `sa.addSecureTransport` — security-wrapped
 * (makeReceiveHandler) + registered on the unified router — so the router picks the best
 * reachable route per peer across ALL of them (mdns > rendezvous > relay > nkn …).
 *
 *   // web:
 *   const sa = await createSecureMeshAgent({ vault });
 *   await sa.peer.connect({ nknLib }); await sa.relay.connect({ relayUrl });
 *   await sa.enableSecureRendezvous();           // direct WebRTC over the signalling transport
 *
 *   // React Native (transport BUILDING injected — keeps this factory platform-neutral):
 *   import { MdnsTransport, BleTransport } from '@onderling/react-native';
 *   const sa = await createSecureMeshAgent({
 *     vault,
 *     transports: { mdns: new MdnsTransport({ identity }), ble: new BleTransport({ identity }) },
 *   });
 *
 * This is the destination; consumers (basis realAgent, basis-mobile, pinboard-mobile)
 * migrate onto it (T5.3b), after which `createMeshAgent`'s bespoke router/transport wiring is
 * deleted in favour of this (T5.3c).
 */

import { createSecureAgent } from './createSecureAgent.js';

/**
 * @param {object} [opts]
 * @param {Object<string, object>} [opts.transports]  name→already-built Transport to inject
 *   (e.g. `{ mdns, ble }`). Each is security-wrapped + router-registered via addSecureTransport.
 *   nkn/relay are NOT passed here — connect them on the returned `sa.peer`/`sa.relay`.
 * @param {(name:string, err:Error)=>void} [opts.onTransportError]  per-transport inject-failure hook
 *   (default: console.warn). A failing transport never aborts the agent.
 *   …plus every `createSecureAgent` opt (vault, nknLib, relayUrl, transportMode, …).
 * @returns {Promise<object>} the secure-agent surface (sa), with all injected transports live on the router.
 */
export async function createSecureMeshAgent({ transports = {}, onTransportError, ...secureOpts } = {}) {
  const sa = await createSecureAgent(secureOpts);

  const warn = typeof onTransportError === 'function'
    ? onTransportError
    : (name, err) => { if (typeof console !== 'undefined') console.warn(`[secure-mesh] ${name} inject failed (continuing):`, err?.message ?? err); };

  // Inject each caller-provided transport — security-wrapped + on the unified router.
  // One transport's failure (e.g. BLE permission denied) never blocks the others or the agent.
  for (const [name, tx] of Object.entries(transports)) {
    if (!tx) continue;
    try { await sa.addSecureTransport(name, tx); }
    catch (err) { warn(name, err); }
  }

  return sa;
}
