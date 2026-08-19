/**
 * Verification — circle chat SEND fans through the unified secure-agent reliable path
 * (basis injects `sa.peer.sendTo(..., {guarantee:'hold-forward'})` as `reliableSend`;
 * `broadcastCircleMessage` uses it), and RECORDS through B's REAL receive path — the
 * harness now wires the real `circleChatReceiver → chatMessageInbox` (eventLog +
 * ingestCircleMessage), no stand-in. Plus offline hold-forward for chat.
 */
import { describe, it, expect, afterAll } from 'vitest';

import {
  bootRealAgentNode, connectAgentsOverBus, pairCircle, until, teardown, goOffline, goOnline, sendCircleChat } from '../support/pairRealAgents.js';

describe('circle chat send over the unified secure-agent reliable path', () => {
  let A; let B;
  afterAll(async () => { await teardown(A, B); });

  it('delivers + records A→B, and HOLDS then delivers A→(offline B)', async () => {
    const t0 = Date.now();
    [A, B] = await Promise.all([bootRealAgentNode('A'), bootRealAgentNode('B')]);
    await connectAgentsOverBus(A, B);

    const groupId = 'peer-circle';
    const { joined } = await pairCircle(A, B, { groupId, name: 'Peer Circle', handle: 'peerbee' });
    expect(joined.ok).toBe(true);

    // ── 1. Online delivery + record (via the REAL receiver) ──────────────────
    const t1 = Date.now();
    const msgId = `circle-${groupId}-${Date.now().toString(36)}`;
    const text = `hoi circle vanaf A ${Date.now().toString(36)}`;
    const res = await sendCircleChat(A, { groupId, text, msgId, ts: Date.now() });
    expect(res.error, `broadcastCircleMessage errored: ${res.error}`).toBeUndefined();
    expect(res.sent, `fan-out reached ≥1 recipient — got ${JSON.stringify(res)}`).toBeGreaterThanOrEqual(1);

    // B ingests through its real circleChatReceiver → eventLog (chatEvents).
    const rendered = await until(() => B.chatEvents.find((e) => e.id === msgId));
    expect(rendered, 'B rendered the circle message via the real receiver').toBeTruthy();
    expect(rendered.payload.text, 'top-level text (not body)').toBe(text);
    // The device log IS the durable record now (the store mirror is retired): the landed entry carries
    // the signed statement a cold start re-verifies, and the log persists in production.
    expect(rendered.payload?.statement?.sig, 'the landed message carries its proof').toBeTruthy();
    const onlineMs = Date.now() - t1;

    // ── 2. Offline hold-forward ──────────────────────────────────────────────
    await goOffline(B);
    const t2 = Date.now();
    const msgId2 = `circle-${groupId}-off-${Date.now().toString(36)}`;
    const text2 = `hoi terwijl B offline is ${Date.now().toString(36)}`;
    const res2 = await sendCircleChat(A, { groupId, text: text2, msgId: msgId2, ts: Date.now() });
    expect(res2.error).toBeUndefined();
    expect(res2.sent, 'offline send is HELD (counts as sent)').toBeGreaterThanOrEqual(1);
    expect(B.chatEvents.find((e) => e.id === msgId2), 'held, not delivered while offline').toBeFalsy();

    await goOnline(B, { announceTo: A });
    const gotHeld = await until(() => B.chatEvents.find((e) => e.id === msgId2), { timeout: 6000 });
    expect(gotHeld, 'held circle message delivered on B reconnect').toBeTruthy();
    expect(gotHeld.payload.text).toBe(text2);
    const holdMs = Date.now() - t2;

    // eslint-disable-next-line no-console
    console.log(`[circle-reliable] online-deliver ${onlineMs}ms · offline-hold→flush ${holdMs}ms · total ${Date.now() - t0}ms`);
  }, 30_000);
});
