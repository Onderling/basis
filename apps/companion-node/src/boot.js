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
 *   ── management ──
 *   The node is CLAIMED by its owner, never configured with one: started unclaimed it prints a claim code below,
 *   and the owner's app hands it back (a device statement; `src/ownerClaim.js`). The owner is kept in the config dir.
 *   COMPANION_MANAGE_HTTP_PORT     serve the online /manage web on this port
 *   COMPANION_MANAGE_HTTP_HOST     bind host (default 127.0.0.1; use 0.0.0.0 behind Caddy)
 *   COMPANION_FEEDS                on → the owner may put people's agenda files; a link opens them through the relay
 *                                  (`/feed/<node>/<id>.<k>.ics`, forwarded here as `feed.serve`) and, with the manage
 *                                  HTTP port, at this node's own `/feed/<id>.<k>.ics`
 *   COMPANION_PUBLIC_URL           the relay's public https address, for the card, when COMPANION_RELAY_URL is an inside
 *                                  name (`ws://relay:8787`); otherwise the card maps it from COMPANION_RELAY_URL
 *   ── the local radio (opt-in) ──
 *   COMPANION_NEARBY               same values as `--nearby` below; the flag wins when both are given
 *
 * Usage:
 *   node src/boot.js
 *   COMPANION_RELAY_URL=wss://relay.example PORT=8787 node src/boot.js
 *   node src/boot.js --nearby                        see the room, announce nothing
 *   node src/boot.js --nearby=publish:30m            …and announce for half an hour
 *   node src/boot.js --nearby=publish --nearby-label=laptop-companion
 *
 * The radio is OFF unless asked for: without it `bonjour-service` is never even imported. Grammar and
 * the reasoning behind browse-by-default: `src/nearbyFlag.js`.
 */
import { startCompanionNode } from './index.js';
import { parseNearbyFlag }     from './nearbyFlag.js';

const relayUrl = process.env.COMPANION_RELAY_URL || undefined;
const port     = process.env.PORT ? parseInt(process.env.PORT, 10) : 0;
const host     = process.env.HOST ?? '127.0.0.1';

// management is always there: an unclaimed node answers only the claim, a claimed one only its owner's devices
const management   = true;
const manageHttp   = process.env.COMPANION_MANAGE_HTTP_PORT
  ? parseInt(process.env.COMPANION_MANAGE_HTTP_PORT, 10)
  : false;
const manageHttpHost = process.env.COMPANION_MANAGE_HTTP_HOST ?? '127.0.0.1';
// a person's agenda as a link: the owner's sealed files, served through the relay (and the manage HTTP port when set)
const feeds = /^(1|on|true|yes)$/i.test(process.env.COMPANION_FEEDS ?? '');
const publicUrl = process.env.COMPANION_PUBLIC_URL || undefined;

// The local radio. A bad value stops the boot rather than starting a node whose radio is quietly off —
// "nobody is nearby" and "I never turned it on" look identical from the outside, which is the one
// failure this flag exists to prevent.
const { nearby, error: nearbyError } = parseNearbyFlag(process.argv.slice(2), process.env);
if (nearbyError) { console.error(`\n  ${nearbyError}\n`); process.exit(1); }

// the claim code goes to this log only — the person who can read the node's log is the one who may claim it
const node = await startCompanionNode({
  relayUrl, port, host, management, manageHttp, manageHttpHost, nearby, feeds, publicUrl,
  onClaimCode: (claim) => { console.log(`  Claim:        ${claim}  (valid 10 minutes — paste it in your app to become this node's owner)`); },
});

console.log('');
// what the node IS: its gate decides who may call it (a granted token, the owner's devices), so the banner says it
console.log(`  @onderling-app/companion-node  (gate ${node.gate ? 'on — calls need a token or the owner' : 'OFF — anyone on the relay may call it'})`);
console.log('  ────────────────────────────────────────────────────────────');
console.log(`  Host agent:   ${node.agent.address}`);
console.log(`  Relay:        ${node.relayUrl}${node.relay ? '  (booted in-process)' : '  (shared, connected as client)'}`);
console.log(`  Capabilities: ${node.capabilities.join(', ')}`);
console.log(`  Management:   ${node.managementOwnerRoot ? `claimed (owner root ${node.managementOwnerRoot.slice(0, 12)}…)` : 'unclaimed — waiting for its owner'}`);
if (node.manageUrl) console.log(`  Manage web:   ${node.manageUrl}  (owner-paired; front with Caddy /manage)`);
// this node as a contact (public: its address, its relay, where its links are served) — what its owner's app adds it by
console.log(`  Card:         ${node.card}`);
// What the radio is ACTUALLY doing, not what was asked for: `setDiscoverability` reports `degraded` when
// a transport ends up more exposed than requested, and a person needs to be told that in the banner
// rather than discover it from a packet capture.
if (node.nearby) {
  const st = node.nearby.state ?? {};
  const doing = st.effective ?? 'unknown';
  console.log(`  Nearby:       ${doing}${st.degraded ? '  ⚠ DEGRADED — more exposed than asked' : ''}`
    + `${st.reason ? `  (${st.reason})` : ''}`);
} else {
  console.log('  Nearby:       off  (--nearby to join the local room)');
}
console.log('');
console.log('  A device on the same relay can discover this host in the agent');
console.log('  registry and invoke its folio pod-file skills over the mesh.');
console.log('');

const shutdown = async () => { await node.stop(); process.exit(0); };
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
