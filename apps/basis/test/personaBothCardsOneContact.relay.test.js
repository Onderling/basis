/**
 * A CONTACT WHO HOLDS BOTH OF YOUR PERSONAS. Cor met Anna twice: once she handed over her own card, once her Werk card.
 * Cor's book now holds two people. A persona exists so that nothing Cor holds lets him tell they are one person: the two
 * cards, and the two book rows they make, share no chat key, person key, authority key or device id — and when each of
 * Anna's selves writes, the pair circle that forms is a different one, derived from a different key.
 *
 * Production here: the real factory (twice), the real relay, the card each self hands out (`getContactShareQr`), the
 * scan (`addContactFromQr`), the contact thread and the pair roster.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown } from './support/pairRealAgents.js';
import { pairCircleIdFor } from '../src/v2/pairRoster.js';
import { EventLog } from '../src/eventLog.js';

describe('a contact holding both personas of one person', () => {
  let relay; let anna; let cor; let werkId;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    anna = await bootRealAgentNode('anna', { contactChannel: true, pairRoster: true, agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), deviceLog: new EventLog({ initial: [], muted: [] }) } });
    cor = await bootRealAgentNode('cor', { contactChannel: true, pairRoster: true, agentOpts: { deviceLog: new EventLog({ initial: [], muted: [] }) } });
    await connectNodesOverRelay([anna, cor], { relayUrl: relay.url });
    werkId = (await anna.agent.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    await anna.agent.sa.relays.add(relay.url, { identity: anna.agent.persona(werkId).chatId, awaitReady: true });
    // Cor scans both cards
    for (const persona of ['default', werkId]) {
      const card = await anna.agent.callSkill('pinboard', 'getContactShareQr', { persona });
      expect(typeof card?.payload === 'string' && card.payload.startsWith('onderling-contact://'), `a ${persona} card`).toBe(true);
      expect((await cor.agent.callSkill('pinboard', 'addContactFromQr', { payload: card.payload }))?.error ?? null).toBe(null);
    }
  }, 120_000);

  afterAll(async () => { await teardown(anna, cor); await relay?.close?.(); });

  /** Everything public of one of Anna's selves. */
  const materialOf = (pid) => {
    const s = anna.agent.persona(pid);
    const m = {
      chat: s.chatId.pubKey,
      personKey: s.personKeyPubOf?.(s.personKey ?? s.initialPersonKey) ?? null,
      authority: s.authorityPubKeyB64 ?? null,
      wireDevice: s.enrolledDevice?.deviceId ?? null,
    };
    for (const [k, v] of Object.entries(m)) expect(v, `${pid} has a ${k}`).toBeTruthy();
    return m;
  };
  const rowsOf = async () => (await cor.agent.callSkill('pinboard', 'listContacts', {}))?.contacts ?? [];

  it('Cor\'s book holds two people, and neither row carries anything of the other', async () => {
    const a = materialOf('default'); const w = materialOf(werkId);
    for (const k of Object.keys(a)) expect(w[k], `the two selves differ in ${k}`).not.toBe(a[k]);
    const rows = await rowsOf();
    const rowA = rows.find((c) => c.webid === a.chat); const rowW = rows.find((c) => c.webid === w.chat);
    expect(!!rowA && !!rowW, 'two rows in Cor\'s book').toBe(true);
    for (const [k, v] of Object.entries(w)) expect(JSON.stringify(rowA).includes(v), `Anna's row carries Werk's ${k}`).toBe(false);
    for (const [k, v] of Object.entries(a)) expect(JSON.stringify(rowW).includes(v), `Werk's row carries Anna's ${k}`).toBe(false);
  }, 60_000);

  it('each self that writes forms its own pair circle with Cor, from its own key', async () => {
    const a = materialOf('default'); const w = materialOf(werkId);
    const circles = { default: pairCircleIdFor(a.chat, cor.pubKey), werk: pairCircleIdFor(w.chat, cor.pubKey) };
    expect(circles.werk).not.toBe(circles.default);
    // Anna files Cor under Werk and writes; Cor answers Werk — the circle that forms is Werk's
    await anna.agent.callSkill('pinboard', 'addContact', { webid: cor.pubKey, pubKey: cor.pubKey, displayName: 'Cor' });
    expect((await anna.agent.callSkill('pinboard', 'setContactPersona', { webid: cor.pubKey, persona: werkId }))?.error ?? null).toBe(null);
    await anna.contactThreadChannel.sendTurn({ peerAddr: cor.pubKey, threadId: cor.pubKey, text: 'hoi Cor, van het werk', messageId: 'w-1' }).sent;
    await cor.contactThreadChannel.sendTurn({ peerAddr: w.chat, threadId: w.chat, text: 'hoi collega', messageId: 'w-2' }).sent;
    const mine = async () => ((await anna.agent.callSkill('pinboard', 'listMyCircles', {}))?.circles ?? []).map((c) => (typeof c === 'string' ? c : c?.groupId));
    expect(await until(async () => ((await mine()).includes(circles.werk) ? true : null), { timeout: 30_000, step: 300 }), 'Werk\'s pair circle with Cor').toBe(true);
    expect(await mine()).not.toContain(circles.default);
    // what reached Cor from Werk names nothing of the default self
    const thread = JSON.stringify((await cor.contactThreadChannel.rehydrate(w.chat)) ?? []);
    for (const [k, v] of Object.entries(a)) expect(thread.includes(v), `Werk's thread at Cor carries Anna's ${k}`).toBe(false);
  }, 90_000);
});
