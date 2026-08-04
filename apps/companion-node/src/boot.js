#!/usr/bin/env node
/**
 * companion-node — CLI boot (the 1-file boot precedent, mirroring
 * `packages/relay/bin/relay.js`).
 *
 * Reads options from env vars:
 *   COMPANION_RELAY_URL        connect to a shared relay (else boot local)
 *   PORT                       local-relay port (default 0 ⇒ OS-assigned)
 *   HOST                       local-relay bind host (default 127.0.0.1)
 *   COMPANION_NODE_CONFIG_DIR  where the host keypair is persisted
 *   ── 6d management surface (opt-in) ──
 *   COMPANION_MANAGE_OWNER_PUBKEY  the owner's device pubKey → enables management
 *                                  (the ONLY key allowed to manage). Absent ⇒ OFF.
 *   COMPANION_MANAGE_HTTP_PORT     serve the online /manage web on this port
 *   COMPANION_MANAGE_HTTP_HOST     bind host (default 127.0.0.1; use 0.0.0.0 behind Caddy)
 *
 * Usage:
 *   node src/boot.js
 *   COMPANION_RELAY_URL=wss://relay.example PORT=8787 node src/boot.js
 */
import { startCompanionNode } from './index.js';

const relayUrl = process.env.COMPANION_RELAY_URL || undefined;
const port     = process.env.PORT ? parseInt(process.env.PORT, 10) : 0;
const host     = process.env.HOST ?? '127.0.0.1';

// 6d — management is opt-in: ON only when an owner pubKey is provided.
const managementOwnerPubKey = process.env.COMPANION_MANAGE_OWNER_PUBKEY || undefined;
const management   = !!managementOwnerPubKey;
const manageHttp   = management && process.env.COMPANION_MANAGE_HTTP_PORT
  ? parseInt(process.env.COMPANION_MANAGE_HTTP_PORT, 10)
  : false;
const manageHttpHost = process.env.COMPANION_MANAGE_HTTP_HOST ?? '127.0.0.1';

const node = await startCompanionNode({ relayUrl, port, host, management, managementOwnerPubKey, manageHttp, manageHttpHost });

console.log('');
console.log('  @onderling-app/companion-node  (Slice R1 — LAN/trusted, no gate)');
console.log('  ────────────────────────────────────────────────────────────');
console.log(`  Host agent:   ${node.agent.address}`);
console.log(`  Relay:        ${node.relayUrl}${node.relay ? '  (booted in-process)' : '  (shared, connected as client)'}`);
console.log(`  Capabilities: ${node.capabilities.join(', ')}`);
console.log(`  Management:   ${node.management ? `on (owner ${node.managementOwnerPubKey?.slice(0, 12)}…)` : 'off'}`);
if (node.manageUrl) console.log(`  Manage web:   ${node.manageUrl}  (owner-paired; front with Caddy /manage)`);
console.log('');
console.log('  A device on the same relay can discover this host in the agent');
console.log('  registry and invoke its folio pod-file skills over the mesh.');
console.log('');

const shutdown = async () => { await node.stop(); process.exit(0); };
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
