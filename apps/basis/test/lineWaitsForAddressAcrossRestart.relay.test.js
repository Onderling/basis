/**
 * A LINE THAT REACHED SOME MEMBERS AND WAITS FOR ONE WITHOUT AN ADDRESS STILL REACHES THEM AFTER THE SENDER RESTARTS
 * One receipt from someone else does not end the wait.
 *
 * The sender fans a line to the circle while one member's circle address has not reached it yet (in the field: the
 * founder's socket over the relay's rate delays the announcement). The others receive it and one confirms it; the late
 * member is 'no-address'. The sender restarts on the same disk. Then the late member's address lands. The line must
 * reach them: what was still waiting, per recipient, is kept on the device log, not in process memory, and one
 * receipt from someone else does not end it.
 *
 * The only seam: the sender's inbound router holds back the address announcements that carry the late member's
 * address until after the restart, which is what the relay's pacing did. Everything else is the product's own path.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startRelay } from '@onderling/relay';
import { bootPeople, untilTrue } from '../../e2e-journeys/journeys/_app.mjs';
import { createCircle, joinExistingCircle, bindCircleAddresses, sendCircleChat, teardown } from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { propagateCircleAddressesAfterJoin } from '../src/v2/circleAddressAnnounce.js';
import { CHAT_LANE } from '../src/v2/chatManifest.js';
import { EventLog } from '../src/eventLog.js';
import { makeReceiptReceiver } from '../src/v2/deliverySettings.js';
import { RECEIPT_MESSAGE } from '../src/v2/deliveryState.js';
import { createDeliveryStateMap } from '@onderling/kring-host/deliveryState';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GROUP = 'line-waits-restart';
const MSG = `${GROUP}-1`;
const holds = (node) => node.chatEventLog.query({}).some((e) => e?.type === CHAT_LANE && e?.id === MSG);

describe('a line waiting for one member across a restart', () => {
  let relay = null; const nodes = [];
  afterAll(async () => { await teardown(...nodes); await relay?.stop?.(); });

  it('reaches the member whose address lands after the sender restarted', async () => {
    relay = await startRelay({ port: 0 });
    const relayUrl = `ws://127.0.0.1:${relay.port}`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-waits-'));
    const ownerRootVault = new VaultMemory();
    const disk = {
      ownerRootVault, rootKeyStore: new RootKeyStoreVault({ vault: ownerRootVault }), chatVault: new VaultMemory(),
      registryBackend: createMemoryBackend(),
      pinboardPersistDb: { path: path.join(dir, 'pinboard-state.json') },
      householdPersistDb: { path: path.join(dir, 'household-state.json') },
      deviceLog: new EventLog({ initial: [], muted: [] }),
    };
    const [F, S, R, L] = await bootPeople({ relayUrl, handles: ['founder', 'sender', 'receiver', 'late'], agentOptsFor: (h) => (h === 'sender' ? disk : null) });
    nodes.push(F, R, L);
    await createCircle(F, { groupId: GROUP, name: 'Wacht' });
    await bindCircleAddresses([F], GROUP);
    for (const [n, h] of [[S, 'sender'], [R, 'receiver']]) {
      expect((await joinExistingCircle(F, n, { groupId: GROUP, handle: h }))?.joined?.ok, `${h} joined`).toBe(true);
      await bindCircleAddresses([n], GROUP);
    }
    // THE SEAM: from here the sender does not hear the late member's address until after its restart
    const lateAddr = () => L.agent.circleAddressFor(GROUP);
    const live = S._routerRef.fn;
    S._routerRef.fn = (env) => {
      const s = env?.payload?.subtype === 'circle-address-announce' ? JSON.stringify(env.payload) : '';
      return lateAddr() && s.includes(lateAddr()) ? undefined : live(env);
    };
    expect((await joinExistingCircle(F, L, { groupId: GROUP, handle: 'late' }))?.joined?.ok, 'late joined').toBe(true);
    await bindCircleAddresses([L], GROUP);
    for (const n of [F, S, R, L]) await bindCircleAddressKeysFor({ agent: n.agent, circleId: GROUP });
    await untilTrue(async () => ((await S.agent.callSkill('pinboard', 'listGroupMembers', { groupId: GROUP }))?.members ?? []).some((m) => m.webid === L.pubKey), 15000, 200);

    const sent = await sendCircleChat(S, { groupId: GROUP, msgId: MSG, text: 'wacht op jou', ts: Date.now() });
    expect(sent?.error ?? null, 'the line left').toBeNull();
    // the precondition, named: the fan had no address for the late member, and reached the receiver
    const lateOutcome = (sent?.outcomes ?? []).find((o) => o?.webid === L.pubKey)?.outcome ?? 'not a recipient';
    expect(lateOutcome, `the fan's outcome for the late member (all: ${JSON.stringify((sent?.outcomes ?? []).map((o) => o.outcome))})`).toBe('no-address');
    expect(await untilTrue(() => holds(R), 15000, 200), 'the receiver holds the line').toBe(true);
    // the receiver's app confirms it. The harness composes no receipt lane, so the confirmation lands through the
    // product's own reducer, from the receiver's circle address, exactly as the shells' 'delivery-receipt' entry does
    const deliveryMap = createDeliveryStateMap();
    deliveryMap.set(MSG, 'maybe-received');
    const onReceipt = makeReceiptReceiver({
      deliveryMap, eventLog: disk.deviceLog,
      listCircleMembers: async (cid) => (await S.agent.callSkill('pinboard', 'listGroupMembers', { groupId: cid }))?.members ?? [],
    });
    expect(await onReceipt({ subtype: RECEIPT_MESSAGE, messageId: MSG }, R.agent.circleAddressFor(GROUP)), 'the receipt was accepted').toBe(true);
    expect(await untilTrue(() => disk.deviceLog.query({}).some((e) => e?.type === 'delivery-state' && e?.payload?.msgId === MSG && e?.payload?.state === 'stored'), 15000, 200),
      'the receiver confirmed it (a receipt is on the sender\'s log)').toBe(true);
    expect(holds(L), 'the late member does not hold it yet').toBe(false);
    // the sender said, on its log, whom the line still waits for
    const waits = disk.deviceLog.query({}).find((e) => e?.type === 'delivery-state' && e?.payload?.msgId === MSG && e?.payload?.state === 'on-its-way');
    expect(waits?.payload?.waiting ?? null, 'the log names the late member as waiting').toEqual([L.pubKey]);

    // THE RESTART: the same disk, a new process; the seam goes with the old process
    await new Promise((r) => { setTimeout(r, 1500); });   // the stores write behind
    await teardown(S);
    const [S2] = await bootPeople({ relayUrl, handles: ['sender'], agentOptsFor: () => disk });
    nodes.push(S2);
    await bindCircleAddresses([S2], GROUP);
    await bindCircleAddressKeysFor({ agent: S2.agent, circleId: GROUP });
    await S2.agent.callSkill('pinboard', 'listGroupMembers', { groupId: GROUP });

    // who gets the line again after the restart: the waiting member ALONE (the others hold it already; a re-tell to every
    // member per waiting line would be the boot-time burst the narrowing removed)
    const again = new Map([[F, 0], [R, 0]]);
    for (const n of [F, R]) {
      const live = n._routerRef.fn;
      n._routerRef.fn = (env) => {
        if (env?.payload?.subtype === 'circle-chat-statement' && env?.payload?.msgId === MSG) again.set(n, again.get(n) + 1);
        return live(env);
      };
    }
    // the late member's address lands now (the founder tells the circle again, as after a join)
    await propagateCircleAddressesAfterJoin({ agent: F.agent, circleId: GROUP, newMemberWebid: L.pubKey });
    const lateRowHasAddress = async () => ((await S2.agent.callSkill('pinboard', 'listGroupMembers', { groupId: GROUP }))?.members ?? [])
      .some((m) => m.webid === L.pubKey && (m.circleAddress || (m.circleAddresses ?? []).length));
    expect(await untilTrue(lateRowHasAddress, 15000, 200), 'the late member\'s address landed at the restarted sender').toBe(true);
    const reached = await untilTrue(() => holds(L), 30000, 250);
    expect(reached, 'the late member holds the line once their address landed at the restarted sender').toBe(true);
    await new Promise((r) => { setTimeout(r, 1500); });
    expect({ founder: again.get(F), receiver: again.get(R) }, 'members who held it already were not sent it again').toEqual({ founder: 0, receiver: 0 });
  }, 240000);
});
