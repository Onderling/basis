/**
 * Stoop Phase 35 — Auto-eviction enforcement.
 *
 * Verifies:
 *   - 35.1: EvictionRoster builds Map<webid, expiresAt> from
 *           membership-redemption items + updates live on item-added.
 *   - 35.2: groupMirror.mirror() drops requests whose `from` is past
 *           expiresAt + GRACE_MS.  wireChat broadcast-post handler
 *           drops too.
 *   - listEvictedMembers skill returns the current set.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { ItemStore } from '@onderling/item-store';
import { MemorySource } from '@onderling/core';
import { createNeighbourhoodAgent, attachSubstrateMirror } from '../src/index.js';
import { EvictionRoster, EVICTION_GRACE_MS } from '../src/lib/EvictionRoster.js';

const ANNE = 'https://id.example/anne';
const BOB  = 'https://id.example/bob';
const EVE  = 'https://id.example/eve';

async function buildBundle() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity:   id,
    transport:  tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:    [{ webid: ANNE }, { webid: BOB }, { webid: EVE }],
  });
  await bundle.offeringMatch.start();
  return bundle;
}

async function callSkill(agent, skillId, args) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     ANNE,
    agent,
    envelope: null,
  });
}

describe('Phase 35.1 — EvictionRoster basics', () => {
  it('isEvicted is false for unknown webids', () => {
    const r = new EvictionRoster();
    expect(r.isEvicted(BOB)).toBe(false);
  });

  it('applyRedemption stores latest expiresAt; isEvicted flips past expiresAt+grace', () => {
    const r = new EvictionRoster();
    const past = Date.now() - EVICTION_GRACE_MS - 60_000;
    r.applyRedemption({
      type: 'membership-redemption',
      source: { redeemedBy: BOB, expiresAt: past },
    });
    expect(r.isEvicted(BOB)).toBe(true);
    expect(r.expiresAt(BOB)).toBe(past);

    const future = Date.now() + 7 * 24 * 60 * 60 * 1000;
    r.applyRedemption({
      type: 'membership-redemption',
      source: { redeemedBy: BOB, expiresAt: future },
    });
    expect(r.isEvicted(BOB)).toBe(false);   // newer redemption supersedes
  });

  it('older redemption does NOT clobber a newer one', () => {
    const r = new EvictionRoster();
    const future = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const past   = Date.now() - 1_000;
    r.applyRedemption({
      type: 'membership-redemption',
      source: { redeemedBy: BOB, expiresAt: future },
    });
    r.applyRedemption({
      type: 'membership-redemption',
      source: { redeemedBy: BOB, expiresAt: past },
    });
    expect(r.expiresAt(BOB)).toBe(future);
    expect(r.isEvicted(BOB)).toBe(false);
  });

  it('hydrateFrom seeds the roster from existing items in the store', async () => {
    const store = new ItemStore({ dataSource: new MemorySource(), rootContainer: 'mem://t/' });
    const past = Date.now() - EVICTION_GRACE_MS - 60_000;
    await store.addItems([{
      type: 'membership-redemption',
      text: 'bob redeemed',
      source: { redeemedBy: BOB, expiresAt: past, groupId: 'g1' },
    }], { actor: BOB });

    const r = new EvictionRoster();
    await r.hydrateFrom(store);
    expect(r.isEvicted(BOB)).toBe(true);
  });

  it('attach: roster reacts to live item-added events', async () => {
    const store = new ItemStore({ dataSource: new MemorySource(), rootContainer: 'mem://t/' });
    const r = new EvictionRoster();
    r.attach({ itemStore: store });
    expect(r.isEvicted(EVE)).toBe(false);
    const past = Date.now() - EVICTION_GRACE_MS - 60_000;
    await store.addItems([{
      type: 'membership-redemption',
      text: 'eve redeemed',
      source: { redeemedBy: EVE, expiresAt: past, groupId: 'g1' },
    }], { actor: EVE });
    expect(r.isEvicted(EVE)).toBe(true);
  });
});

describe('Phase 35.2 — groupMirror filters evicted authors', () => {
  it('evicted member: their broadcast does NOT land in the local itemStore', async () => {
    const bundle = await buildBundle();
    const evictionRoster = bundle.evictionRoster;

    // Mark Bob as evicted.
    const past = Date.now() - EVICTION_GRACE_MS - 60_000;
    evictionRoster.applyRedemption({
      type: 'membership-redemption',
      source: { redeemedBy: BOB, expiresAt: past },
    });
    expect(evictionRoster.isEvicted(BOB)).toBe(true);

    // Wire a mirror; we'll feed it directly via mirror() (the
    // test doesn't need a separate publishing agent).
    const mirror = await attachSubstrateMirror(bundle, {
      group:          'oosterpoort',
      peers:          [],
      evictionRoster,
    });

    // Two posts: Bob (evicted) + Eve (not evicted).
    // Drive the mirror through its public addPeer/backfillFrom path.
    await mirror.backfillFrom('pubkey-bob-stub', [{
      id:           'item-from-bob-1',
      addedBy:      BOB,
      type:         'request',
      text:         'Bob asks for help',
      requiredSkills: [],
      source:       { skillTags: [], categoryId: null },
    }]);
    await mirror.backfillFrom('pubkey-eve-stub', [{
      id:           'item-from-eve-1',
      addedBy:      EVE,
      type:         'request',
      text:         'Eve asks for help',
      requiredSkills: [],
      source:       { skillTags: [], categoryId: null },
    }]);

    const open = await bundle.itemStore.listOpen();
    const sources = open.map(i => i?.source?.requestId).filter(Boolean);
    expect(sources).toContain('item-from-eve-1');
    expect(sources).not.toContain('item-from-bob-1');

    await mirror.stop();
  });

  it('listEvictedMembers skill returns the current eviction set', async () => {
    const bundle = await buildBundle();
    const past = Date.now() - EVICTION_GRACE_MS - 60_000;
    bundle.evictionRoster.applyRedemption({
      type: 'membership-redemption',
      source: { redeemedBy: BOB, expiresAt: past },
    });

    const r = await callSkill(bundle.agent, 'listEvictedMembers', {});
    expect(r.evicted.length).toBe(1);
    expect(r.evicted[0].webid).toBe(BOB);
    expect(r.evicted[0].expiresAt).toBe(past);
  });

  it('redeemMembershipCode flow updates the roster live (regression)', async () => {
    const bundle = await buildBundle();
    // Plant a redemption directly via the itemStore (simulates the
    // skill having recorded it).  Past expiresAt → evicted.
    const past = Date.now() - EVICTION_GRACE_MS - 60_000;
    await bundle.itemStore.addItems([{
      type: 'membership-redemption',
      text: 'eve redeemed (stale)',
      source: { redeemedBy: EVE, expiresAt: past, groupId: 'g1' },
    }], { actor: EVE });

    expect(bundle.evictionRoster.isEvicted(EVE)).toBe(true);

    // Now plant a fresh redemption — roster should clear EVE's
    // eviction without a manual rebuild.
    const future = Date.now() + 7 * 24 * 60 * 60 * 1000;
    await bundle.itemStore.addItems([{
      type: 'membership-redemption',
      text: 'eve redeemed (fresh)',
      source: { redeemedBy: EVE, expiresAt: future, groupId: 'g1' },
    }], { actor: EVE });

    expect(bundle.evictionRoster.isEvicted(EVE)).toBe(false);
  });
});
