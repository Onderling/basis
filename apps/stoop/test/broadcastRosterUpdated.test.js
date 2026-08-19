/**
 * Stoop — broadcastRosterUpdated skill (profile-update propagation, Phase-4 Wave B).
 *
 * The roster "pull-me" signal fans out to every OTHER member via chat.send (subtype
 * `roster-updated`), carrying ONLY a member ref + the NAMES of the changed properties — never a
 * value. Sibling of the broadcastCircle* family; the defining property under test is that no
 * disclosed value ever rides this wire.
 *
 * The cross-agent journey feeds a captured envelope into basis's `makeRosterUpdatedPeerHandler`
 * and asserts the receiver records a SILENT stream entry + pulls exactly the named rows.
 */
import { describe, it, expect, vi } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighborhoodAgent } from '../src/index.js';
import { makeRosterUpdatedPeerHandler, ROSTER_UPDATED_KIND } from '../../basis/src/v2/rosterUpdated.js';
import { EventLog, isSilentEntry } from '../../basis/src/eventLog.js';

const ANNE  = 'https://id.example/anne';
const BOB   = 'https://id.example/bob';
const CARLA = 'https://id.example/carla';

async function callSkill(agent, skillId, args, fromWebid = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from: fromWebid, agent, envelope: null });
}

async function buildBundle(members) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  return createNeighborhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members: members ?? [
      { webid: ANNE,  role: 'member' },
      { webid: BOB,   role: 'member', stableId: 'sid-bob' },
      { webid: CARLA, role: 'member', stableId: 'sid-carla' },
    ],
  });
}

describe('Stoop — broadcastRosterUpdated', () => {
  it('fans the refs-only signal out to every other member (no values on the wire)', async () => {
    const bundle = await buildBundle();
    await bundle.offeringMatch.start();
    const calls = [];
    bundle.chat.send = vi.fn(async (args) => { calls.push(args); return { ok: true }; });

    const r = await callSkill(bundle.agent, 'broadcastRosterUpdated', {
      groupId: 'oosterpoort', memberRef: BOB, keys: ['place', 'profilePicture'],
      msgId: 'ru-1', ts: 1735_000_000_000,
    });
    expect(r.sent).toBe(2);
    expect(r.errors).toEqual([]);
    expect(calls.map((c) => c.toWebid).sort()).toEqual([BOB, CARLA].sort());
    for (const c of calls) {
      expect(c.subtype).toBe('roster-updated');
      expect(c.threadId).toBe('oosterpoort');
      expect(c.extras).toEqual({
        circleId: 'oosterpoort', msgId: 'ru-1', ts: 1735_000_000_000,
        memberRef: BOB, keys: ['place', 'profilePicture'],
      });
      // The wire carries KEY NAMES only — no disclosed value can appear on it.
      expect(JSON.stringify(c.extras)).not.toContain('Groningen');
    }
  });

  it('drops any value a caller straps onto keys/extras — names only', async () => {
    const bundle = await buildBundle();
    await bundle.offeringMatch.start();
    const calls = [];
    bundle.chat.send = vi.fn(async (args) => { calls.push(args); return { ok: true }; });
    await callSkill(bundle.agent, 'broadcastRosterUpdated', {
      groupId: 'oosterpoort', memberRef: BOB,
      keys: ['place', { place: 'Groningen' }, 42, ''],   // only the valid string name survives
      msgId: 'ru-2',
    });
    expect(calls[0].extras.keys).toEqual(['place']);
  });

  it('rejects a missing memberRef or msgId', async () => {
    const bundle = await buildBundle();
    await bundle.offeringMatch.start();
    expect(await callSkill(bundle.agent, 'broadcastRosterUpdated', { groupId: 'oosterpoort', msgId: 'm' }))
      .toEqual({ error: 'memberRef-required' });
    expect(await callSkill(bundle.agent, 'broadcastRosterUpdated', { groupId: 'oosterpoort', memberRef: BOB }))
      .toEqual({ error: 'msgId-required' });
  });
});

describe('Stoop — cross-agent: Anne announces, Bob records the silent entry + pulls', () => {
  it('the receiver records a SILENT entry and pulls exactly the named rows', async () => {
    const anne = await buildBundle([
      { webid: ANNE, role: 'member' },
      { webid: BOB,  role: 'member', stableId: 'sid-bob' },
    ]);
    await anne.offeringMatch.start();
    const captured = [];
    anne.chat.send = vi.fn(async (args) => { captured.push(args); return { ok: true }; });

    // A CURRENT ts — the EventLog prunes entries older than its 14-day retention on append.
    await callSkill(anne.agent, 'broadcastRosterUpdated', {
      groupId: 'oosterpoort', memberRef: CARLA, keys: ['place'], msgId: 'x-ru-1', ts: Date.now(),
    });
    expect(captured).toHaveLength(1);

    const log = new EventLog({ initial: [] });
    const pulls = [];
    const handler = makeRosterUpdatedPeerHandler({ eventLog: log, onPull: async (a) => { pulls.push(a); } });

    const sent = captured[0];
    await handler('nkn-addr-anne', {
      subtype: ROSTER_UPDATED_KIND,
      circleId: sent.extras.circleId, msgId: sent.extras.msgId, ts: sent.extras.ts,
      memberRef: sent.extras.memberRef, keys: sent.extras.keys,
    });

    expect(log.size).toBe(1);
    expect(isSilentEntry(log.query({})[0])).toBe(true);
    expect(pulls).toEqual([{ circleId: 'oosterpoort', memberRef: CARLA, keys: ['place'] }]);
  });
});
