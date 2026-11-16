/**
 * A MESSAGE FOR A CIRCLE I HAVE NOT OPENED SINCE THE START WAITS, THE CIRCLE IS PROVED, AND IT LANDS.
 *
 * A start no longer reads every circle's roster at once: the circle on screen goes first and the rest follow one at a
 * time (the start queue). So a co-member's message can reach a circle of mine whose roster this device has not read
 * since it started. It must not be let in unchecked, and it must not be lost: the envelope is held under the circle,
 * the circle's roster is read (and proved) because of it, and the held envelope is judged once more and lands.
 *
 * The real factory over a real relay; the device RESTARTS on what a shell keeps on its disk (the vaults, the registry,
 * the circle stores, the device log), so the second circle is cold the way it is after a real start. Carol writes in
 * that circle before anything on my device has read it.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle, bindCircleAddresses, sendCircleChat, until, teardown } from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { EventLog } from '../src/eventLog.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OPENED = 'cold-start-opened';
const COLD = 'cold-start-cold';
const log = () => new EventLog({ initial: [], muted: [] });
const textsIn = (node, cid) => node.chatRail.storedStatements(cid).map((s) => s?.body?.payload?.text).filter(Boolean);

describe('a message for a circle not read since the start', () => {
  let relay; const nodes = [];
  afterAll(async () => { await teardown(...nodes); await relay?.close?.(); });

  it('waits, the circle is proved, and it lands', async () => {
    relay = await startJourneyRelay();
    // what a shell keeps on its disk across a restart
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cold-circle-'));
    const ownerRootVault = new VaultMemory();
    const disk = {
      ownerRootVault, rootKeyStore: new RootKeyStoreVault({ vault: ownerRootVault }), chatVault: new VaultMemory(),
      registryBackend: createMemoryBackend(),
      pinboardPersistDb: { path: path.join(dir, 'pinboard-state.json') },
      householdPersistDb: { path: path.join(dir, 'household-state.json') },
      deviceLog: log(),
    };
    const first = await bootRealAgentNode('me-first', { agentOpts: disk });
    const carol = await bootRealAgentNode('carol', { agentOpts: { deviceLog: log() } });
    nodes.push(carol);
    await connectNodesOverRelay([first, carol], { relayUrl: relay.url });
    for (const cid of [OPENED, COLD]) {
      await createCircle(first, { groupId: cid, name: cid });
      await bindCircleAddresses([first], cid);
      expect((await joinExistingCircle(first, carol, { groupId: cid, handle: 'carol' })).joined.ok).toBe(true);
      for (const n of [first, carol]) { await bindCircleAddresses([n], cid); await bindCircleAddressKeysFor({ agent: n.agent, circleId: cid }); }
    }
    // the stores write behind; the restart comes after the write has landed
    await until(async () => (fs.existsSync(path.join(dir, 'pinboard-state.json')) && !fs.existsSync(path.join(dir, 'pinboard-state.json.tmp'))) || null, { timeout: 10_000, step: 100 });
    await new Promise((r) => { setTimeout(r, 500); });
    await teardown(first);

    // THE RESTART: the same disk, a new process. The roster reads run in turn; the walk holds the cold circle's turn
    // back (a test seam on the read line only), as a start with many circles would keep it waiting
    let releaseCold = () => {};
    const coldTurn = new Promise((r) => { releaseCold = r; });
    const me = await bootRealAgentNode('me', { agentOpts: { ...disk, rosterReadLineGate: (cid) => (cid === COLD ? coldTurn : undefined) } });
    nodes.push(me);
    await me.agent.connectPeerTransport({ relayUrl: relay.url, onPeerMessage: (env) => me._routerRef.fn?.(env), awaitRelayReady: true });
    await bindCircleAddresses([me], OPENED, COLD);
    await me.agent.callSkill('pinboard', 'listGroupMembers', { groupId: OPENED });
    const before = me.agent.circleSenderAuthorization().unknownRosterRefusals;

    const sent = await sendCircleChat(carol, { groupId: COLD, msgId: 'carol-cold-1', text: 'ben je er?' });
    expect(sent?.error ?? null, JSON.stringify(sent)).toBe(null);

    const landed = await until(async () => (textsIn(me, COLD).includes('ben je er?') ? true : null), { timeout: 20_000, step: 200 });
    const after = me.agent.circleSenderAuthorization();
    expect(after.unknownRosterRefusals, 'it waited: the circle had not been read when it arrived').toBeGreaterThan(before);
    expect(landed, `it landed after the circle was proved (senders: ${JSON.stringify(after)})`).toBe(true);
    releaseCold();
    // and the circle is now known, with carol on it
    const members = (await me.agent.callSkill('pinboard', 'listGroupMembers', { groupId: COLD }))?.members ?? [];
    expect(members.some((m) => m.webid === carol.pubKey)).toBe(true);
  }, 240_000);
});
