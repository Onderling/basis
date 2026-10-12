/**
 * A CONTACT KNOWS ONE OF YOU: the persona a contact is filed under is WHO they talk to — its own
 * key, its own pair circle — not a lens over the default's address. The phone files Cor under persona B and writes:
 * Cor receives it from B, with no byte of the default anywhere in what arrives, and the pair circle that forms is the
 * one B and Cor derive (`pairCircleIdFor(B, Cor)`), never the default's.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown } from './support/pairRealAgents.js';
import { pairCircleIdFor } from '../src/v2/pairRoster.js';
import { EventLog } from '../src/eventLog.js';
import { decodeContactCard } from '../src/v2/contactCardLink.js';

describe('a contact filed under a persona talks to that persona', () => {
  let relay; let phone; let cor; let B; let personaId;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    phone = await bootRealAgentNode('phone', { contactChannel: true, pairRoster: true, agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), deviceLog: new EventLog({ initial: [], muted: [] }) } });
    cor = await bootRealAgentNode('cor', { contactChannel: true, pairRoster: true, agentOpts: { deviceLog: new EventLog({ initial: [], muted: [] }) } });
    await connectNodesOverRelay([phone, cor], { relayUrl: relay.url });
    personaId = (await phone.agent.callSkill('agents', 'createProfile', { name: 'Buurt' })).id;
    B = phone.agent.persona(personaId);
    // B is on the relay on its own socket (a persona speaks only on its own)
    await phone.agent.sa.relays.add(relay.url, { identity: B.chatId, awaitReady: true });
    // the phone files Cor under B (the add sheet's persona choice)
    await phone.agent.callSkill('stoop', 'addContact', { webid: cor.pubKey, pubKey: cor.pubKey, displayName: 'Cor' });
    expect((await phone.agent.callSkill('stoop', 'setContactPersona', { webid: cor.pubKey, persona: personaId }))?.error ?? null).toBe(null);
  }, 120_000);

  afterAll(async () => { await teardown(phone, cor); await relay?.close?.(); });

  it('Cor receives the turn from B — never from the default, and nothing of the default rides along', async () => {
    const A = phone.pubKey;
    const before = cor.received.length;   // (the harness's own connect greets everyone first — not the contact's doing)
    await phone.contactThreadChannel.sendTurn({ peerAddr: cor.pubKey, threadId: cor.pubKey, text: 'hoi Cor, hier de buurman', messageId: 't-1' }).sent;
    // Cor's thread is keyed by the sender's identity: the turn is in B's thread, and the default has none
    const inB = await until(async () => ((await cor.contactThreadChannel.rehydrate(B.chatId.pubKey)) ?? []).find((t) => t.text === 'hoi Cor, hier de buurman') ?? null, { timeout: 20_000, step: 200 });
    expect(inB, 'Cor has it from B').toBeTruthy();
    expect(((await cor.contactThreadChannel.rehydrate(A)) ?? []).length, 'and nothing from the default').toBe(0);
    // ...and nothing of the default reached Cor at all: not in what arrived, not in Cor's book
    expect(JSON.stringify(cor.received.slice(before)).includes(A), 'no byte of the default in what reached Cor since the turn').toBe(false);
    const book = JSON.stringify((await cor.agent.callSkill('stoop', 'listContacts', {})) ?? {});
    expect(book.includes(A), 'the default is not in Cor\'s book').toBe(false);
  }, 60_000);

  it('the pair circle that forms is B\'s with Cor, never the default\'s', async () => {
    const mine = pairCircleIdFor(B.chatId.pubKey, cor.pubKey);
    const theDefaults = pairCircleIdFor(phone.pubKey, cor.pubKey);
    // a reply from Cor drives the roster (whoever founds, the id is the two webids')
    await cor.contactThreadChannel.sendTurn({ peerAddr: B.chatId.pubKey, threadId: B.chatId.pubKey, text: 'hoi buurman', messageId: 't-2' }).sent;
    const formed = await until(async () => {
      const ids = ((await phone.agent.callSkill('stoop', 'listMyCircles', {}))?.circles ?? []).map((c) => (typeof c === 'string' ? c : c?.groupId));
      return ids.includes(mine) ? true : null;
    }, { timeout: 30_000, step: 300 });
    expect(formed, 'the pair circle B–Cor exists on the phone').toBe(true);
    const ids = ((await phone.agent.callSkill('stoop', 'listMyCircles', {}))?.circles ?? []).map((c) => (typeof c === 'string' ? c : c?.groupId));
    expect(ids).not.toContain(theDefaults);
    expect(phone.agent.circleSelf(mine).webid, 'and it is B\'s').toBe(B.chatId.pubKey);
  }, 90_000);

  it('Cor\'s book learns B from B\'s own card — B\'s key, B\'s address — and nothing of the default', async () => {
    const A = phone.pubKey;
    const row = await until(async () => (((await cor.agent.callSkill('stoop', 'listContacts', {}))?.contacts ?? []).find((c) => c.webid === B.chatId.pubKey) ?? null), { timeout: 20_000, step: 200 });
    expect(row, 'Cor has a contact row for B, from the card the turn carried').toBeTruthy();
    expect(JSON.stringify(row).includes(A), 'B\'s card carries no byte of the default').toBe(false);
    // the card the phone hands out AS B, inspected whole
    const card = await phone.agent.callSkill('stoop', 'getContactShareQr', { persona: personaId });
    const decoded = decodeContactCard(card?.payload);
    expect(decoded, 'a card').toBeTruthy();
    const text = JSON.stringify(decoded);
    expect(text.includes(A), 'the persona card names nothing of the default').toBe(false);
    expect(text.includes(B.chatId.pubKey), 'it names B').toBe(true);
  }, 60_000);
});
