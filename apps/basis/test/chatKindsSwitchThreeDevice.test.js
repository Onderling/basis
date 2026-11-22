/**
 * THE CHAT LANE'S SWITCH, ON THREE REAL DEVICES WITH A CHANGED SENDER (the switches-bind design, step 4). A circle's
 * conversation kinds are a view filter: a line of a kind the circle has off is kept on the log, and no reader shows it,
 * counts it or turns it into a notification, on any member's device, the sender's own included; switched back on, it
 * shows. Cato's app is changed: it sends a plain chat line where the circle allows asks only, past its own gate.
 *
 * One limit of this harness, said rather than hidden: the record of each circle's kinds that the synchronous readers
 * ask is held per PROCESS, and these three devices share one process. So each device is proved by ITS OWN settings
 * (its policy store, filled by the settings lane) and the one rule every reader asks (`showsInConversation`, which the
 * tile count and the notification rows go through), not by the shared record.
 */
import { describe, it, expect, afterAll } from 'vitest';
import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, bindCircleAddresses, until, teardown, sendInCircle, sendCircleChat,
} from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { keptPolicyChangesOf } from '../src/v2/keptPolicyChanges.js';
import { conversationKindsOf, showsInConversation } from '../src/v2/conversationKinds.js';
import { countsAsUnread } from '../src/v2/circleTilePreviews.js';
import { notificationRows } from '../src/v2/notifications.js';

const CIRCLE = 'chat-kinds-three';
const WARM = { hold: true, firstSendTimeoutMs: 2000, retryDelays: [] };
const LINE = 'a plain chat line where only asks are allowed';
const waitFor = (pred, label, timeout = 20_000) => until(async () => ((await pred()) ? true : null), { timeout, step: 100 }).then((r) => { expect(r, label).toBe(true); });
const keptVersions = (n) => (keptPolicyChangesOf(n.deviceLog, CIRCLE) ?? []).map((b) => b.payload?.version).sort();
const kindsOn = async (n) => conversationKindsOf({ policy: await n.settings.policies.get(CIRCLE) });
const lineOn = (n) => (n.chatEventLog.query({}) ?? []).find((e) => e?.payload?.body === LINE || e?.payload?.text === LINE);

describe('the chat lane: a changed sender posts a kind the circle has off', () => {
  let A; let B; let C;
  afterAll(async () => { await teardown(A, B, C); });

  it('no device shows, counts or notifies it, the sender\'s own included; back on, it shows', async () => {
    const opts = { itemsLane: true, settingsLane: true };
    [A, B, C] = await Promise.all([bootRealAgentNode('A', opts), bootRealAgentNode('B', opts), bootRealAgentNode('C', opts)]);
    await connectNodesOverBus([A, B, C]);
    await createCircle(A, { groupId: CIRCLE, name: 'Alleen vragen' });
    for (const [joiner, handle] of [[B, 'bram'], [C, 'cato']]) {
      const r = await joinExistingCircle(A, joiner, { groupId: CIRCLE, handle });
      expect(r.joined?.ok, JSON.stringify(r.joined)).toBe(true);
    }
    await bindCircleAddresses([A, B, C], CIRCLE);
    await Promise.all([A, B, C].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE })));
    for (const [from, to] of [[A, B], [A, C], [C, A], [C, B]]) {
      await sendInCircle(from, to, CIRCLE, { type: 'p2p-chat', subtype: 'chat-message', msgId: `warm-${from.label}${to.label}`, body: `warm ${from.label}` }, WARM);
      await until(() => to.received.find((m) => m.payload?.body === `warm ${from.label}`), { timeout: 8000 });
    }

    for (const n of [A, B, C]) await n.agent.callSkill('tasks', 'listOpen', { circleId: CIRCLE });   // each opens the circle
    expect(await A.settings.lane.state(CIRCLE), 'the admin states the creation settings').toBeTruthy();
    for (const n of [A, B, C]) await waitFor(() => keptVersions(n).join() === '1', `${n.label} keeps version 1`);

    // ── the admin switches plain chat off: asks only. Every device's own settings know it ──────────────────────────────
    await A.settings.policies.update(CIRCLE, { conversationKinds: ['ask'] });
    expect(await A.settings.lane.state(CIRCLE), 'the admin states it').toBeTruthy();
    for (const n of [A, B, C]) await waitFor(async () => !(await kindsOn(n)).includes('chat-message'), `${n.label}'s settings have chat off`);

    // ── Cato's changed app sends a chat line anyway ──────────────────────────────────────────────────────────────────
    // (its own rail signs the line and the pinboard core fans the statement: no sender gate asked)
    const sent = await sendCircleChat(C, { groupId: CIRCLE, msgId: 'off-1', text: LINE });
    expect(sent?.error, 'Cato\'s app sent it').toBeUndefined();
    for (const n of [A, B]) await waitFor(() => Boolean(lineOn(n)), `${n.label} holds the line on its log (kept, not dropped)`);

    for (const n of [A, B]) {
      const ev = lineOn(n);
      const kinds = await kindsOn(n);
      expect(showsInConversation(ev, kinds), `${n.label} does not show it`).toBe(false);
      expect(countsAsUnread(ev, { myRefs: [] }), `${n.label} does not count it`).toBe(false);
      const rowsOf = () => notificationRows({ events: n.chatEventLog.query({}), circles: [{ id: CIRCLE, name: 'Alleen vragen' }], myRefs: [], t: (k) => k, fold: false }) ?? [];
      expect(rowsOf().some((r) => r.id === 'off-1'), `${n.label} makes no notification of it`).toBe(false);
    }
    // the sender's own device: its own settings have chat off too, so its own reader does not show its line either
    expect(showsInConversation(lineOn(C), await kindsOn(C)), 'C, the sender, does not show its own line').toBe(false);

    // ── back on: the line was kept, and now it shows ─────────────────────────────────────────────────────────────────
    await A.settings.policies.update(CIRCLE, { conversationKinds: ['ask', 'chat-message'] });
    expect(await A.settings.lane.state(CIRCLE)).toBeTruthy();
    for (const n of [A, B, C]) await waitFor(async () => (await kindsOn(n)).includes('chat-message'), `${n.label}'s settings have chat on again`);
    for (const n of [A, B]) expect(showsInConversation(lineOn(n), await kindsOn(n)), `${n.label} shows it again`).toBe(true);
    // the shared record the synchronous readers ask is per process here (see the header): once it holds "chat on",
    // the count and the notification take the line, so the two checks above could have failed
    expect(countsAsUnread(lineOn(A), { myRefs: [] }), 'the count takes it when chat is on').toBe(true);
    expect((notificationRows({ events: A.chatEventLog.query({}), circles: [{ id: CIRCLE, name: 'Alleen vragen' }], myRefs: [], t: (k) => k, fold: false }) ?? []).some((r) => r.id === 'off-1'), 'a notification row when chat is on').toBe(true);
  }, 120_000);
});
