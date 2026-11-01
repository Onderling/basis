/**
 * A PERSON WHO REVOKED A LOST DEVICE STILL GOVERNS THEIR CIRCLE. An admin's role change folds; the admin then revokes a
 * lost device (the ceremony: person-key rotation, the lost device's addresses retired); a second role change by the same
 * admin folds too. Before the fix the later change was signed and stored but did not fold: the fold's causal depth
 * skipped the ceremony statements, so the demotion counted as older than the promotion it undid.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { bootRealAgentNode, connectNodesOverBus, pairCircle, until, teardown } from './support/pairRealAgents.js';
import { EventLog } from '../src/eventLog.js';

const GROUP = 'role-after-revoke';
const roleOn = async (node, webid) => (((await node.agent.callSkill('pinboard', 'listGroupMembers', { groupId: GROUP }))?.members ?? []).find((m) => m.webid === webid)?.role ?? null);

describe('a person who revoked a lost device still governs their circle', () => {
  let A; let B; let C;
  beforeAll(async () => {
    const log = () => ({ deviceLog: new EventLog({ initial: [], muted: [] }) });
    [A, B, C] = await Promise.all([
      bootRealAgentNode('A', { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), ...log() } }),
      bootRealAgentNode('B', { agentOpts: log() }), bootRealAgentNode('C', { agentOpts: log() }),
    ]);
    await connectNodesOverBus([A, B, C]);
    await pairCircle(A, B, { groupId: GROUP, name: 'Na intrekking', handle: 'bea' });
    await pairCircle(A, C, { groupId: GROUP, name: 'Na intrekking', handle: 'cas' });
  }, 120_000);
  afterAll(async () => { await teardown(A, B, C); });

  it('a role change folds before AND after the admin revokes a lost device', async () => {
    expect((await A.agent.callSkill('pinboard', 'setMemberRole', { groupId: GROUP, memberWebid: C.pubKey, role: 'admin' }))?.error ?? null).toBeNull();
    expect(await until(async () => ((await roleOn(A, C.pubKey)) === 'admin' ? true : null), { timeout: 10000, step: 200 }), 'the first role change did not fold').toBe(true);
    const phrase = (await A.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const r = await A.agent.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: 'd-' + 'b'.repeat(32), circleIds: [GROUP] });
    expect(r?.ok, JSON.stringify(r)).toBe(true);
    expect((await A.agent.callSkill('pinboard', 'setMemberRole', { groupId: GROUP, memberWebid: C.pubKey, role: 'member' }))?.error ?? null).toBeNull();
    expect(await until(async () => ((await roleOn(A, C.pubKey)) === 'member' ? true : null), { timeout: 10000, step: 200 }),
      `after the revoke ceremony the admin's role change did not fold (still ${await roleOn(A, C.pubKey)})`).toBe(true);
  }, 90_000);
});
