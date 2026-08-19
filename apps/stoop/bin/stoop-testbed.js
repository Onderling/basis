#!/usr/bin/env node
/**
 * H5 multi-user testbed — Phase 7 hands-on harness.
 *
 * Boots one admin + N members in a single Node process over a shared
 * `InternalBus`, mounts each on its own `mountLocalUi` port, and prints a
 * landing index so a tester can open every member's UI in a separate
 * browser tab. Onboarding flow is wired: the admin's UI exposes
 * `issueInvite` / `redeemInvite` skills; redemption spawns a fresh
 * in-process agent + UI for the new member.
 *
 * Usage:
 *   node bin/stoop-testbed.js \
 *     --admin    https://id.example/admin \
 *     [--group   block-42] \
 *     [--members https://id.example/anne,https://id.example/bob] \
 *     [--port    8100]
 *
 * Defaults to `--group block-42` and a single admin (no pre-seeded members).
 * The launcher prints all URLs on startup and a "landing index"
 * (http://127.0.0.1:<base>/.well-known/stoop-testbed.json) summarising the
 * cluster.
 *
 * V0 trade-offs:
 *   - Single process, shared InternalBus → no relay needed for testing.
 *     For real-network testing, swap InternalTransport for RelayTransport.
 *   - Ephemeral keypairs per member (V1+: mnemonic restore).
 *   - In-memory MemberMap (V1+: pod-config-backed via fromPodConfig).
 */
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AgentIdentity, InternalBus, InternalTransport, GroupManager } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { mountLocalUi, LocalUiAuth } from '@onderling/agent-ui';

import { createNeighborhoodAgent }   from '../src/Agent.js';
import { buildOnboardingSkills }     from '../src/onboarding.js';
import { wireSubstrateMirror }       from '../src/substrateMirror.js';
import { buildSubstrateStack }       from '../src/lib/substrateStack.js';

const { values } = parseArgs({
  options: {
    admin:   { type: 'string' },
    group:   { type: 'string' },
    members: { type: 'string' },
    port:    { type: 'string' },
  },
});

if (!values.admin) {
  console.error('--admin <webid> is required');
  process.exit(2);
}

const groupId    = values.group ?? 'block-42';
const basePort   = Number(values.port ?? 0);
const seedActors = values.members
  ? values.members.split(',').map(s => s.trim()).filter(Boolean)
  : [];

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

// Shared bus across every agent in the cluster — every send hits the
// in-memory pubsub; no relay needed for hands-on browser testing.
const bus = new InternalBus();

/**
 * Cluster registry — populated as the testbed boots admin + seed
 * members + spawns members on invite redemption.
 *   Map<webid, { agent, ui, identity, role, displayName }>
 */
const cluster = new Map();

/**
 * Cross-register peer pubkeys at every existing agent's SecurityLayer.
 * Idempotent — `addPeer` is safe to call repeatedly with the same pubKey.
 * Run after every spawn so old members can reach the new one and vice versa.
 */
function crossRegister() {
  for (const [, a] of cluster) {
    for (const [, b] of cluster) {
      if (a === b) continue;
      a.agent.addPeer(b.identity.pubKey, b.identity.pubKey);
    }
  }
}

/**
 * Bring a member's agent + UI online. Used for admin (role 'admin') and
 * for every redeemed-invite member (role 'member' by default).
 */
async function spawnAgent({ webid, role, displayName }) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const transport = new InternalTransport(bus, id.pubKey);

  // The cluster's existing pubkeys go in as peers up-front; the
  // crossRegister() pass below propagates THIS new agent back.
  const peers = [...cluster.values()].map((m) => ({ pubKey: m.identity.pubKey }));

  const bundle = await createNeighborhoodAgent({
    identity:  id,
    transport,
    label:     `H5-${webid}`,
    members:   [...cluster.values()].map((m) => ({
      webid:       m.webid,
      displayName: m.displayName,
      role:        m.role,
      pubKey:      m.identity.pubKey,
    })),
    offeringMatch: { group: groupId, localActor: webid, peers },
  });

  // Determine port for this UI. If user passed --port N, allocate
  // contiguously from there; otherwise let the OS pick.
  const port = basePort > 0 ? basePort + cluster.size : 0;

  const ui = await mountLocalUi(bundle.agent, {
    port,
    staticDir:        webDir,
    a2aTLSLayer:      new LocalUiAuth({ localActor: webid }),
    extraStaticFiles: clusterIndexExtras,
  });

  cluster.set(webid, {
    agent:       bundle.agent,
    bundle,
    ui,
    identity:    id,
    role,
    displayName,
    webid,
    mirror:      null,    // wired below, after SecurityLayer cross-register
  });

  // Now that the new agent's pubKey is in `cluster`:
  //   1. Cross-register at the SecurityLayer so envelopes can flow.
  //      MUST happen before any subscribe() call — pubsub subscribe
  //      sends an OW envelope that SecurityLayer encrypts, which requires
  //      the recipient pubKey to be registered.
  //   2. Wire the new agent's group-broadcast mirror over the now-known
  //      peer set. The mirror writes inbound requests from any peer into
  //      THIS agent's itemStore, so the H5 web UI's "Open in the group"
  //      list shows them — independent of OfferingMatch's matchmaking
  //      filter (which silently drops requests whose `requiredSkills`
  //      don't intersect the local profile).
  //   3. Tell every PRE-EXISTING OfferingMatch + group-mirror about the
  //      new arrival, and push the metadata into every member's
  //      MemberMap so `resolveMember` round-trips work cluster-wide.
  //   4. Start the new OfferingMatch (subscribes to existing peers'
  //      `<group>/requests` topics for the matchmaking path).
  crossRegister();

  const peerPubKeys = peers.map((p) => p.pubKey);
  // Phase 52.9.2 / Q-B (2026-05-14) — substrate path.
  const substrate = buildSubstrateStack({ agent: bundle.agent });
  bundle.pseudoPod         = substrate.pseudoPod;
  bundle.notifyEnvelope    = substrate.notifyEnvelope;
  bundle.substrateDeviceId = substrate.deviceId;
  bundle._substrateStop    = substrate.stop;
  const mirror = await wireSubstrateMirror({
    itemStore:      bundle.itemStore,
    notifyEnvelope: substrate.notifyEnvelope,
    pseudoPod:      substrate.pseudoPod,
    group:          groupId,
    peers:          peerPubKeys.map((pubKey) => ({ pubKey })),
    selfPubKey:     bundle.agent?.address ?? null,
  });
  cluster.get(webid).mirror = mirror;

  for (const [otherWebid, m] of cluster) {
    if (otherWebid === webid) continue;
    m.bundle.offeringMatch.addPeer({ pubKey: id.pubKey });
    await m.mirror.addPeer(id.pubKey);
    await m.bundle.members.addMember({
      webid, displayName, role, pubKey: id.pubKey,
    });
    // Backfill: pull the existing peer's open items into the new
    // member's mirror so a member who joins AFTER the admin already
    // posted things still sees them on the noticeboard.  pubsub itself
    // doesn't replay; without this the noticeboard is asymmetric.
    try {
      const existing = await m.bundle.itemStore.listOpen();
      await mirror.backfillFrom(m.identity.pubKey, existing);
    } catch { /* best-effort */ }
  }
  await bundle.offeringMatch.start();

  return { webid, role, url: ui.url, pubKey: id.pubKey };
}

// Shared `extraStaticFiles` for the cluster — every UI sees the same
// landing index + groups list. Mutated below as members spawn.
const clusterIndexExtras = {
  '/.well-known/stoop-testbed.json': '{}',
};

function refreshClusterIndex() {
  const summary = {
    groupId,
    members: [...cluster.values()].map((m) => ({
      webid:       m.webid,
      displayName: m.displayName,
      role:        m.role,
      url:         m.ui.url,
      pubKey:      m.identity.pubKey,
    })),
  };
  clusterIndexExtras['/.well-known/stoop-testbed.json'] = JSON.stringify(summary);
  // The landing-page HTML is also content-only (no skill calls), so we
  // synthesise it server-side and serve it at /testbed.
  clusterIndexExtras['/testbed.html'] = renderLandingHtml(summary);
}

function renderLandingHtml({ groupId, members }) {
  const rows = members.map((m) => `
    <tr>
      <td><a href="${escapeAttr(m.url)}/" target="_blank">${escapeHtml(m.displayName)}</a></td>
      <td><code>${escapeHtml(m.role)}</code></td>
      <td><code>${escapeHtml(m.webid)}</code></td>
      <td><code>${escapeHtml(m.pubKey.slice(0, 16))}…</code></td>
    </tr>`).join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>H5 testbed — ${escapeHtml(groupId)}</title>
<link rel="stylesheet" href="/style.css">
<style>
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 0.4rem 0.6rem; text-align: left; border-bottom: 1px solid var(--border); font-size: 0.9rem; }
  th { background: var(--bg); font-weight: 500; color: var(--muted); }
  a { color: var(--accent); }
  code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.82rem; color: var(--muted); }
</style>
</head><body>
<header><nav><a href="/testbed.html" class="active">Testbed</a> <a href="/">Open requests</a> <a href="/mine.html">Mine</a></nav></header>
<main>
<section>
<h2>Group: ${escapeHtml(groupId)}</h2>
<p>${members.length} agent${members.length === 1 ? '' : 's'} online — open each link in a separate browser tab to test multi-user flows.</p>
<table>
  <thead><tr><th>Display</th><th>Role</th><th>WebID</th><th>PubKey</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<p><a href="/onboard.html">→ Issue an invite (admin only)</a></p>
</section>
</main>
</body></html>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }

// ── Boot the admin ─────────────────────────────────────────────────────────

const adminEntry = await spawnAgent({
  webid:       values.admin,
  role:        'admin',
  displayName: values.admin.split('/').pop() || values.admin,
});

// Group manager owns the admin identity for issuing/redeeming invites.
const groupManager = new GroupManager({
  identity: cluster.get(values.admin).identity,
  vault:    new VaultMemory(),
});

// Spawn-on-redemption hook: called BEFORE the proof is minted; spawns
// a new agent in this process, returns its identity (the fresh pubKey
// the skill then redeems the invite for) + the URL to redirect the
// browser to.
const onSpawn = async ({ webid, role, displayName }) => {
  if (cluster.has(webid)) {
    const m = cluster.get(webid);
    return { identity: m.identity, spawnedUrl: m.ui.url };
  }
  const out = await spawnAgent({ webid, role, displayName });
  refreshClusterIndex();
  console.log(`[testbed] spawned new member ${displayName} (${role}) at ${out.url}`);
  return { identity: cluster.get(webid).identity, spawnedUrl: out.url };
};

// Register the onboarding skills on the admin's agent.
const onboardingSkills = buildOnboardingSkills({
  groupManager,
  members: cluster.get(values.admin).bundle.members,
  groupId,
  onSpawn,
});
for (const def of onboardingSkills) {
  cluster.get(values.admin).agent.skills.register(def);
}

// ── Pre-seed members from --members ────────────────────────────────────────

for (const webid of seedActors) {
  await spawnAgent({
    webid,
    role:        'member',
    displayName: webid.split('/').pop() || webid,
  });
}

refreshClusterIndex();

// ── Print summary ──────────────────────────────────────────────────────────

console.log('H5 testbed ready:');
console.log(`  group:    ${groupId}`);
console.log(`  members:  ${cluster.size}`);
for (const [, m] of cluster) {
  console.log(`    ${(m.role + ':').padEnd(9)} ${m.webid.padEnd(28)} ${m.ui.url}`);
}
console.log('');
console.log(`  ◇ Landing index: ${cluster.get(values.admin).ui.url}/testbed.html`);
console.log(`  ◇ Issue invite:  ${cluster.get(values.admin).ui.url}/onboard.html`);

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
async function shutdown() {
  console.log('\nShutting down…');
  for (const [, m] of cluster) {
    try { await m.ui.stop(); } catch {}
  }
  process.exit(0);
}
