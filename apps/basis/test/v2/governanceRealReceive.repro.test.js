import { describe, it, expect } from 'vitest';
import { bootRealAgentNode, connectAgentsOverBus, pairCircle, until, teardown } from '../support/pairRealAgents.js';
import { governanceEntryId } from '../../src/v2/governanceLog.js';
import { reportEntryId } from '../../src/v2/reportModel.js';

// Warm the secure mesh so A can reach B: a real circle's members have already exchanged HI
// (they've been connected/chatting) before any governance fan. A cold broadcast fails
// "send HI first" — an agents-just-connected artifact, not a governance bug.
async function warmMesh(A, B, groupId) {
  const text = 'warmup-' + Math.random().toString(36).slice(2);
  await A.agent.callSkill('stoop', 'broadcastKringMessage', { groupId, msgId: 'w-' + Math.random().toString(36).slice(2), text });
  await until(() => B.chatEvents.some((e) => e?.payload?.text === text), { timeout: 4000 });
}

// Wave C tail A — extended headless model: a governance/report event fanned via the REAL
// stoop broadcastKring{Governance,Report} skill ingests into the OTHER agent's EventLog via
// the REAL peer router + governance receiver, over a genuine transport (InternalTransport).
// This is the two-device replication the unit tests SIMULATE, exercised end-to-end.
//
// (Previously skipped: this journey CAUGHT a pre-existing gap — broadcastToCircle, the shared
// fan behind ALL broadcastKring* siblings, sent to member webids while the mesh keys by chat
// pubKey. Fixed by routing every broadcast through the reliable sender (webid→pubKey +
// hold-forward), synthesising a wire envelope for the control-plane broadcasts. Now green.)
describe('governance/report propagation via the REAL receiver (InternalTransport)', () => {
  it('broadcastKringGovernance A -> B ingests the vote event into B\'s log', async () => {
    const A = await bootRealAgentNode('A');
    const B = await bootRealAgentNode('B');
    await connectAgentsOverBus(A, B);
    await pairCircle(A, B);
    await warmMesh(A, B, 'peer-circle');

    const groupId = 'peer-circle';
    const event = { kind: 'governance', event: 'propose', proposalId: 'p-headless', action: 'removeMember', subject: 'someone', by: 'A', hash: 'h-' + Math.random().toString(36).slice(2), author: 'A', parentHash: null };
    const r = await A.agent.callSkill('stoop', 'broadcastKringGovernance', { groupId, event, msgId: governanceEntryId(event) });
    expect(r?.error, `broadcast failed: ${JSON.stringify(r)}`).toBeFalsy();

    const got = await until(
      () => B.chatEvents.some((e) => e?.type === 'governance' && e?.payload?.proposalId === 'p-headless'),
      { timeout: 3000 },
    );
    expect(got, 'B ingested the governance event via the REAL receiver').toBeTruthy();
    // and the stable id deduped (exactly one entry for this event)
    const ingested = B.chatEvents.filter((e) => e?.type === 'governance' && e?.payload?.proposalId === 'p-headless');
    expect(ingested).toHaveLength(1);
    await teardown(A, B);
  });

  it('broadcastKringReport A -> B ingests the report event into B\'s log', async () => {
    const A = await bootRealAgentNode('A');
    const B = await bootRealAgentNode('B');
    await connectAgentsOverBus(A, B);
    await pairCircle(A, B);
    await warmMesh(A, B, 'peer-circle');

    const groupId = 'peer-circle';
    const event = { kind: 'report', event: 'report', reportId: 'r-headless', targetType: 'member', targetRef: 'someone', reason: 'spam', by: 'A' };
    const r = await A.agent.callSkill('stoop', 'broadcastKringReport', { groupId, event, msgId: reportEntryId(event) });
    expect(r?.error, `broadcast failed: ${JSON.stringify(r)}`).toBeFalsy();

    const got = await until(
      () => B.chatEvents.some((e) => e?.type === 'report' && e?.payload?.reportId === 'r-headless'),
      { timeout: 3000 },
    );
    expect(got, 'B ingested the report event via the REAL receiver').toBeTruthy();
    await teardown(A, B);
  });
});
