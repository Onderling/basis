/**
 * A circle's invite code is the admin's own: after a circle is made, the code is on the person's own-devices store
 * (sealed, carried between that self's devices only) and the invite paths still find it there.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, createCircle, teardown } from './support/pairRealAgents.js';

describe('the membership code lives on the own-devices store', () => {
  let node;
  afterAll(async () => { await teardown(node).catch(() => {}); });

  it('a new circle\'s code is an own-store row, written as the circle\'s self, and the invite reads it there', async () => {
    node = await bootRealAgentNode('admin');
    await createCircle(node, { groupId: 'code-circle', name: 'Kring' });
    const rows = await (await node.agent.ownStore()).listByType('membership-code');
    const mine = rows.filter((r) => r?.source?.groupId === 'code-circle');
    expect(mine.length, 'the code is on the own store').toBeGreaterThan(0);
    expect(mine[0].createdBy, "written as the circle's self (the default here)").toBe(node.agent.identity.chat.pubKey);
    const cur = await node.agent.callSkill('pinboard', 'getCurrentMembershipCode', { groupId: 'code-circle' });
    expect(cur?.code, JSON.stringify(cur)).toBe(mine.sort((a, b) => (b.source.issuedAt ?? 0) - (a.source.issuedAt ?? 0))[0].source.code);
  }, 60_000);
});
