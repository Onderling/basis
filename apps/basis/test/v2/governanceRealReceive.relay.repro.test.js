import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootRealAgentNode, connectAgentsOverRelay, pairCircle, until, teardown, sendCircleChat } from '../support/pairRealAgents.js';
import { startJourneyRelay } from '../support/testRelay.js';
import { signSpine } from '@onderling/core';
import { reportEntryId } from '../../src/v2/reportModel.js';

// Wave C tail A over a REAL relay (running on :8787) — governance/report propagation via the
// production fan + peer router, over a genuine transport (not InternalTransport). This is the
// path that caught the broadcastToCircle webid→pubKey bug; the fix (route every broadcast
// through the reliable sender) is confirmed here end-to-end. Verified manually 2026-07-25:
// gov propose + report both ingest on B over the relay.
// The relay is STARTED by the suite (in-process, ephemeral port) instead of assumed to be running:
// this file used to fall back to a hard-coded `ws://127.0.0.1:8787`, so on a machine with nothing on
// that port it failed at connect and was read as a flake for weeks. `ONDERLING_RELAY_URL` still points
// the whole set at an external or deployed relay.
let relay = null;
let RELAY = null;

async function warmMesh(A, B) {
  const text = 'warmup-' + Math.random().toString(36).slice(2);
  await sendCircleChat(A, { groupId: 'peer-circle', msgId: 'w-' + Math.random().toString(36).slice(2), text });
  await until(() => B.chatEvents.some((e) => e?.payload?.text === text), { timeout: 8000 });
}

describe('governance/report propagation over a REAL relay', () => {
  beforeAll(async () => { relay = await startJourneyRelay(); RELAY = relay.url; });
  afterAll(async () => { await relay?.close?.(); });

  it('broadcastCircleGovernance A -> B ingests the vote event over the relay', async () => {
    const A = await bootRealAgentNode('A');
    const aCidHolder = {};
    const B = await bootRealAgentNode('B', {
      verifyGovernanceBinding: async ({ author, ref }) => ref === A.pubKey && author === aCidHolder.pubKey,
    });
    await connectAgentsOverRelay(A, B, { relayUrl: RELAY });
    await pairCircle(A, B);
    await warmMesh(A, B);

    // The legacy-group harness records no circleAddress roster rows (that trail binding lands with the
    // membership rider) — the repro pins the ONE genuine binding: A's ref ↔ A's real circle key.
    aCidHolder.pubKey = (await A.agent.circleIdentityFor('peer-circle')).pubKey;
    // Signed with A's REAL per-circle identity — B's receiver rail verifies before it lands.
    const cid = await A.agent.circleIdentityFor('peer-circle');
    const event = signSpine(cid, {
      kind: 'propose', circleId: 'peer-circle', subject: 'p-relay',
      payload: { action: 'removeMember', subject: 'x', by: A.pubKey, authorRef: A.pubKey, at: 1 },
      parent: null,
    });
    const r = await A.agent.callSkill('stoop', 'broadcastCircleGovernance', { groupId: 'peer-circle', event, msgId: `gov:${event.body.hash}` });
    expect(r?.sent, `broadcast should send over the relay: ${JSON.stringify(r)}`).toBeGreaterThan(0);

    const got = await until(() => B.chatEvents.some((e) => e?.type === 'governance' && e?.payload?.body?.subject === 'p-relay'), { timeout: 8000 });
    expect(got, 'B ingested the governance event over the relay').toBeTruthy();
    await teardown(A, B);
  });

  it('broadcastCircleReport A -> B ingests the report event over the relay', async () => {
    const A = await bootRealAgentNode('A');
    const B = await bootRealAgentNode('B');
    await connectAgentsOverRelay(A, B, { relayUrl: RELAY });
    await pairCircle(A, B);
    await warmMesh(A, B);

    const event = { kind: 'report', event: 'report', reportId: 'r-relay', targetType: 'member', targetRef: 'x', reason: 'spam', by: 'A' };
    const r = await A.agent.callSkill('stoop', 'broadcastCircleReport', { groupId: 'peer-circle', event, msgId: reportEntryId(event) });
    expect(r?.sent).toBeGreaterThan(0);

    const got = await until(() => B.chatEvents.some((e) => e?.type === 'report' && e?.payload?.reportId === 'r-relay'), { timeout: 8000 });
    expect(got, 'B ingested the report event over the relay').toBeTruthy();
    await teardown(A, B);
  });
});
