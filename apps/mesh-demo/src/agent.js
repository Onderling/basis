/**
 * createAgent — mesh-chat agent factory.
 *
 * Everything "infrastructure" (transports, routing, BLE write queue,
 * OfflineTransport fallback, hello auto-upgrade of stale indirect records,
 * …) lives in `@onderling/react-native`'s `createMeshAgent`.  This file
 * only adds what is genuinely app-specific:
 *   • the `receive-message` skill, which pipes chat text into the store
 *   • the three opt-in SDK hooks this app wants enabled
 *
 * See EXTRACTION-PLAN.md §7 Group U for the full rewrite rationale.
 */
import {
  DataPart, TextPart, Parts, Task,
  registerCapabilitiesSkill,
  registerTunnelReceiveSealed,
} from '@onderling/core';
import {
  createMeshAgent,
  KeychainVault,
}                                  from '@onderling/react-native';
import { messageStore }            from './store/messages.js';
import { activityStore }           from './store/activity.js';

const shortPk = (pk) => typeof pk === 'string' ? pk.slice(0, 10) + '…' : '?';

export async function createAgent({ relayUrl } = {}) {
  const agent = await createMeshAgent({
    label:    'mesh-phone',
    relayUrl,
    vault:    new KeychainVault({ service: 'mesh-demo' }),
    peerGraphPrefix: 'mesh-demo:peers:',
    // Defer start() until we've registered this app's skills so the
    // capabilities snapshot sent in the first HI-ACK reflects relay /
    // tunnel / sealed-forward support.  Otherwise an inbound hello
    // arriving before agent.register(...) would bake tunnel:false into
    // the other peer's PeerGraph.
    autoStart: false,
    // Rendezvous is OFF on the phone for now.  react-native-webrtc
    // 124.0.7 still fails to register WebRTCModule under RN 0.76's
    // default bridgeless JS runtime (same "WebRTC native module not
    // found" / native SIGSEGV as 124.0.5 — PR 's TurboModule
    // fix covers RN 0.80+ but not 0.76's flavor of bridgeless).
    //
    // Re-enable when any of these unblock:
    //   • Upstream rn-webrtc publishes a release with RN 0.76-aware
    //     bridgeless support.
    //   • We adopt the GetStream fork that has the full bridgeless
    //     port upstream tried to cherry-pick from in.
    //   • We pin a React Native / Expo config that keeps bridgeless
    //     off on 0.76 (requires MainApplication override).
    //
    // History + fallbacks documented in CODING-PLAN.md § DD4.
    rendezvous: false,
  });

  // Opt-in SDK behaviour: gossip, hop routing via relay-forward, and
  // auto-hello on discovery.  See CODING-PLAN.md Groups N/R.
  agent.enableRelayForward({ policy: 'authenticated' });
  agent.enableAutoHello({ pullPeers: true });
  // 60 s gossip interval — 15 s was spammy, especially when Wi-Fi is off
  // and every round of `peer-list → <peer> via RelayTransport` fails
  // immediately with "Relay: not connected" before even attempting BLE.
  agent.startDiscovery({ gossipIntervalMs: 60_000 });

  // Oracle (Group T) — on-the-fly bridge selection when routing hop messages.
  // Capabilities skill (Group AA3) — peers can poll our current feature flags.
  // Sealed-forward (Group BB) — messages in the "mesh" group travel blind
  // through any relay bridge, so the bridge cannot read the payload.
  // Tunnel (Group CC) — this phone can act as a bridge for other peers'
  // streaming / IR / cancel calls AND can be the target of sealed tunnels.
  // A demo mesh has no social graph to protect, so it opts into the OPEN scope explicitly. Since G7
  // (2026-07-27) the oracle discloses nothing unless a caller says what each peer may learn — a real app
  // passes a circle-aware scope here instead.
  agent.enableReachabilityOracle({ peerScope: (_caller, peers) => peers });
  registerCapabilitiesSkill(agent);
  agent.enableSealedForwardFor('mesh');
  agent.enableTunnelForward({ policy: 'authenticated' });
  registerTunnelReceiveSealed(agent);

  // ── App-specific skills ────────────────────────────────────────────────────
  // receive-message pipes a text part into the message store, attributed
  // to the *original* caller (originFrom) when the message travelled
  // through a relay-forward hop.  originVerified is true when the message
  // carried a valid Ed25519 signature from the originator (Group Z), which
  // is the only way to trust originFrom across an untrusted bridge.
  agent.register('receive-message', async ({ parts, originFrom, from, originVerified }) => {
    const text   = Parts.text(parts) ?? JSON.stringify(Parts.data(parts));
    const sender = originFrom ?? from;
    messageStore.add(sender, {
      direction:      'in',
      text,
      originVerified: !!originVerified,
      relayedBy:      originFrom && originFrom !== from ? from : null,
    });
    return [DataPart({ ack: true })];
  }, { visibility: 'public', description: 'Receive a text message' });

  // A tiny streaming test skill for exercising Group CC tunnels from a
  // laptop browser tab (or another phone).  Yields `count` chunks, each
  // with the phrase + index.  Activity is mirrored to activityStore so
  // the PeersScreen can show "someone is streaming through / from us".
  agent.register('stream-demo', async function* ({ parts, from, originFrom }) {
    const d      = Parts.data(parts) ?? {};
    const text   = typeof d.text  === 'string' ? d.text  : 'hello from phone';
    const count  = Number.isFinite(d.count)    ? d.count : 3;
    const caller = originFrom ?? from;
    activityStore.add({
      kind:   'skill-call',
      label:  'stream-demo',
      caller: shortPk(caller),
      detail: `streaming ${count} chunk${count > 1 ? 's' : ''}`,
    });
    for (let i = 1; i <= count; i++) {
      yield [TextPart(`${text} [${i}/${count}]`)];
      await new Promise(r => setTimeout(r, 250));
      activityStore.add({
        kind:   'stream-chunk',
        label:  'stream-demo',
        caller: shortPk(caller),
        detail: `${i}/${count}`,
      });
    }
    activityStore.add({
      kind:   'stream-end',
      label:  'stream-demo',
      caller: shortPk(caller),
      detail: 'done',
    });
  }, { visibility: 'public', description: 'Stream a short demo message (CC test skill)' });

  // Input-required test skill.  First call throws InputRequired with a
  // prompt; when the caller replies via task.send(...), the handler
  // resumes with the reply's parts and returns a greeting.
  agent.register('ask-name', async ({ parts, from, originFrom }) => {
    const caller = originFrom ?? from;
    const text   = Parts.text(parts);
    if (!text || text === 'start') {
      activityStore.add({
        kind:   'ir-prompt',
        label:  'ask-name',
        caller: shortPk(caller),
        detail: 'prompt sent: What is your name?',
      });
      throw new Task.InputRequired([TextPart('What is your name?')]);
    }
    activityStore.add({
      kind:   'ir-reply',
      label:  'ask-name',
      caller: shortPk(caller),
      detail: `got reply: "${text}"`,
    });
    return [TextPart(`Hello, ${text}!`)];
  }, { visibility: 'public', description: 'Prompt the caller for a name and greet them (IR test skill)' });

  // All skills registered; NOW start the agent so the first HI-ACK
  // we send reports relay/tunnel/sealed-forward as `true`.
  await agent.start();

  return agent;
}
