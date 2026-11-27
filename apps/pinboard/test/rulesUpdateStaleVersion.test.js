/**
 * A STALE SECOND DEVICE CANNOT OVERWRITE FRESHER RULES (story 6.2 of the multi-device user stories, the rules half).
 *
 * The rules document travels the governance lane as a versioned admin statement (the rules-update rider); its receive
 * half, `recordGroupRulesUpdate`, is the one place the version guard lives: a statement at or below the local head never
 * writes, in any arrival order. Anna's phone (fresh) and her laptop (stale) both reach a member: whichever arrives first,
 * the member ends on the fresher version.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '../src/index.js';

const MEMBER = 'https://member.example/profile/card#me';
const OLD = { purpose: 'lenen', houseRules: 'wees aardig' };
const NEW = { purpose: 'lenen', houseRules: 'wees aardig; geen fietsen in de gang' };

async function boot() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'g-rules', localActor: MEMBER, peers: [] },
    members: [{ webid: MEMBER }],
  });
  await bundle.offeringMatch.start();
  return bundle.agent;
}
async function callSkill(agent, skillId, args) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({ parts: [DataPart(args)], from: MEMBER, agent, envelope: null });
}
const record = (agent, rules, version) => callSkill(agent, 'recordGroupRulesUpdate', { groupId: 'g-rules', rules, version });
const houseRules = async (agent) => {
  const r = await callSkill(agent, 'getGroupRules', { groupId: 'g-rules' });
  return JSON.stringify(r).includes(NEW.houseRules) ? 'new' : JSON.stringify(r).includes(OLD.houseRules) ? 'old' : 'none';
};

describe('6.2 — the rules: a stale device cannot overwrite a fresher change', () => {
  it('fresh first, stale after: the stale version is refused and the fresher rules stay', async () => {
    const agent = await boot();
    expect((await record(agent, NEW, 2)).applied).not.toBe(false);
    expect(await record(agent, OLD, 1)).toMatchObject({ applied: false, version: 2 });
    expect(await houseRules(agent)).toBe('new');
  });

  it('stale first, fresh after: the fresher version lands', async () => {
    const agent = await boot();
    await record(agent, OLD, 1);
    expect((await record(agent, NEW, 2)).applied).not.toBe(false);
    expect(await houseRules(agent)).toBe('new');
  });

  it('the same version again never writes (a replay of the stale laptop\'s statement)', async () => {
    const agent = await boot();
    await record(agent, NEW, 2);
    expect(await record(agent, OLD, 2)).toMatchObject({ applied: false, version: 2 });
    expect(await houseRules(agent)).toBe('new');
  });
});
