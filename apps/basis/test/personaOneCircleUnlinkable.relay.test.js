/**
 * TWO PERSONAS OF ONE PERSON IN ONE CIRCLE, AND A CO-MEMBER WHO HOLDS BOTH ROWS — over a real relay.
 *
 * Anna's phone runs her default persona; her laptop is enrolled holding only her persona Werk. Both join Cor's circle C:
 * the phone as the default, the laptop as Werk. A persona exists so that Cor, who sees both members, cannot tell they
 * are one person. That is a claim about KEYS, so it is asserted on what Cor holds: the two rows share no chat identity,
 * no per-circle address, no person key, no ceremony commitment and no device id — and neither row carries any byte of
 * the other's public material. The membership statements Cor folded for them are signed by different keys too.
 *
 * Production here: the real factory (three agents), the real relay, the enrol ceremony with the persona picked, the join
 * AS a persona through the wizard's own path (the bind before the redeem), the membership lane Cor folds.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, joinExistingCircle, createCircle, bindCircleAddresses, until, teardown, readRoster } from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { buildCircleInviteUri, joinCircleFromInvite } from '../src/v2/circleInvite.js';
import { EventLog } from '../src/eventLog.js';

const C = 'one-circle-two-personas';
const log = () => new EventLog({ initial: [], muted: [] });
const rowOf = (roster, webid) => roster.find((m) => (m?.webid ?? m?.id) === webid) ?? null;

describe('two personas of one person in one circle, seen by the co-member', () => {
  let relay; let phone; let laptop; let cor; let w;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    [phone, cor] = await Promise.all([
      bootRealAgentNode('phone', { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), allowAddressFallback: false, deviceLog: log() } }),
      bootRealAgentNode('cor', { agentOpts: { allowAddressFallback: false, deviceLog: log() } }),
    ]);
    await connectNodesOverRelay([phone, cor], { relayUrl: relay.url });
    // Cor's circle; the phone joins as the default
    await createCircle(cor, { groupId: C, name: 'Een kring' });
    expect((await joinExistingCircle(cor, phone, { groupId: C, handle: 'anna' })).joined?.ok).toBe(true);
    const phrase = (await phone.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    w = (await phone.agent.callSkill('agents', 'createProfile', { name: 'Werk' })).id;

    // the laptop: enrolled with the phrase, holding Werk only
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() };
    const pre = await bootRealAgentNode('laptop-pre', { agentOpts: { ...vaults } });
    expect((await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'laptop', personas: [w] })).ok).toBe(true);
    await teardown(pre);
    laptop = await bootRealAgentNode('laptop', { agentOpts: { ...vaults, allowAddressFallback: false, deviceLog: log() } });
    await connectNodesOverRelay([laptop], { relayUrl: relay.url });
    // …and joins as Werk (the wizard's path: bind, then redeem)
    expect((await laptop.agent.callSkill('household', 'bindCirclePersona', { circleId: C, personaId: w, relayUrl: relay.url })).ok).toBe(true);
    const invite = await buildCircleInviteUri({ callSkill: (a, o, x) => cor.agent.callSkill(a, o, x), circleId: C, adminPeerAddr: cor.pubKey });
    const joined = await joinCircleFromInvite({
      inviteUri: invite.uri, callSkill: (a, o, x) => laptop.agent.callSkill(a, o, x), sendPeerRedeem: laptop.sendPeerRedeem,
      handle: 'werkanna', rulesAccepted: true, persona: w,
      circleAddressFor: (cid) => laptop.agent.circleAddressFor(cid), signCircleLink: (s, d, a) => laptop.agent.signCircleLink?.(s, d, a) ?? null,
    });
    expect(joined?.error ?? null, JSON.stringify(joined)).toBe(null);
    for (const n of [cor, phone, laptop]) {
      await bindCircleAddresses([n], C);
      await bindCircleAddressKeysFor({ agent: n.agent, circleId: C });
    }
  }, 240_000);

  afterAll(async () => { await teardown(phone, laptop, cor); await relay?.close?.(); });

  /** Everything public a self shows in C, as this device knows it. */
  const materialOf = (node, personaId) => {
    const self = node.agent.persona(personaId);
    return {
      chat: self?.chatId?.pubKey ?? null,
      address: node.agent.circleAddressFor(C),
      personKey: self?.personKeyPubOf?.(self.personKey ?? self.initialPersonKey) ?? null,
      authority: self?.authorityPubKeyB64 ?? null,
      wireDevice: self?.enrolledDevice?.deviceId ?? null,
      commitment: node.agent.ceremonyCommitmentFor?.(C) ?? null,
    };
  };

  it('Cor holds two members whose keys, addresses and devices share nothing', async () => {
    const a = materialOf(phone, 'default');
    const b = materialOf(laptop, w);
    for (const k of Object.keys(a)) {
      expect(a[k], `the default has a ${k}`).toBeTruthy();
      expect(b[k], `Werk has a ${k}`).toBeTruthy();
      expect(JSON.stringify(b[k]), `the two selves differ in ${k}`).not.toBe(JSON.stringify(a[k]));
    }
    const rowA = await until(async () => rowOf(await readRoster(cor, C), a.chat), { timeout: 20_000, step: 200 });
    const rowB = await until(async () => rowOf(await readRoster(cor, C), b.chat), { timeout: 20_000, step: 200 });
    expect(rowA, "Cor's roster has the default").toBeTruthy();
    expect(rowB, "Cor's roster has Werk").toBeTruthy();
    // neither row carries any byte of the other self's public material
    const textA = JSON.stringify(rowA); const textB = JSON.stringify(rowB);
    for (const [k, v] of Object.entries(a)) if (typeof v === 'string' && v.length >= 16) expect(textB.includes(v), `Werk's row carries the default's ${k}`).toBe(false);
    for (const [k, v] of Object.entries(b)) if (typeof v === 'string' && v.length >= 16) expect(textA.includes(v), `the default's row carries Werk's ${k}`).toBe(false);
    // the person keys Cor folded for them differ
    if (rowA.personKey?.pubKey && rowB.personKey?.pubKey) expect(rowB.personKey.pubKey).not.toBe(rowA.personKey.pubKey);
  }, 60_000);

  it('the membership statements Cor folded for them are signed by different keys, naming different selves', async () => {
    const stmts = await until(async () => {
      const list = await cor.agent.membershipRail?.storedStatements?.(C);
      return Array.isArray(list) && list.length >= 3 ? list : null;
    }, { timeout: 20_000, step: 200 });
    expect(stmts, 'Cor holds the circle\'s membership statements').toBeTruthy();
    const a = materialOf(phone, 'default'); const b = materialOf(laptop, w);
    const about = (ref) => stmts.filter((s) => s?.body?.subject === ref);
    expect(about(a.chat).length, 'statements about the default').toBeGreaterThan(0);
    expect(about(b.chat).length, 'statements about Werk').toBeGreaterThan(0);
    // what each self signed itself (its member-props, its address) names nothing of the other
    for (const s of stmts) {
      const text = JSON.stringify(s);
      if (s?.body?.author === a.chat || s?.body?.payload?.authorRef === a.chat) expect(text.includes(b.chat)).toBe(false);
      if (s?.body?.author === b.chat || s?.body?.payload?.authorRef === b.chat) expect(text.includes(a.chat)).toBe(false);
    }
  }, 60_000);
});
