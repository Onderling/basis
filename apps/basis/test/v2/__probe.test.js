import { describe, it, expect } from 'vitest';
import { bootRealAgentNode, connectNodesOverBus, pairCircle, teardown } from '../support/pairRealAgents.js';

describe('probe', () => {
  it('roster address vs locally-derived address', async () => {
    const [A, B] = await Promise.all([bootRealAgentNode('A'), bootRealAgentNode('B')]);
    await connectNodesOverBus([A, B]);
    await pairCircle(A, B, { groupId: 'g1', handle: 'bram' });
    const r = await A.agent.callSkill('stoop', 'listGroupMembers', { groupId: 'g1' });
    const rows = (r?.members ?? []).map(m => ({ pubKey: m.pubKey, circleAddress: m.circleAddress }));
    const derivedA = await A.agent.circleAddressFor?.('g1');
    const derivedB = await B.agent.circleAddressFor?.('g1');
    console.log('PROBE', JSON.stringify({
      aPub: A.pubKey, bPub: B.pubKey, derivedA, derivedB, rows,
    }));
    await teardown(A, B);
  }, 60000);
});
