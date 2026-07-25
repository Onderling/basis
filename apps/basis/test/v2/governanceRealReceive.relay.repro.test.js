import { describe, it, expect } from 'vitest';
import { bootRealAgentNode, connectAgentsOverRelay, pairCircle, until, teardown } from '../support/pairRealAgents.js';
import { governanceEntryId } from '../../src/v2/governanceLog.js';
import { reportEntryId } from '../../src/v2/reportModel.js';

// Wave C tail A over a REAL relay (running on :8787) — governance/report propagation via the
// production fan + peer router, over a genuine transport (not InternalTransport). This is the
// path that caught the broadcastToCircle webid→pubKey bug; the fix (route every broadcast
// through the reliable sender) is confirmed here end-to-end. Verified manually 2026-07-25:
// gov propose + report both ingest on B over the relay.
const RELAY = process.env.PEER_TEST_RELAY || 'ws://127.0.0.1:8787';

async function warmMesh(A, B) {
  const text = 'warmup-' + Math.random().toString(36).slice(2);
  await A.agent.callSkill('stoop', 'broadcastKringMessage', { groupId: 'peer-circle', msgId: 'w-' + Math.random().toString(36).slice(2), text });
  await until(() => B.chatEvents.some((e) => e?.payload?.text === text), { timeout: 8000 });
}

describe('governance/report propagation over a REAL relay', () => {
  it('broadcastKringGovernance A -> B ingests the vote event over the relay', async () => {
    const A = await bootRealAgentNode('A');
    const B = await bootRealAgentNode('B');
    await connectAgentsOverRelay(A, B, { relayUrl: RELAY });
    await pairCircle(A, B);
    await warmMesh(A, B);

    const event = { kind: 'governance', event: 'propose', proposalId: 'p-relay', action: 'removeMember', subject: 'x', by: 'A', hash: 'h-' + Math.random().toString(36).slice(2), author: 'A', parentHash: null };
    const r = await A.agent.callSkill('stoop', 'broadcastKringGovernance', { groupId: 'peer-circle', event, msgId: governanceEntryId(event) });
    expect(r?.sent, `broadcast should send over the relay: ${JSON.stringify(r)}`).toBeGreaterThan(0);

    const got = await until(() => B.chatEvents.some((e) => e?.type === 'governance' && e?.payload?.proposalId === 'p-relay'), { timeout: 8000 });
    expect(got, 'B ingested the governance event over the relay').toBeTruthy();
    await teardown(A, B);
  });

  it('broadcastKringReport A -> B ingests the report event over the relay', async () => {
    const A = await bootRealAgentNode('A');
    const B = await bootRealAgentNode('B');
    await connectAgentsOverRelay(A, B, { relayUrl: RELAY });
    await pairCircle(A, B);
    await warmMesh(A, B);

    const event = { kind: 'report', event: 'report', reportId: 'r-relay', targetType: 'member', targetRef: 'x', reason: 'spam', by: 'A' };
    const r = await A.agent.callSkill('stoop', 'broadcastKringReport', { groupId: 'peer-circle', event, msgId: reportEntryId(event) });
    expect(r?.sent).toBeGreaterThan(0);

    const got = await until(() => B.chatEvents.some((e) => e?.type === 'report' && e?.payload?.reportId === 'r-relay'), { timeout: 8000 });
    expect(got, 'B ingested the report event over the relay').toBeTruthy();
    await teardown(A, B);
  });
});
