/**
 * H5 V0 integration test — non-anonymous closed-group matchmaking.
 *
 * Migrated 2026-05-04 (Phase 4.2 of substrate refactor) to the new
 * OfferingMatch shape: every agent runs a real `core.Agent` over a shared
 * `InternalBus`; OfferingMatch composes `pubSub.publish/subscribe` directly,
 * NOT a synthetic `transport`. Cross-agent peer wiring (each agent's
 * `addPeer(addr, pubKey)` plus the OfferingMatch peers roster) replaces
 * the pre-2026-05-04 "shared InMemoryTransport" pattern.
 *
 * Skills are still invoked via `agent.skills.get(id).handler({parts, from})` —
 * the unit-test shape from Phase 3.1.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighbourhoodAgent, attachSubstrateMirror } from '../src/index.js';

const ALICE = 'https://id.example/alice';
const BOB   = 'https://id.example/bob';
const CARL  = 'https://id.example/carl';

/** Invoke a registered skill on the agent, simulating a caller `from`. */
async function callSkill(agent, skillId, args, fromWebid) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

/**
 * Build N H5 agents over a shared bus + wire them together as a
 * closed-group cluster (each knows every other's pubKey, both via
 * `core.Agent.addPeer` AND via `OfferingMatch.addPeer`).
 *
 * @param {Array<{
 *   group?:   string,                                     // default 'g'
 *   actor:    string,                                     // webid
 *   skills?:  string[], posture?: object,
 *   members?: Array<object>,
 * }>} specs
 */
async function buildCluster(specs) {
  const bus = new InternalBus();
  // Pre-generate identities so we can wire peers up-front.
  const identities = await Promise.all(specs.map(() =>
    AgentIdentity.generate(new VaultMemory()),
  ));

  const bundles = await Promise.all(specs.map(async (s, i) => {
    const id = identities[i];
    return createNeighbourhoodAgent({
      identity:  id,
      transport: new InternalTransport(bus, id.pubKey),
      label:     `H5-${s.actor}`,
      members:   s.members,
      offeringMatch: {
        group:      s.group ?? 'g',
        localActor: s.actor,
        peers:      identities
          .filter((_, j) => j !== i)
          .map((peer) => ({ pubKey: peer.pubKey })),
        skills:     s.skills,
        posture:    s.posture,
      },
    });
  }));

  // Cross-register peer pubkeys at the core.Agent layer (SecurityLayer
  // requires this before sendOneWay can reach a peer). MUST happen
  // BEFORE offeringMatch.start() — that's why the factory leaves
  // OfferingMatch stopped.
  for (let i = 0; i < bundles.length; i++) {
    for (let j = 0; j < bundles.length; j++) {
      if (i === j) continue;
      bundles[i].agent.addPeer(identities[j].pubKey, identities[j].pubKey);
    }
  }

  // Now safe to start OfferingMatch on each.
  for (const b of bundles) {
    await b.offeringMatch.start();
  }

  return bundles;
}

describe('H5 — postRequest + claim flow', () => {
  it('routes a paint request to skill-holders + collects a claim', async () => {
    const [requesterAgent, responderAgent] = await buildCluster([
      { group: 'block-42', actor: ALICE,
        members: [
          { webid: ALICE, displayName: 'Alice' },
          { webid: BOB,   displayName: 'Bob' },
        ],
      },
      { group: 'block-42', actor: BOB,
        skills: ['paint'], posture: { paint: 'always' },
      },
    ]);
    responderAgent.offeringMatch.subscribe(async () => {});

    const result = await callSkill(
      requesterAgent.agent,
      'postRequest',
      { text: 'Paint my fence', requiredSkills: ['paint'], timeoutMs: 300, expectClaims: 1 },
      ALICE,
    );
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].actor).toBe(BOB);

    const open = await requesterAgent.itemStore.listOpen();
    expect(open).toHaveLength(1);
    expect(open[0].text).toBe('Paint my fence');
  });

  it('skip non-matching skills', async () => {
    const [requesterAgent, otherAgent] = await buildCluster([
      { actor: ALICE },
      { actor: BOB, skills: ['plumb'], posture: { plumb: 'always' } },
    ]);
    otherAgent.offeringMatch.subscribe(async () => {});

    const result = await callSkill(
      requesterAgent.agent,
      'postRequest',
      { text: 'Paint my fence', requiredSkills: ['paint'], timeoutMs: 100 },
      ALICE,
    );
    expect(result.claims).toHaveLength(0);
  });
});

describe('H5 — acceptResponder flow', () => {
  let bundle;
  beforeEach(async () => {
    [bundle] = await buildCluster([{ actor: ALICE }]);
  });

  it('marks the request fulfilled with the chosen responder', async () => {
    const [req] = await bundle.itemStore.addItems(
      [{ type: 'request', text: 'help' }],
      { actor: ALICE },
    );
    const r = await callSkill(bundle.agent, 'acceptResponder',
      { requestId: req.id, responderWebid: BOB }, ALICE);
    expect(r.request.completedAt).toBeTypeOf('number');
    expect(r.request.assignee).toBe(BOB);
  });

  it('returns already-fulfilled if the request was already taken', async () => {
    const [req] = await bundle.itemStore.addItems(
      [{ type: 'request', text: 'help' }],
      { actor: ALICE },
    );
    await callSkill(bundle.agent, 'acceptResponder',
      { requestId: req.id, responderWebid: BOB }, ALICE);
    const r = await callSkill(bundle.agent, 'acceptResponder',
      { requestId: req.id, responderWebid: CARL }, ALICE);
    expect(r.error).toBe('already-fulfilled');
    expect(r.current.assignee).toBe(BOB);
  });
});

describe('H5 — cancel + list', () => {
  it('cancelRequest removes the open item', async () => {
    const [bundle] = await buildCluster([{ actor: ALICE }]);
    const [req] = await bundle.itemStore.addItems(
      [{ type: 'request', text: 'help' }],
      { actor: ALICE },
    );
    await callSkill(bundle.agent, 'cancelRequest', { requestId: req.id }, ALICE);
    expect(await bundle.itemStore.listOpen()).toHaveLength(0);
  });

  it('listMyRequests returns only requests the actor posted', async () => {
    const [bundle] = await buildCluster([{ actor: ALICE }]);
    await bundle.itemStore.addItems([{ type: 'request', text: 'mine' }],   { actor: ALICE });
    await bundle.itemStore.addItems([{ type: 'request', text: 'theirs' }], { actor: BOB });
    const r = await callSkill(bundle.agent, 'listMyRequests', undefined, ALICE);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].text).toBe('mine');
  });

  it('listOpen({skill}) filters by required skill', async () => {
    const [bundle] = await buildCluster([{ actor: ALICE }]);
    await bundle.itemStore.addItems([
      { type: 'request', text: 'paint',    requiredSkills: ['paint']  },
      { type: 'request', text: 'plumbing', requiredSkills: ['plumb']  },
    ], { actor: ALICE });
    const r = await callSkill(bundle.agent, 'listOpen', { skill: 'paint' }, ALICE);
    expect(r.items).toHaveLength(1);
  });
});

describe('H5 — itemStore events (fan-out)', () => {
  it('emits item-added / item-completed', async () => {
    const [bundle] = await buildCluster([{ actor: ALICE }]);
    const events = [];
    bundle.itemStore.on('item-added',     (i)      => events.push(['added', i.id]));
    bundle.itemStore.on('item-completed', (i)      => events.push(['completed', i.id]));
    bundle.itemStore.on('item-removed',   ({ id }) => events.push(['removed', id]));

    const [req] = await bundle.itemStore.addItems(
      [{ type: 'request', text: 'help' }],
      { actor: ALICE },
    );
    await callSkill(bundle.agent, 'acceptResponder',
      { requestId: req.id, responderWebid: BOB }, ALICE);

    const kinds = events.map((e) => e[0]);
    expect(kinds).toContain('added');
    expect(kinds).toContain('completed');
  });
});

describe('H5 — group isolation', () => {
  it('different groups do not see each other (topic-prefixed pubsub)', async () => {
    const [aliceA, bobB] = await buildCluster([
      { group: 'block-A', actor: ALICE },
      { group: 'block-B', actor: BOB,
        skills: ['paint'], posture: { paint: 'always' },
      },
    ]);
    bobB.offeringMatch.subscribe(async () => {});

    const r = await callSkill(
      aliceA.agent, 'postRequest',
      { text: 'paint', requiredSkills: ['paint'], timeoutMs: 100 },
      ALICE,
    );
    expect(r.claims).toHaveLength(0);
  });
});

// Stoop V1 regression (2026-05-06): cross-member kind chip visibility.
// Reported by manual testing — non-author members saw posts but no
// "Te leen" / "Offer" chip because groupMirror flattened type to
// 'request'. Fix in skills/index.js (thread `kind` + `dueAt` through
// the broadcast payload) + groupMirror.js (use payload.kind).
/**
 * Helper: wire `groupMirror` on every bundle in a cluster so cross-agent
 * broadcasts appear in everyone's itemStore.  Mirrors what
 * `bin/stoop-testbed.js` does in production.
 */
async function wireMirrors(bundles, group) {
  const peerKeysOf = (i) => bundles
    .filter((_, j) => j !== i)
    .map((b) => ({ pubKey: b.agent.address }));
  for (let i = 0; i < bundles.length; i++) {
    await attachSubstrateMirror(bundles[i], { group, peers: peerKeysOf(i) });
  }
}

describe('Stoop V1 — kind + dueAt propagate through the broadcast', () => {
  it('non-author members see the same `type` and `dueAt` that the author posted', async () => {
    const [alice, bob] = await buildCluster([
      { group: 'block-42', actor: ALICE,
        members: [{ webid: ALICE }, { webid: BOB }] },
      { group: 'block-42', actor: BOB,
        members: [{ webid: ALICE }, { webid: BOB }] },
    ]);
    await wireMirrors([alice, bob], 'block-42');

    const dueAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

    await callSkill(alice.agent, 'postRequest', {
      text:   'aanhanger',
      intent: 'lend',
      dueAt,
      timeoutMs:    100,
      expectClaims: 0,
    }, ALICE);

    // Allow pubsub fan-out + mirror write to settle.
    await new Promise((r) => setTimeout(r, 50));

    const bobOpen = await bob.itemStore.listOpen();
    const broadcasted = bobOpen.find((i) => i?.source?.broadcast === true);
    expect(broadcasted).toBeTruthy();
    // Phase 52.7.2 cut-over (2026-05-14): canonical-shape mirror.
    expect(broadcasted.type).toBe('offer');
    expect(broadcasted.kind).toBe('lend');
    expect(broadcasted.dueAt).toBe(dueAt);
  });

  it('posts without `intent` still mirror as `type: "request"` (V0 default)', async () => {
    const [alice, bob] = await buildCluster([
      { group: 'block-42', actor: ALICE,
        members: [{ webid: ALICE }, { webid: BOB }] },
      { group: 'block-42', actor: BOB,
        members: [{ webid: ALICE }, { webid: BOB }] },
    ]);
    await wireMirrors([alice, bob], 'block-42');

    await callSkill(alice.agent, 'postRequest', {
      text:         'paint my fence',
      timeoutMs:    100,
      expectClaims: 0,
    }, ALICE);
    await new Promise((r) => setTimeout(r, 50));

    const bobOpen = await bob.itemStore.listOpen();
    const broadcasted = bobOpen.find((i) => i?.source?.broadcast === true);
    expect(broadcasted.type).toBe('request');
  });
});
