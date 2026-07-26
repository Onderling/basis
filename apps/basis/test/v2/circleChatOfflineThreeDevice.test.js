/**
 * Circle chat with one member offline — story 4.2 of `plans/NOTE-multi-device-user-stories.md`.
 *
 * "Anna posts; Bram online, Cato offline → Cato receives on reconnect, in the same order, with no
 * duplicates."
 *
 * `kringChatReliableSend.integration.test.js` proves the mechanism with TWO devices and ONE held message.
 * The story needs three, because the interesting failures only appear with a mixed audience and a burst:
 *   • ORDER — several messages queue while Cato is away; a flush that re-holds a failure, or a Map that
 *     stops being insertion-ordered, silently reorders a conversation. Nothing checked order on the
 *     circle-chat channel (only the DM one, story 4.1).
 *   • DUPLICATES — the sender dedups by `msgId` while holding, the receiver dedups in `chatMessageInbox`,
 *     and the EventLog dedups by entry id. Three layers, none of them tested together on a re-flush.
 *   • The ONLINE member must be unaffected — a held message for Cato must not delay or duplicate Bram's.
 *
 * Real agents over a shared InternalBus (`pairRealAgents.js`), so this drives the production send path
 * (`broadcastKringMessage` → reliableSend → hold-forward) and the production receive path
 * (`kringChatReceiver` → `chatMessageInbox` → EventLog). No stand-ins.
 *
 * Cast: Anna (A, admin/poster) · Bram (B, online throughout) · Cato (C, offline for the burst).
 */
import { describe, it, expect, afterAll } from 'vitest';
import {
  bootRealAgentNode, connectNodesOverBus, pairCircle, until, teardown, goOffline, goOnline,
} from '../support/pairRealAgents.js';

const GROUP = 'peer-circle';
// `chatEvents` is `EventLog.query()`, which returns MOST-RECENT-FIRST. Reversing here means the rest of
// the file can talk about conversation order the way a person reads it — and makes the reversal a stated
// property rather than a silently-passing coincidence.
const oldestFirst = (node) => [...node.chatEvents].reverse();
const bodiesOn = (node) => oldestFirst(node).map((e) => e.payload?.text).filter(Boolean);
const idsOn = (node) => node.chatEvents.map((e) => e.id);

describe('4.2 — Anna posts to a circle with Bram online and Cato offline', () => {
  let A; let B; let C;

  afterAll(async () => { await teardown(A, B, C); });

  it('holds for Cato, delivers to Bram, then flushes IN ORDER with no duplicates', async () => {
    [A, B, C] = await Promise.all([
      bootRealAgentNode('A'), bootRealAgentNode('B'), bootRealAgentNode('C'),
    ]);
    await connectNodesOverBus([A, B, C]);

    // One circle, both others joined through the REAL join flow.
    const joinedB = await pairCircle(A, B, { groupId: GROUP, name: 'Peer Circle', handle: 'bram' });
    expect(joinedB.joined.ok).toBe(true);
    const joinedC = await pairCircle(A, C, { groupId: GROUP, name: 'Peer Circle', handle: 'cato' });
    expect(joinedC.joined.ok).toBe(true);

    // A baseline message everyone gets, so a later empty inbox can't pass as "nothing was sent".
    const warmup = `warmup-${Date.now().toString(36)}`;
    await A.agent.callSkill('stoop', 'broadcastKringMessage', { groupId: GROUP, text: warmup, msgId: warmup, ts: Date.now() });
    await until(() => B.chatEvents.find((e) => e.id === warmup));
    await until(() => C.chatEvents.find((e) => e.id === warmup));

    // ── Cato goes offline; Anna keeps posting ────────────────────────────────
    await goOffline(C);
    const burst = ['een', 'twee', 'drie'].map((word) => ({ text: word, msgId: `burst-${word}` }));
    for (const m of burst) {
      const r = await A.agent.callSkill('stoop', 'broadcastKringMessage',
        { groupId: GROUP, text: m.text, msgId: m.msgId, ts: Date.now() });
      expect(r.error, `send errored: ${r.error}`).toBeUndefined();
    }

    // Bram — ONLINE — has all three already. A held message for one member must not stall the circle.
    for (const m of burst) await until(() => B.chatEvents.find((e) => e.id === m.msgId));
    // …and Cato has none of them yet: held, not delivered, not lost.
    for (const m of burst) expect(C.chatEvents.find((e) => e.id === m.msgId), `${m.msgId} leaked while offline`).toBeFalsy();

    // ── Cato reconnects ──────────────────────────────────────────────────────
    await goOnline(C, { announceTo: A });
    for (const m of burst) await until(() => C.chatEvents.find((e) => e.id === m.msgId), { timeout: 8000 });

    // ORDER: the three arrive as they were sent, not as they happened to flush.
    const catoBurst = bodiesOn(C).filter((t) => ['een', 'twee', 'drie'].includes(t));
    expect(catoBurst).toEqual(['een', 'twee', 'drie']);

    // NO DUPLICATES: exactly one of each, on every device.
    for (const node of [B, C]) {
      const ids = idsOn(node);
      for (const m of burst) {
        expect(ids.filter((id) => id === m.msgId), `${node.label ?? 'node'} has ${m.msgId} more than once`).toHaveLength(1);
      }
    }
  }, 60_000);

  it('a RE-SEND of an already-delivered message does not duplicate it on any device', async () => {
    // The replay a retry or a second flush produces. `chatMessageInbox` dedups on msgId and the EventLog
    // dedups on entry id — this asserts the pair actually holds end to end, which neither unit test does.
    const msgId = `replay-${Date.now().toString(36)}`;
    const text = 'zelfde bericht';

    await A.agent.callSkill('stoop', 'broadcastKringMessage', { groupId: GROUP, text, msgId, ts: Date.now() });
    await until(() => C.chatEvents.find((e) => e.id === msgId));
    const before = idsOn(C).filter((id) => id === msgId).length;
    expect(before).toBe(1);

    // Send the SAME msgId again — the shape a hold-forward flush replays.
    await A.agent.callSkill('stoop', 'broadcastKringMessage', { groupId: GROUP, text, msgId, ts: Date.now() });
    await new Promise((r) => setTimeout(r, 300));      // give a duplicate every chance to land

    expect(idsOn(C).filter((id) => id === msgId)).toHaveLength(1);
    expect(idsOn(B).filter((id) => id === msgId)).toHaveLength(1);
  }, 30_000);

  it('the durable mirror agrees with the live stream — a reconnecting member can rebuild', async () => {
    // `chatEvents` is what the open screen renders; `getMessagesSince` is what a cold start reads. If the
    // held burst only reached the first, Cato would see the conversation until he closed the app.
    const since = await C.agent.callSkill('stoop', 'getMessagesSince', { groupId: GROUP, sinceTs: 0 });
    const texts = (since?.items ?? []).map((m) => m.text).filter(Boolean);
    expect(texts.length, 'the durable mirror is empty — nothing to agree with').toBeGreaterThan(0);
    for (const word of ['een', 'twee', 'drie']) {
      expect(texts, `${word} missing from Cato's durable mirror`).toContain(word);
    }
  }, 30_000);
});
