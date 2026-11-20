/**
 * A LINE NOBODY CONFIRMED GOES OUT AGAIN AFTER THE SENDER RESTARTS — the durable outbox as a projection
 * (`owedChatStatements`, `reFanOwedChat`).
 *
 * The device wires its circles at boot before it has built its chat rail. Until 2026-11-20 such an early circle open
 * returned from the owed re-fan AND was marked done, so the re-fan of a restart never ran: a line sent into a moment
 * when its only recipient heard nothing was lost for good. Now the early open waits and the re-fan runs once the rail
 * exists.
 *
 * The receiver goes DARK while the line is sent (envelopes dropped on the floor, as for a phone that is off), so the
 * line is unconfirmed; the sender restarts on the same disk; the receiver is back. The line must reach it.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startRelay } from '@onderling/relay';
import { bootPeople, goDark, untilTrue } from '../../e2e-journeys/journeys/_app.mjs';
import { createCircle, joinExistingCircle, bindCircleAddresses, sendCircleChat, teardown } from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { owedChatStatements } from '../src/v2/chatRail.js';
import { CHAT_LANE } from '../src/v2/chatManifest.js';
import { EventLog } from '../src/eventLog.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GROUP = 'refan-after-restart';
const MSG = `${GROUP}-1`;
const holds = (node) => node.chatEventLog.query({}).some((e) => e?.type === CHAT_LANE && e?.id === MSG);

describe('an unconfirmed line after the sender restarts', () => {
  let relay = null; const nodes = [];
  afterAll(async () => { await teardown(...nodes); await relay?.stop?.(); });

  it('goes out again and reaches the member who heard nothing the first time', async () => {
    relay = await startRelay({ port: 0 });
    const relayUrl = `ws://127.0.0.1:${relay.port}`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refan-restart-'));
    const ownerRootVault = new VaultMemory();
    const disk = {
      ownerRootVault, rootKeyStore: new RootKeyStoreVault({ vault: ownerRootVault }), chatVault: new VaultMemory(),
      registryBackend: createMemoryBackend(),
      pinboardPersistDb: { path: path.join(dir, 'pinboard-state.json') },
      householdPersistDb: { path: path.join(dir, 'household-state.json') },
      deviceLog: new EventLog({ initial: [], muted: [] }),
    };
    const [S, R] = await bootPeople({ relayUrl, handles: ['sender', 'receiver'], agentOptsFor: (h) => (h === 'sender' ? disk : null) });
    nodes.push(R);
    await createCircle(S, { groupId: GROUP, name: 'Opnieuw' });
    await bindCircleAddresses([S], GROUP);
    expect((await joinExistingCircle(S, R, { groupId: GROUP, handle: 'receiver' }))?.joined?.ok, 'receiver joined').toBe(true);
    await bindCircleAddresses([R], GROUP);
    for (const n of [S, R]) await bindCircleAddressKeysFor({ agent: n.agent, circleId: GROUP });

    const comeBack = goDark(R);
    const sent = await sendCircleChat(S, { groupId: GROUP, msgId: MSG, text: 'hoor je me?', ts: Date.now() });
    expect(sent?.error ?? null, 'the line left').toBeNull();
    await new Promise((r) => { setTimeout(r, 1500); });
    expect(holds(R), 'the dark receiver heard nothing').toBe(false);
    const authorRef = disk.deviceLog.query({}).find((e) => e?.type === CHAT_LANE && e?.id === MSG)?.payload?.statement?.body?.payload?.authorRef;
    expect(owedChatStatements({ eventLog: disk.deviceLog, circleId: GROUP, myRef: authorRef }).map((o) => o.msgId),
      'the sender still owes it (no receipt)').toContain(MSG);

    await new Promise((r) => { setTimeout(r, 1500); });   // the stores write behind
    await teardown(S);
    comeBack();
    const [S2] = await bootPeople({ relayUrl, handles: ['sender'], agentOptsFor: () => disk });
    nodes.push(S2);
    await bindCircleAddresses([S2], GROUP);
    await bindCircleAddressKeysFor({ agent: S2.agent, circleId: GROUP });
    await S2.agent.callSkill('pinboard', 'listGroupMembers', { groupId: GROUP });

    expect(await untilTrue(() => holds(R), 20000, 250), 'the receiver holds the line the restart re-fanned').toBe(true);
  }, 240000);
});
