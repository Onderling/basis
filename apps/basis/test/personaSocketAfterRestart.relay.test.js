/**
 * A PERSONA'S CIRCLE SPEAKS AGAIN AFTER A RESTART. A persona is on its circle's relay on a socket of its own (never the
 * general persona's: that would show the relay the two are one device). The join opens that socket
 * (`bindCirclePersona`); nothing opened it again at the next start, so after a restart every line in the persona's
 * circle waited ("this persona has no connection yet") and nothing addressed to it arrived. Found by the phone's
 * personas walk (apps/basis-mobile/e2e/personas.test.js). At connect the agent now opens each persona's socket on the
 * relay points of the circles it holds.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, createCircle, until, teardown } from './support/pairRealAgents.js';
import { EventLog } from '../src/eventLog.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const W = 'werk-circle';

describe("a persona's own socket after a restart", () => {
  let relay; const nodes = [];
  afterAll(async () => { await teardown(...nodes); await relay?.close?.(); });

  it("the next start opens the persona's socket on its circle's relay again", { timeout: 90_000 }, async () => {
    relay = await startJourneyRelay();
    // what a shell keeps on its disk across a restart: the vaults, the registry, the circle stores, the device log
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-socket-'));
    const disk = {
      ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(),
      pinboardPersistDb: { path: path.join(dir, 'pinboard-state.json') },
      householdPersistDb: { path: path.join(dir, 'household-state.json') },
      // the shell's record of which relay each circle rides (the connection points)
      circlePointsFor: (cid) => (cid === W ? [relay.url] : []),
    };
    const log = new EventLog({ initial: [], muted: [] });
    const first = await bootRealAgentNode('first', { agentOpts: { ...disk, deviceLog: log } });
    await first.agent.connectPeerTransport({ relayUrl: relay.url, onPeerMessage: () => {}, awaitRelayReady: true });
    const w = (await first.agent.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    expect((await first.agent.callSkill('household', 'bindCirclePersona', { circleId: W, personaId: w, relayUrl: relay.url })).ok).toBe(true);
    await createCircle(first, { groupId: W, name: 'Werk' });
    const personaKey = first.agent.persona(w).chatId.pubKey;
    const onRelay = (node) => { try { return node.agent.sa.relays.list({ identity: personaKey }).map((r) => r.url); } catch { return []; } };
    expect(onRelay(first), 'the join opened the persona socket').toContain(relay.url);
    await until(async () => (fs.existsSync(path.join(dir, 'pinboard-state.json')) && !fs.existsSync(path.join(dir, 'pinboard-state.json.tmp'))) || null, { timeout: 10_000, step: 100 });
    await teardown(first);

    const again = await bootRealAgentNode('again', { agentOpts: { ...disk, deviceLog: log } });
    nodes.push(again);
    expect(again.agent.circleSelf(W).webid, 'W is still the persona\'s').toBe(personaKey);
    await again.agent.connectPeerTransport({ relayUrl: relay.url, onPeerMessage: () => {}, awaitRelayReady: true });
    const reopened = await until(async () => (onRelay(again).includes(relay.url) ? true : null), { timeout: 10_000, step: 200 }).catch(() => null);
    expect(onRelay(again), "after the restart the persona is on its circle's relay again").toContain(relay.url);
    expect(reopened).toBe(true);
    // asked again for the same (relay, persona) — as a circle that maps to the persona after the connect does — it is
    // the SAME socket, never a second one
    await again.agent.sa.relays.add(relay.url, { identity: again.agent.persona(w).chatId, awaitReady: true });
    expect(onRelay(again).filter((u) => u === relay.url), 'one socket per relay and persona').toHaveLength(1);
  });
});
