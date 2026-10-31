/**
 * ONE DEVICE, ONE SELF PER CIRCLE. A device holds each circle as exactly one of the person's personas. A second join of a
 * circle this device is already in, as another persona, is REFUSED with a plain line — it used to go through and orphan
 * the first membership: still on the co-members' rosters, while the device could no longer speak, read or be reached as
 * it there. Two personas of one person in one circle is done from two devices.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, joinExistingCircle, createCircle, bindCircleAddresses, until, teardown, readRoster } from './support/pairRealAgents.js';
import { buildCircleInviteUri, joinCircleFromInvite } from '../src/v2/circleInvite.js';
import { EventLog } from '../src/eventLog.js';

const C = 'one-device-both-personas';
const log = () => new EventLog({ initial: [], muted: [] });
const rowOf = (roster, webid) => roster.find((m) => (m?.webid ?? m?.id) === webid) ?? null;

describe('one device, a circle it is already in, joined again as another persona', () => {
  let relay; let phone; let cor; let w; let second; let rebind;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    [phone, cor] = await Promise.all([
      bootRealAgentNode('phone', { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), allowAddressFallback: false, deviceLog: log() } }),
      bootRealAgentNode('cor', { agentOpts: { allowAddressFallback: false, deviceLog: log() } }),
    ]);
    await connectNodesOverRelay([phone, cor], { relayUrl: relay.url });
    await createCircle(cor, { groupId: C, name: 'De straat' });
    expect((await joinExistingCircle(cor, phone, { groupId: C, handle: 'thuis' })).joined?.ok).toBe(true);
    await bindCircleAddresses([phone, cor], C);
    w = (await phone.agent.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    // the same phone tries the same circle again, as Werk — through the wizard's own path
    const invite = await buildCircleInviteUri({ callSkill: (a, o, x) => cor.agent.callSkill(a, o, x), circleId: C, adminPeerAddr: cor.pubKey });
    second = await joinCircleFromInvite({
      inviteUri: invite.uri, callSkill: (a, o, x) => phone.agent.callSkill(a, o, x), sendPeerRedeem: phone.sendPeerRedeem,
      handle: 'werk', rulesAccepted: true, persona: w,
      circleAddressFor: (cid) => phone.agent.circleAddressFor(cid), signCircleLink: (s, d, a) => phone.agent.signCircleLink?.(s, d, a) ?? null,
    });
    // …and the bind itself, as any other caller would reach it
    rebind = await phone.agent.callSkill('household', 'bindCirclePersona', { circleId: C, personaId: w });
  }, 240_000);

  afterAll(async () => { await teardown(phone, cor); await relay?.close?.(); });

  it('the second join is refused, naming the persona the device is already there as', () => {
    expect({ reason: second?.reason ?? second?.error ?? null, errorKey: second?.errorKey ?? null })
      .toEqual({ reason: 'already-in-as-another-persona', errorKey: 'circle.join.wizard.persona.already_in' });
    expect({ ok: rebind?.ok, reason: rebind?.reason, personaId: rebind?.personaId })
      .toEqual({ ok: false, reason: 'already-in-as', personaId: 'default' });
  });

  it('nothing is orphaned: the device is still the default in C, and Cor holds one member of it', async () => {
    const def = phone.agent.persona('default').chatId.pubKey;
    const W = phone.agent.persona(w).chatId.pubKey;
    expect((await phone.agent.callSkill('pinboard', 'whoAmI', { groupId: C }))?.webid).toBe(def);
    expect(phone.agent.circleAddressFor(C)).toBe(phone.agent.persona('default').circleAddressFor(C));
    const r = await readRoster(cor, C);
    expect({ default: !!rowOf(r, def), werk: !!rowOf(r, W) }).toEqual({ default: true, werk: false });
  });
});
