/**
 * H5 multi-user testbed end-to-end smoke — Phase 7.
 *
 * Replicates `bin/stoop-testbed.js`'s wiring inline (admin + spawn-on-redemption
 * hook, no fork) and exercises the full onboarding flow through the
 * mountLocalUi A2A surface:
 *
 *   1. Admin issues an invite via `POST /tasks/send` (issueInvite skill).
 *   2. Pretend-browser POSTs to redeemInvite → testbed's onSpawn fires →
 *      a fresh in-process agent + UI gets mounted on a new port.
 *   3. The freshly spawned agent is reachable at the returned URL +
 *      shows up in the cluster's `/.well-known/stoop-testbed.json` overlay.
 *   4. Subsequent skill calls on the new agent's URL return the right
 *      LocalUiAuth-stamped actor (the spawned member).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AgentIdentity, InternalBus, InternalTransport, GroupManager } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { mountLocalUi, LocalUiAuth } from '@onderling/agent-ui';

import { createNeighborhoodAgent }    from '../src/Agent.js';
import { buildOnboardingSkills }      from '../src/onboarding.js';
import { attachSubstrateMirror }      from '../src/substrateMirror.js';

const ADMIN_WEBID = 'https://id.example/admin';
const GROUP_ID    = 'block-42';
const WEB_DIR     = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

let bus;
let cluster;
let extras;       // shared extraStaticFiles object — mutated as members spawn
let adminUrl;
let teardown;

beforeAll(async () => {
  bus     = new InternalBus();
  cluster = new Map();
  extras  = { '/.well-known/stoop-testbed.json': '{}', '/testbed.html': '<html></html>' };

  function refreshClusterIndex() {
    const summary = {
      groupId: GROUP_ID,
      members: [...cluster.values()].map((m) => ({
        webid:       m.webid,
        displayName: m.displayName,
        role:        m.role,
        url:         m.ui.url,
        pubKey:      m.identity.pubKey,
      })),
    };
    extras['/.well-known/stoop-testbed.json'] = JSON.stringify(summary);
  }

  function crossRegister() {
    for (const [, a] of cluster) {
      for (const [, b] of cluster) {
        if (a !== b) a.agent.addPeer(b.identity.pubKey, b.identity.pubKey);
      }
    }
  }

  // Mirrors `bin/stoop-testbed.js`'s post-spawn step: tell every pre-existing
  // OfferingMatch + group-mirror about the new arrival + push the metadata
  // into every member's MemberMap.
  async function announceNewMember(newWebid, newId, role, displayName) {
    for (const [otherWebid, m] of cluster) {
      if (otherWebid === newWebid) continue;
      m.bundle.offeringMatch.addPeer({ pubKey: newId.pubKey });
      await m.mirror.addPeer(newId.pubKey);
      await m.bundle.members.addMember({
        webid: newWebid, displayName, role, pubKey: newId.pubKey,
      });
    }
  }

  async function spawn({ webid, role, displayName }) {
    const id = await AgentIdentity.generate(new VaultMemory());
    const transport = new InternalTransport(bus, id.pubKey);
    const peers = [...cluster.values()].map((m) => ({ pubKey: m.identity.pubKey }));
    const bundle = await createNeighborhoodAgent({
      identity:  id, transport, label: `H5-${webid}`,
      members:   [...cluster.values()].map((m) => ({
        webid: m.webid, displayName: m.displayName, role: m.role, pubKey: m.identity.pubKey,
      })),
      offeringMatch: { group: GROUP_ID, localActor: webid, peers },
    });
    const ui = await mountLocalUi(bundle.agent, {
      port:        0,
      staticDir:   WEB_DIR,
      a2aTLSLayer: new LocalUiAuth({ localActor: webid }),
      extraStaticFiles: extras,
    });
    cluster.set(webid, { agent: bundle.agent, bundle, ui, identity: id, role, displayName, webid, mirror: null });
    crossRegister();
    // Mirror MUST be wired AFTER crossRegister — subscribe() sends an
    // encrypted OW envelope that requires the recipient pubKey to be
    // registered at the SecurityLayer.
    const peerPubKeys = peers.map((p) => p.pubKey);
    const mirror = await attachSubstrateMirror(bundle, {
      group: GROUP_ID,
      peers: peerPubKeys.map((pubKey) => ({ pubKey })),
    });
    cluster.get(webid).mirror = mirror;
    await announceNewMember(webid, id, role, displayName);
    await bundle.offeringMatch.start();
    return { webid, role, url: ui.url, identity: id };
  }

  // Boot admin.
  await spawn({ webid: ADMIN_WEBID, role: 'admin', displayName: 'Admin' });
  adminUrl = cluster.get(ADMIN_WEBID).ui.url;

  // Wire onboarding skills onto the admin's agent.
  const groupManager = new GroupManager({
    identity: cluster.get(ADMIN_WEBID).identity,
    vault:    new VaultMemory(),
  });
  const onSpawn = async ({ webid, role, displayName }) => {
    if (cluster.has(webid)) {
      return { identity: cluster.get(webid).identity, spawnedUrl: cluster.get(webid).ui.url };
    }
    const out = await spawn({ webid, role, displayName });
    refreshClusterIndex();
    return { identity: out.identity, spawnedUrl: out.url };
  };
  const skills = buildOnboardingSkills({
    groupManager,
    members: cluster.get(ADMIN_WEBID).bundle.members,
    groupId: GROUP_ID,
    onSpawn,
  });
  for (const def of skills) cluster.get(ADMIN_WEBID).agent.skills.register(def);
  refreshClusterIndex();

  teardown = async () => {
    for (const [, m] of cluster) await m.ui.stop();
  };
});

afterAll(async () => { await teardown?.(); });

async function callSkill(url, skillId, args) {
  const res = await fetch(`${url}/tasks/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      skillId,
      message: { parts: [{ type: 'DataPart', data: args ?? {} }] },
    }),
  });
  const json = await res.json();
  const dp = (json.artifacts?.[0]?.parts ?? []).find((p) => p?.type === 'DataPart');
  return dp?.data ?? {};
}

describe('H5 testbed — multi-user onboarding flow', () => {
  it('admin can issue an invite via /tasks/send', async () => {
    const { invite } = await callSkill(adminUrl, 'issueInvite', { ttlMs: 5000 });
    expect(invite.kind).toBe('invite');
    expect(invite.groupId).toBe(GROUP_ID);
    expect(invite.role).toBe('member');
  });

  it('redemption spawns a new in-process agent, returns its URL, and the agent is reachable', async () => {
    const { invite } = await callSkill(adminUrl, 'issueInvite', {});
    const result = await callSkill(adminUrl, 'redeemInvite', {
      invite,
      webid:       'https://id.example/charlie',
      displayName: 'Charlie',
    });
    expect(result.error).toBeUndefined();
    expect(result.spawnedUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(result.groupProof.role).toBe('member');
    expect(result.displayName).toBe('Charlie');

    // The spawned agent is reachable at the returned URL.
    const charlieListOpen = await callSkill(result.spawnedUrl, 'listOpen', {});
    expect(Array.isArray(charlieListOpen.items)).toBe(true);

    // Posts on Charlie's UI are stamped with Charlie's webid (per the
    // LocalUiAuth wired at spawn time).
    await callSkill(result.spawnedUrl, 'postRequest', {
      text: 'Hi from Charlie', timeoutMs: 50,
    });
    const open = await cluster.get('https://id.example/charlie').bundle.itemStore.listOpen();
    expect(open[0]?.addedBy).toBe('https://id.example/charlie');
  });

  it('second redemption of the same invite fails', async () => {
    const { invite } = await callSkill(adminUrl, 'issueInvite', {});
    await callSkill(adminUrl, 'redeemInvite', {
      invite, webid: 'https://id.example/dave', displayName: 'Dave',
    });
    const second = await callSkill(adminUrl, 'redeemInvite', {
      invite, webid: 'https://id.example/eve', displayName: 'Eve',
    });
    expect(second.error).toMatch(/already redeemed/);
  });

  it('cluster index reflects every spawned member', async () => {
    const res = await fetch(`${adminUrl}/.well-known/stoop-testbed.json`);
    expect(res.status).toBe(200);
    const summary = await res.json();
    expect(summary.groupId).toBe(GROUP_ID);
    const webids = summary.members.map((m) => m.webid);
    // Earlier tests redeemed 2 members; admin makes 3+ total.
    expect(webids).toContain(ADMIN_WEBID);
    expect(webids).toContain('https://id.example/charlie');
    expect(webids).toContain('https://id.example/dave');
  });

  it('a posted request appears in EVERY member\'s itemStore (visibility regression)', async () => {
    // The user-reported bug: a request posted by one member never showed
    // up on other members' "Open in the group" lists. Root cause: OfferingMatch
    // is matchmaking-shaped — its inbound dispatcher silently drops
    // requests whose `requiredSkills` don't intersect the receiver's
    // local skill profile, AND it never writes to the receiver's
    // itemStore (it's for claim flow, not visibility).
    //
    // Fix: `wireGroupBroadcastMirror` registers a parallel pubsub
    // subscription that mirrors every inbound request into the local
    // itemStore. This test asserts that mirroring works in BOTH
    // directions cluster-wide.
    const charlieBundle = cluster.get('https://id.example/charlie').bundle;
    const adminBundle   = cluster.get(ADMIN_WEBID).bundle;
    const daveBundle    = cluster.get('https://id.example/dave').bundle;

    // Charlie posts a request (no required skills — this is the case
    // the user hit; the matchmaking-only path drops it).
    await callSkill(cluster.get('https://id.example/charlie').ui.url, 'postRequest', {
      text: 'Visible-to-everyone test',
      requiredSkills: [],
      timeoutMs: 100,
    });

    // Allow the pubsub fan-out + mirror writes to settle.
    await new Promise((r) => setTimeout(r, 50));

    // Charlie's own itemStore has the request (postRequest writes locally).
    const charlieOpen = await charlieBundle.itemStore.listOpen();
    const matches = (items) => items.some((i) =>
      i?.text === 'Visible-to-everyone test' || i?.source?.requestId);
    expect(matches(charlieOpen)).toBe(true);

    // Admin + Dave's itemStores ALSO have the request via the mirror.
    const adminOpen = await adminBundle.itemStore.listOpen();
    expect(adminOpen.some((i) => i?.source?.broadcast === true && i?.source?.fromPubKey === cluster.get('https://id.example/charlie').identity.pubKey)).toBe(true);

    const daveOpen = await daveBundle.itemStore.listOpen();
    expect(daveOpen.some((i) => i?.source?.broadcast === true && i?.source?.fromPubKey === cluster.get('https://id.example/charlie').identity.pubKey)).toBe(true);
  });

  it('post-spawn broadcasts reach existing members (regression: addPeer fan-out)', async () => {
    // Charlie (spawned in an earlier test) broadcasts a request via her
    // own UI. Admin's OfferingMatch must be subscribed to Charlie — that's
    // the bug fixed by `announceNewMember` in the testbed wiring. Without
    // the fix, admin would have started with an empty OfferingMatch peer
    // roster (cluster was empty when admin spawned) and would still hold
    // an empty roster after Charlie joined.
    const charlie = cluster.get('https://id.example/charlie');
    expect(charlie).toBeTruthy();

    // Wire admin to claim paint requests via the appHandler. We use
    // `negotiable` so the handler actually runs — `always` would
    // short-circuit straight to auto-claim and bypass our observation
    // hook (matching OfferingMatch's documented behavior).
    const adminBundle = cluster.get(ADMIN_WEBID).bundle;
    const heard = [];
    adminBundle.offeringMatch.subscribe(async ({request, decide}) => {
      heard.push(request);
      await decide('claim');
    });
    adminBundle.offeringMatch.setLocalProfile({
      skills:  ['paint'],
      posture: { paint: 'negotiable' },
    });

    // Charlie posts a paint request from her UI.
    const r = await callSkill(charlie.ui.url, 'postRequest', {
      text:           'Charlie needs paint',
      requiredSkills: ['paint'],
      timeoutMs:      500,
      expectClaims:   1,             // wait for admin's claim
    });

    // The publish reached admin's appHandler (proves admin's OfferingMatch
    // is subscribed to Charlie's request topic) AND admin's claim made
    // it back to Charlie's broadcast collector (proves the round-trip).
    expect(heard.some((req) => req.payload?.text === 'Charlie needs paint')).toBe(true);
    expect(r.claims?.length ?? 0).toBeGreaterThan(0);
  });

  it('member who joins AFTER admin posted still sees admin\'s posts (backfill)', async () => {
    // Reproduces the user-reported bug: the bug was that pubsub doesn't
    // replay history, so a new member never saw admin's earlier posts
    // (asymmetric noticeboard).  The fix backfills `m.bundle.itemStore.listOpen()`
    // through the new member's mirror on join.
    const adminBundle = cluster.get(ADMIN_WEBID).bundle;
    const beforeJoinId = (await callSkill(adminUrl, 'postRequest', {
      text: 'Admin posted before Eve joined', kind: 'ask', timeoutMs: 50,
    })).requestId;
    expect(beforeJoinId).toBeTruthy();

    // Now redeem an invite as Eve.
    const { invite } = await callSkill(adminUrl, 'issueInvite', {});
    const eve = await callSkill(adminUrl, 'redeemInvite', {
      invite, webid: 'https://id.example/eve', displayName: 'Eve',
    });
    expect(eve.error).toBeUndefined();

    // Eve's noticeboard includes admin's pre-existing post.
    const eveOpen = await callSkill(eve.spawnedUrl, 'listOpen', {});
    expect(eveOpen.items.some((i) =>
      i?.text === 'Admin posted before Eve joined'
      && i?.source?.broadcast === true
      && i?.source?.fromPubKey === cluster.get(ADMIN_WEBID).identity.pubKey
    )).toBe(true);

    // And admin's local store is unchanged (no duplicate from the backfill).
    const adminOpen = await adminBundle.itemStore.listOpen();
    const adminCopies = adminOpen.filter(i => i?.text === 'Admin posted before Eve joined');
    expect(adminCopies).toHaveLength(1);
  });
});
