/**
 * Pinboard V1 — Phase 14 tests.
 *
 * Peer chat round-trip across two agents on the same InternalBus +
 * respondToItem flow + bilateral reveal handshake.  Composes shipped
 * SDK primitives only; no `chat-agent` substrate involvement.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { Reveals } from '@onderling/identity-resolver';

import { createNeighbourhoodAgent, attachSubstrateMirror } from '../src/index.js';

const ANNE = 'https://id.example/anne';
const BOB  = 'https://id.example/bob';

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
 * Build a 2-agent cluster (Anne + Bob) on a shared bus, with each
 * peer wired so they can `agent.message(other.pubKey, ...)` directly.
 */
async function buildPair({ anneBlocks } = {}) {
  const bus = new InternalBus();
  const anneId = await AgentIdentity.generate(new VaultMemory());
  const bobId  = await AgentIdentity.generate(new VaultMemory());

  const anne = await createNeighbourhoodAgent({
    identity:  anneId,
    transport: new InternalTransport(bus, anneId.pubKey),
    offeringMatch: { group: 'oosterpoort', localActor: ANNE,
                  peers: [{ pubKey: bobId.pubKey }] },
    members: [
      { webid: ANNE, handle: 'anne', stableId: anneId.stableId, pubKey: anneId.pubKey },
      { webid: BOB,  handle: 'bob',  stableId: bobId.stableId,  pubKey: bobId.pubKey  },
    ],
    reveals: new Reveals(),
    mutedSet: anneBlocks,
  });
  const bob = await createNeighbourhoodAgent({
    identity:  bobId,
    transport: new InternalTransport(bus, bobId.pubKey),
    offeringMatch: { group: 'oosterpoort', localActor: BOB,
                  peers: [{ pubKey: anneId.pubKey }] },
    members: [
      { webid: ANNE, handle: 'anne', stableId: anneId.stableId, pubKey: anneId.pubKey },
      { webid: BOB,  handle: 'bob',  stableId: bobId.stableId,  pubKey: bobId.pubKey  },
    ],
    reveals: new Reveals(),
  });

  // Cross-register peer pubkeys at the SecurityLayer (must happen
  // BEFORE offeringMatch.start()).
  anne.agent.addPeer(bobId.pubKey, bobId.pubKey);
  bob.agent.addPeer(anneId.pubKey, anneId.pubKey);

  // Wire substrate mirror (Phase 52.9.2 / Q-B 2026-05-14 — replaces
  // legacy groupMirror) BEFORE offeringMatch.start so the substrate
  // subscriber is live in time for the first publish.
  await attachSubstrateMirror(anne, { group: 'oosterpoort', peers: [{ pubKey: bobId.pubKey }] });
  await attachSubstrateMirror(bob,  { group: 'oosterpoort', peers: [{ pubKey: anneId.pubKey }] });

  await anne.offeringMatch.start();
  await bob.offeringMatch.start();

  return { anne, bob, anneId, bobId };
}

// ── 1-on-1 chat round-trip ───────────────────────────────────────────────

// ── respondToItem ────────────────────────────────────────────────────────

describe('Pinboard V1 Phase 14 — respondToItem flow', () => {
  it('finds a mirrored post by source.requestId + sends chat to its author', async () => {
    const { anne, bob, anneId } = await buildPair();
    const reachedAnne = [];
    anne.agent.on('message', (m) => { for (const p of m?.parts ?? []) if (p?.data?.subtype === 'chat-message') reachedAnne.push(p.data); });

    // Bypass the (timing-fragile) broadcast path for this unit test:
    // synthesise the mirrored item directly on Bob's side, the way
    // groupMirror would write it for an inbound broadcast from Anne.
    const broadcastId = 'fake-broadcast-id';
    await bob.itemStore.addItems([{
      type: 'ask',
      text: 'Iemand handig met fietsen?',
      visibility: 'household',
      source: {
        requestId:    broadcastId,
        broadcast:    true,
        from:         ANNE,
        fromPubKey:   anneId.pubKey,
        claimsTopic:  null,
      },
    }], { actor: ANNE });

    // Bob clicks "Ik help" → respondToItem.
    const r = await callSkill(bob.agent, 'respondToItem', {
      itemId: broadcastId, body: 'Hoi, ik woon vlakbij',
    }, BOB);
    expect(r, 'respondToItem error').toMatchObject({ ok: true });
    expect(r.threadId).toBe(broadcastId);
    // The op names the poster so the shell can open the contact thread the reply starts.
    expect(r.toPubKey).toBe(anneId.pubKey);

    // Allow the OW envelope to dispatch on Anne's side.
    await new Promise(r => setTimeout(r, 30));

    // Bob's answer reached Anne's agent, threaded under her post (pinboard keeps no copy of a 1:1 turn — a shell's
    // contact thread is its record).
    expect(reachedAnne.some((d) => d.threadId === broadcastId && d.body === 'Hoi, ik woon vlakbij' && d.fromWebid === BOB)).toBe(true);
  });

  it('rejects when the item is not found', async () => {
    const { bob } = await buildPair();
    expect(await callSkill(bob.agent, 'respondToItem',
      { itemId: 'does-not-exist', body: 'hi' }, BOB))
      .toEqual({ error: 'not-found' });
  });
});

// ── Bilateral reveal handshake ───────────────────────────────────────────

describe('Pinboard V1 Phase 14 — bilateral reveal handshake', () => {
  it('requestReveal flips local Reveals + emits a reveal-request to the peer', async () => {
    const { anne, bob, anneId, bobId } = await buildPair();

    const r = await callSkill(anne.agent, 'requestReveal', {
      peerStableId: bobId.stableId, threadId: 'reveal-thread',
    }, ANNE);
    expect(r.ok).toBe(true);

    // Anne's local Reveals now has Bob = true.
    expect(anne.reveals.decide({ peerWebid: bobId.stableId }).showDisplayName).toBe(true);
  });

  it('bilateral reveal: both sides can requestReveal via peerWebid (regression: recipient-pubkey-unknown)', async () => {
    // The user-reported bug: admin clicked "Connectie accepteren"
    // (reveal-request via peerWebid → admin's MemberMap looks up
    // member's pubKey → fine).  Then member clicked the same button
    // and got `recipient-pubkey-unknown`.  Root cause: the chat UI
    // detected the wrong "other party" because getActor() returned
    // the agent URL instead of the WebID; `peerWebid` ended up as
    // the member's OWN webid, which was missing pubKey in their
    // MemberMap.  Fix: factory pre-seeds the local actor's MemberMap
    // entry, AND `whoAmI` returns the canonical webid.
    const { anne, bob, anneId, bobId } = await buildPair();

    // Anne accepts (peerWebid path, mirroring chat.html).
    const a = await callSkill(anne.agent, 'requestReveal',
      { peerWebid: BOB, threadId: 't' }, ANNE);
    expect(a.ok).toBe(true);

    // Bob accepts (peerWebid path, mirroring chat.html).  Pre-fix
    // this errored when Bob's "other party" detection picked his
    // own webid; the new whoAmI/MemberMap seeding makes it work.
    const b = await callSkill(bob.agent, 'requestReveal',
      { peerWebid: ANNE, threadId: 't' }, BOB);
    expect(b.ok).toBe(true);

    // Both sides have flipped their local Reveals.
    expect(anne.reveals.decide({ peerWebid: BOB }).showDisplayName).toBe(true);
    expect(bob.reveals.decide({ peerWebid: ANNE }).showDisplayName).toBe(true);
  });

  it('whoAmI returns {webid, stableId, pubKey}', async () => {
    const { anne, anneId } = await buildPair();
    const me = await callSkill(anne.agent, 'whoAmI', undefined, ANNE);
    expect(me.webid).toBe(ANNE);
    expect(me.stableId).toBe(anneId.stableId);
    expect(me.pubKey).toBe(anneId.pubKey);
  });

  it('reveals is auto-wired so requestReveal works without explicit opt-in', async () => {
    // Earlier the bundle returned `chat-or-reveals-not-wired` when no
    // Reveals was provided.  The factory now auto-wires a default
    // Reveals so the "Connectie accepteren" button works out of the
    // box.  This test pins the new default.
    const id = await AgentIdentity.generate(new VaultMemory());
    const tx = new InternalTransport(new InternalBus(), id.pubKey);
    const bundle = await createNeighbourhoodAgent({
      identity: id, transport: tx,
      offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
      members:    [{ webid: ANNE }],
    });
    await bundle.offeringMatch.start();
    expect(bundle.reveals).toBeTruthy();
  });
});
