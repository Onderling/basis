/**
 * L55 (2026-08-29) — a JOINER can name their circle.
 *
 * `listMyCircles` derives a circle's name from its `group-rules` row's `text` ("a joiner holds the
 * circle's rules without having written them, and they are owed its name just as much"). The joiner's row
 * is written by `recordRemoteRedemption` from the invite's embedded rules — but its `text` was a
 * synthetic label, "Rules for <id> (mirrored from invite)", so a joiner's tile could never read the name
 * even when the rules arrived. With the invite carrying `name`, the row carries it too.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '../src/index.js';

const JOINER = 'https://joiner.example/profile/card#me';

async function boot() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: JOINER, peers: [] },
    members: [{ webid: JOINER }],
  });
  await bundle.offeringMatch.start();
  return bundle.agent;
}
async function callSkill(agent, skillId, args, from = JOINER) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
}

describe('L55 — the joiner names the circle from the invite', () => {
  it('recordRemoteRedemption({name}) writes the name as the rules row text, and listMyCircles names it', async () => {
    const agent = await boot();
    const rec = await callSkill(agent, 'recordRemoteRedemption', {
      groupId: 'g-abc', code: 'CODE', confirmedBy: 'admin-addr',
      rules: { purpose: 'lenen' }, name: 'Prikbord Kring',
    });
    expect(rec?.groupId).toBe('g-abc');
    const mine = await callSkill(agent, 'listMyCircles', {});
    expect(mine?.names?.['g-abc'] ?? mine?.names?.get?.('g-abc'),
      'the joined circle is named from the invite, not shown as its hex id').toBe('Prikbord Kring');
  });

  it('without a name the old label stands (nothing invented)', async () => {
    const agent = await boot();
    await callSkill(agent, 'recordRemoteRedemption', { groupId: 'g-xyz', code: 'CODE', confirmedBy: 'a', rules: { purpose: 'x' } });
    const rules = await callSkill(agent, 'getGroupRules', { groupId: 'g-xyz' });
    expect(rules?.rules?.text).toMatch(/mirrored from invite/);
  });
});
