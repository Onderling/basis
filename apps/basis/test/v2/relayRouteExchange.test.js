// Relay-route cross-device exchange — SELF-CONTAINED regression for the "two devices
// talk over a relay" path. Boots an in-process ws relay (in-memory, no native deps, no
// external :8787 dependency), connects two REAL node agents to it RELAY-ONLY, and asserts
// the full exchange rides the relay end-to-end:
//   • a genuine invite → group-redeem round-trip (the join handshake),
//   • a circle chat message,
//   • a Wave C governance vote event (broadcastCircleGovernance → the one log replicates),
//   • a §8 report event (broadcastCircleReport).
//
// Why this exists: the mobile shell only reached this path after the /set-relay persist fix
// (asyncStorageRelayIo `.save`, commit 7de8b661) let the phone actually dial the relay. This
// guards the transport+propagation mechanism the phone shares — no phone/adb needed.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startRelay } from '@onderling/relay';
import {
  bootRealAgentNode, connectAgentsOverRelay, pairCircle, until, teardown, sendCircleChat } from '../support/pairRealAgents.js';
import { signSpine } from '@onderling/core';
import { reportEntryId } from '../../src/v2/reportModel.js';

const GROUP = 'circle-relay-route';
const rnd = () => Math.random().toString(36).slice(2, 8);

describe('relay-route cross-device exchange (self-contained relay)', () => {
  let relay, admin, joiner, joined;
  const adminCidHolder = {};

  beforeAll(async () => {
    // In-process relay on an OS-assigned port — no external :8787, no sqlite.
    relay = await startRelay({ port: 0, log: false });
    const relayUrl = `ws://127.0.0.1:${relay.port}`;

    admin = await bootRealAgentNode('admin');
    // The legacy-group harness records no circleAddress roster rows (that trail binding lands with the
    // membership rider) — the joiner's receive rail gets the ONE genuine binding pinned explicitly.
    joiner = await bootRealAgentNode('joiner', {
      verifyGovernanceBinding: async ({ author, ref }) => ref === admin.pubKey && author === adminCidHolder.pubKey,
    });
    // RELAY-ONLY: connect both agents to the in-process relay (no NKN).
    await connectAgentsOverRelay(admin, joiner, { relayUrl });

    // Real invite → group-redeem round-trip over the relay (createGroupV2 + redeem).
    ({ joined } = await pairCircle(admin, joiner, { groupId: GROUP, name: 'Circle (relay route)', handle: 'joiner' }));

    // Warm the secure mesh (HI handshake) with a chat message so later broadcasts route.
    const warm = `warmup-${rnd()}`;
    await sendCircleChat(admin, { groupId: GROUP, msgId: `w-${rnd()}`, text: warm });
    await until(() => joiner.chatEvents.some((e) => e?.payload?.text === warm), { timeout: 10000 });
  }, 30000);

  afterAll(async () => {
    try { await teardown(admin, joiner); } catch { /* best-effort */ }
    try { await relay?.stop(); } catch { /* best-effort */ }
  });

  it('join: the joiner redeemed the invite over the relay (real group-redeem round-trip)', () => {
    expect(joined).toBeTruthy();
  });

  it('chat: a circle message reached the joiner over the relay', () => {
    // Established in beforeAll (warm-up), asserted here for a distinct signal.
    expect(joiner.chatEvents.some((e) => e?.type === 'circleChatMessage' || e?.payload?.text?.startsWith('warmup-'))).toBe(true);
  });

  it('governance: a Wave C vote event replicates admin -> joiner over the relay', async () => {
    const gid = `g-${rnd()}`;
    // Signed with the admin's REAL per-circle identity — the joiner's rail verifies before it lands.
    const cid = await admin.agent.circleIdentityFor(GROUP);
    adminCidHolder.pubKey = cid.pubKey;
    const event = signSpine(cid, {
      kind: 'propose', circleId: GROUP, subject: gid,
      payload: { action: 'removeMember', subject: 'x', by: admin.pubKey, authorRef: admin.pubKey, at: 1 },
      parent: null,
    });
    await admin.agent.callSkill('stoop', 'broadcastCircleGovernance', { groupId: GROUP, event, msgId: `gov:${event.body.hash}` });
    const got = await until(
      () => joiner.chatEvents.some((e) => e?.type === 'governance' && e?.payload?.body?.subject === gid),
      { timeout: 10000 },
    );
    expect(got, 'joiner ingested the governance vote event over the relay').toBeTruthy();
  }, 20000);

  it('report: a §8 report event replicates admin -> joiner over the relay', async () => {
    const rid = `r-${rnd()}`;
    const event = { kind: 'report', event: 'report', reportId: rid, targetType: 'member', targetRef: 'x', reason: 'spam', by: admin.pubKey };
    await admin.agent.callSkill('stoop', 'broadcastCircleReport', { groupId: GROUP, event, msgId: reportEntryId(event) });
    const got = await until(
      () => joiner.chatEvents.some((e) => e?.type === 'report' && e?.payload?.reportId === rid),
      { timeout: 10000 },
    );
    expect(got, 'joiner ingested the report event over the relay').toBeTruthy();
  }, 20000);
});
