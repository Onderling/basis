#!/usr/bin/env node
/**
 * H5 V0 web UI launcher.
 *
 * Single-group mode (Phase 7 step 1):
 *   node bin/stoop-ui.js \
 *     --actor   https://id.example/anne \
 *     --group   block-42 \
 *     [--port    8080] \
 *     [--relay   ws://<LAN-IP>:8787]   ← cross-device (web ⇄ phone) \
 *     [--peers   <pubkey>,<pubkey>,...] \
 *     [--skills  paint,ladder] \
 *     [--posture paint=always,ladder=negotiable]
 *
 * Multi-group mode (Phase 7 step 2 — group switcher):
 *   node bin/stoop-ui.js \
 *     --actor   https://id.example/anne \
 *     --groups  block-42,book-club,workplace \
 *     [--port    8080] \
 *     [--relay   ws://<LAN-IP>:8787]
 *
 * `--relay` attaches a `RelayTransport` (in addition to the in-process
 * `InternalTransport`) so this web instance can reach phones / other
 * machines through a relay started with `node start-relay.js`. Point
 * the phone's Settings → Relay-server at the SAME ws:// URL. Without
 * `--relay` the web launcher is in-process only (no cross-device).
 *
 * In multi-group mode the launcher:
 *   - Generates one shared `AgentIdentity` and uses it across all groups.
 *   - Spins up one `core.Agent` + `mountLocalUi` per group on consecutive
 *     ports (start = `--port`, default OS-assigned).
 *   - Surfaces `groups.json` as an in-memory virtual file at every
 *     instance so the UI's group dropdown can navigate between them.
 */
import { parseArgs } from 'node:util';
import { AgentIdentity, InternalBus, InternalTransport, Agent, RoutingStrategy, FallbackTable, PeerGraph } from '@onderling/core';
import { RelayTransport } from '@onderling/transports';
import { VaultNodeFs } from '@onderling/vault';
import { mountLocalUi, LocalUiAuth } from '@onderling/agent-ui';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { mkdir } from 'node:fs/promises';

const { values } = parseArgs({
  options: {
    actor:   { type: 'string' },
    group:   { type: 'string' },
    groups:  { type: 'string' },
    port:    { type: 'string' },
    relay:   { type: 'string' },
    peers:   { type: 'string' },
    skills:  { type: 'string' },
    posture: { type: 'string' },
  },
});

if (!values.actor) {
  console.error('--actor <webid> is required');
  process.exit(2);
}
if (!values.group && !values.groups) {
  console.error('--group <gid> (single-group) or --groups <gid1,gid2,...> (multi-group) is required');
  process.exit(2);
}
if (values.group && values.groups) {
  console.error('--group and --groups are mutually exclusive');
  process.exit(2);
}

const isMultiGroup = !!values.groups;
const basePort = Number(values.port ?? 0);
const peers = (values.peers ? values.peers.split(',').map(s => s.trim()).filter(Boolean) : [])
  .map((pubKey) => ({ pubKey }));
const skills = values.skills  ? values.skills.split(',').map(s => s.trim()).filter(Boolean) : [];
const posture = values.posture
  ? Object.fromEntries(values.posture.split(',').map(p => p.split('=').map(s => s.trim())))
  : {};

const relayUrl = values.relay ? values.relay.trim() : null;
if (relayUrl && !/^wss?:\/\//.test(relayUrl)) {
  console.error('--relay must be a ws:// or wss:// URL (e.g. ws://192.168.1.7:8787)');
  process.exit(2);
}

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

// Persistent identity, keyed by --actor: a STABLE pubKey across
// `npm run ui` restarts. (Was `VaultMemory` = a fresh key every
// launch, which broke cross-device — the phone's peer state kept
// pointing at dead web identities.) Still one identity shared across
// all groups (the "one identity, many groups" V0 model).
const _idSlug  = createHash('sha256').update(values.actor).digest('hex').slice(0, 16);
const _idDir   = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'stoop');
await mkdir(_idDir, { recursive: true });
const _idVault = new VaultNodeFs(join(_idDir, `${_idSlug}.vault.json`));
const id = (await _idVault.get('agent-privkey'))
  ? await AgentIdentity.restore(_idVault)
  : await AgentIdentity.generate(_idVault);

if (isMultiGroup) {
  const { createNeighbourhoodCluster } = await import('../src/cluster.js');
  const groupIds = values.groups.split(',').map(s => s.trim()).filter(Boolean);
  if (peers.length || skills.length || Object.keys(posture).length) {
    console.error('--peers / --skills / --posture are single-group flags; configure each group separately for multi-group runs (V0 launcher).');
    process.exit(2);
  }

  const bus = new InternalBus();
  const cluster = await createNeighbourhoodCluster({
    identity: id,
    bus,
    groups:   groupIds.map((gid) => ({ groupId: gid, localActor: values.actor })),
  });
  for (const b of cluster.groups.values()) await b.offeringMatch.start();
  // Cross-device transport for every group agent (parity with mobile).
  if (relayUrl) {
    for (const b of cluster.groups.values()) {
      b.agent.addTransport('relay', new RelayTransport({ relayUrl, identity: id }));
    }
  }

  // Shared mutable extraStaticFiles map — same object reference is
  // passed into every mountLocalUi, so updating `/groups.json` after
  // all ports are known propagates to all instances on the next read.
  const sharedExtras = { '/groups.json': '[]' };

  const uis = new Map();
  let nextPort = basePort;
  for (const [gid, bundle] of cluster.groups) {
    const ui = await mountLocalUi(bundle.agent, {
      port:             nextPort,
      staticDir:        webDir,
      a2aTLSLayer:      new LocalUiAuth({ localActor: values.actor }),
      extraStaticFiles: sharedExtras,
    });
    uis.set(gid, ui);
    if (basePort > 0) nextPort = basePort + uis.size;
    // Otherwise let the OS pick a free port for each.
  }

  const groupIndex = [...uis.entries()].map(([groupId, ui]) => ({
    groupId,
    url: ui.url,
  }));
  sharedExtras['/groups.json'] = JSON.stringify(groupIndex);

  console.log('H5 multi-group UI ready:');
  console.log(`  identity: ${id.pubKey}`);
  console.log(`  relay:    ${relayUrl ?? '(none — in-process only)'}`);
  for (const { groupId, url } of groupIndex) {
    console.log(`  ${groupId.padEnd(20)} ${url}`);
  }

  process.on('SIGINT',  shutdownAll);
  process.on('SIGTERM', shutdownAll);
  async function shutdownAll() {
    console.log('\nShutting down…');
    for (const ui of uis.values()) await ui.stop();
    process.exit(0);
  }
} else {
  const { createNeighbourhoodAgent } = await import('../src/index.js');
  const bus = new InternalBus();
  // Build the agent WITH a RoutingStrategy (mirrors @onderling/react-native
  // createMeshAgent). Root cause of "web never HIs the phone over the
  // relay": without routing, Agent.transportFor() returns the
  // in-process transport for EVERY peer (relay never selected), so
  // hello()/sends to the phone went into the void and timed out.
  const _peerGraph = new PeerGraph();
  const _meshAgent = new Agent({
    identity:  id,
    transport: new InternalTransport(bus, id.pubKey),
    peers:     _peerGraph,
    routing:   new RoutingStrategy({ transports: new Map(), peerGraph: _peerGraph, fallbackTable: new FallbackTable() }),
    label:     `H5-${values.actor}`,
  });
  const bundle = await createNeighbourhoodAgent({
    identity:  id,
    agent:     _meshAgent,
    label:     `H5-${values.actor}`,
    offeringMatch: {
      group:      values.group,
      localActor: values.actor,
      peers,
      skills,
      posture,
    },
  });
  // Single-member: nothing to addPeer; multi-member callers wire that
  // before invoking this script. OfferingMatch.start() is fine without peers.
  await bundle.offeringMatch.start();

  // Cross-device parity with stoop-mobile. The single-group launcher
  // was single-member with NO substrate mirror, so postRequest's
  // fan-out had an empty recipient set and nothing crossed. Attach
  // the mirror so it HAS a recipient set to fill.
  const { attachSubstrateMirror } = await import('../src/substrateMirror.js');
  await attachSubstrateMirror(bundle, { group: values.group, peers });

  // Cross-device transport (web ⇄ phone) — parity with mobile, which
  // attaches a RelayTransport the same way (agentBundle.js). Without
  // this the web launcher is in-process only.
  if (relayUrl) {
    const relay = new RelayTransport({ relayUrl, identity: id });
    bundle.agent.addTransport('relay', relay);
    // Feed relay-discovered peers into the PeerGraph so
    // RoutingStrategy.selectTransport resolves them to the relay
    // (mirrors stoop-mobile agentBundle.js). enableAutoHello (below)
    // listens on the same peer-discovered and HIs them.
    relay.on('peer-discovered', (pk) => {
      if (!pk || typeof pk !== 'string' || pk === id.pubKey || pk.includes(':')) return;
      _peerGraph.upsert({ pubKey: pk, type: 'native', reachable: true }).catch(() => {});
    });
    // RelayTransport has no 'connect' event and the relay's spontaneous
    // peer-list broadcast is easily missed (web registers before the
    // phone; socket flaps). Periodically re-request the roster:
    // forgetPeer() sends {type:'peer-list'} when the socket is open
    // (no-op otherwise; '\0' drops no real peer) → relay re-emits
    // peer-discovered. Also covers the phone joining late / reconnecting.
    const _pullRoster = () => { try { relay.forgetPeer('\0'); } catch { /* socket not up yet */ } };
    setTimeout(_pullRoster, 2_000).unref?.();
    setInterval(_pullRoster, 10_000).unref?.();
  }

  // Auto-HI on discovery (routes over the relay now that the agent has
  // a RoutingStrategy), then bridge a hello'd peer into offeringMatch +
  // the mirror's recipient set so postRequest's fan-out reaches it —
  // the stoop-mobile pattern (agentBundle.js).
  bundle.agent.enableAutoHello?.({ pullPeers: true });
  bundle.agent.on('peer', ({ address, pubKey }) => {
    const pk = pubKey ?? address;
    if (!pk || typeof pk !== 'string' || pk.includes(':') || pk === bundle.agent.address) return;
    try { bundle.offeringMatch?.addPeer?.({ pubKey: pk }); } catch { /* best effort */ }
    bundle.mirror?.addPeer?.(pk)?.catch?.(() => { /* swallow — already added */ });
  });

  // One entry: the switcher dropdown still hides (mountGroupSwitcher
  // hides at length<=1) but the client now KNOWS the active group —
  // so the header shows it and the "Groep" nav link auto-resolves
  // (no manual ?id=). Closes the "which group am I in?" web gap.
  const groupIndexJson = JSON.stringify([{ groupId: values.group }]);

  const ui = await mountLocalUi(bundle.agent, {
    port:             basePort,
    staticDir:        webDir,
    a2aTLSLayer:      new LocalUiAuth({ localActor: values.actor }),
    extraStaticFiles: { '/groups.json': groupIndexJson },
  });

  console.log(`H5 UI ready at ${ui.url}`);
  console.log(`  actor:  ${values.actor}`);
  console.log(`  group:  ${values.group}`);
  console.log(`  pubKey: ${id.pubKey}`);
  if (skills.length)               console.log(`  skills: ${skills.join(', ')}`);
  if (Object.keys(posture).length) console.log(`  posture: ${JSON.stringify(posture)}`);
  console.log(`  peers:  ${peers.length} configured`);
  console.log(`  relay:  ${relayUrl ?? '(none — in-process only)'}`);

  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);
  async function shutdown() {
    console.log('\nShutting down…');
    await ui.stop();
    process.exit(0);
  }
}
