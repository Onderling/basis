/**
 * A CIRCLE JOINED AS A PERSONA KEEPS ITS NAME AFTER A RESTART. The phone's personas walk
 * (apps/basis-mobile/e2e/personas.test.js) joined Cor's "Werk Kring" as a new persona; after the app restarted, the
 * circle's title read its id. The same join as the general persona kept the name. The launcher reads a circle's name
 * from `listMyCircles`' `names`, so that is what is checked here, before and after a restart from the same disk.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, createCircle, until, teardown } from './support/pairRealAgents.js';
import { buildCircleInviteUri, joinCircleFromInvite } from '../src/v2/circleInvite.js';
import { EventLog } from '../src/eventLog.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const NAME = 'Werk Kring';

async function namesAfterRestart({ asPersona }) {
  const relay = await startJourneyRelay();
  const C = asPersona ? 'werk-kring-persona' : 'werk-kring-default';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-name-'));
  // what a shell keeps on its disk across a restart: the vaults, the registry, the circle stores, the device log
  const disk = {
    ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(),
    pinboardPersistDb: { path: path.join(dir, 'pinboard-state.json') },
    householdPersistDb: { path: path.join(dir, 'household-state.json') },
    allowAddressFallback: false,
  };
  const log = new EventLog({ initial: [], muted: [] });
  const nodes = [];
  try {
    const [phone, cor] = await Promise.all([
      bootRealAgentNode('phone', { agentOpts: { ...disk, deviceLog: log } }),
      bootRealAgentNode('cor', { agentOpts: { allowAddressFallback: false, deviceLog: new EventLog({ initial: [], muted: [] }) } }),
    ]);
    nodes.push(phone, cor);
    await connectNodesOverRelay([phone, cor], { relayUrl: relay.url });
    await createCircle(cor, { groupId: C, name: NAME });
    const persona = asPersona ? (await phone.agent.callSkill('agents', 'createProfile', { name: 'Werk' })).id : undefined;
    // the wizard's "who joins" step binds the circle to the persona at the invite's relay before the redeem (the shells'
    // join host does this; the persona's own socket opens there)
    if (persona) expect((await phone.agent.callSkill('household', 'bindCirclePersona', { circleId: C, personaId: persona, relayUrl: relay.url })).ok).toBe(true);
    const invite = await buildCircleInviteUri({ callSkill: (a, o, x) => cor.agent.callSkill(a, o, x), circleId: C, adminPeerAddr: cor.pubKey });
    const joined = await joinCircleFromInvite({
      inviteUri: invite.uri, callSkill: (a, o, x) => phone.agent.callSkill(a, o, x), sendPeerRedeem: phone.sendPeerRedeem,
      handle: 'werk', rulesAccepted: true, ...(persona ? { persona } : {}),
      circleAddressFor: (cid) => phone.agent.circleAddressFor(cid), signCircleLink: (s, d, a) => phone.agent.signCircleLink?.(s, d, a) ?? null,
    });
    expect(joined?.ok, JSON.stringify(joined)).toBe(true);
    const before = await phone.agent.callSkill('pinboard', 'listMyCircles', {});
    const file = path.join(dir, 'pinboard-state.json');
    await until(async () => (fs.existsSync(file) && !fs.existsSync(`${file}.tmp`)) || null, { timeout: 10_000, step: 100 });
    await new Promise((r) => setTimeout(r, 500));
    await teardown(phone);
    nodes.splice(nodes.indexOf(phone), 1);

    const again = await bootRealAgentNode('again', { agentOpts: { ...disk, deviceLog: log } });
    nodes.push(again);
    const after = await again.agent.callSkill('pinboard', 'listMyCircles', {});
    return { C, before, after };
  } finally {
    await teardown(...nodes);
    await relay?.close?.();
  }
}

describe("a circle joined as a persona keeps its name after a restart", () => {
  afterAll(() => {});

  it('as the general persona: the name before and after (the control)', { timeout: 120_000 }, async () => {
    const { C, before, after } = await namesAfterRestart({ asPersona: false });
    expect({ before: before?.names?.[C] ?? null, after: after?.names?.[C] ?? null, listed: (after?.circles ?? []).includes(C) })
      .toEqual({ before: NAME, after: NAME, listed: true });
  });

  it('as a new persona: the name before and after', { timeout: 120_000 }, async () => {
    const { C, before, after } = await namesAfterRestart({ asPersona: true });
    expect({ before: before?.names?.[C] ?? null, after: after?.names?.[C] ?? null, listed: (after?.circles ?? []).includes(C) })
      .toEqual({ before: NAME, after: NAME, listed: true });
  });
});
