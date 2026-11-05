/**
 * A MAIN KEY NEVER TALKS TO A CIRCLE ADDRESS — tapped at a real relay over boot, create, join (as the default self and
 * as a persona) and a circle message.
 *
 * A circle address exists so that no relay can tie a person's circles together, or tie a circle to the person. A
 * frame whose sender is someone's main key and whose recipient is a circle address hands the relay exactly that link
 * — even when the recipient refuses it. Measured before this test: 11 such frames in every run (the circle fan's
 * address announce and membership broadcast right after a create or a join), all from one place: the transport, asked
 * to send AS a circle address it did not hold yet (not bound on that socket), swapped in the main address instead.
 * The rule: the transport never substitutes an identity — the send waits for the address to be bound.
 *
 * Production here: the real factory (twice), the real relay transport, the create and join paths the wizards use (as
 * a persona: `bindCirclePersona`, then the redeem), the chat rail + circle fan the shells sign circle messages with.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle, bindCircleAddresses, until, teardown, readRoster,
} from './support/pairRealAgents.js';
import { buildCircleInviteUri, joinCircleFromInvite } from '../src/v2/circleInvite.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { EventLog } from '../src/eventLog.js';

const X = 'circle-x-default';
const Y = 'circle-y-persona';

describe('no main key ever sends to a circle address', () => {
  let relay; let anne; let cor; let W;
  /** every `send` frame the relay received: its sender (`_from`, bound to the socket) and its recipient */
  const frames = [];

  beforeAll(async () => {
    relay = await startJourneyRelay();
    relay.tapFrames((raw) => {
      let msg; try { msg = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)); } catch { return; }
      if (msg?.type === 'send' && msg.envelope) frames.push({ p: msg.envelope._p ?? null, from: msg.envelope._from ?? null, to: msg.to ?? null });
    });
    [anne, cor] = await Promise.all([
      bootRealAgentNode('anne', { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), allowAddressFallback: false, deviceLog: new EventLog({ initial: [], muted: [] }) } }),
      bootRealAgentNode('cor', { agentOpts: { allowAddressFallback: false, deviceLog: new EventLog({ initial: [], muted: [] }) } }),
    ]);
    await connectNodesOverRelay([anne, cor], { relayUrl: relay.url });
    await createCircle(cor, { groupId: X, name: 'Straat' });
    await createCircle(cor, { groupId: Y, name: 'Werk' });
    await joinExistingCircle(cor, anne, { groupId: X, handle: 'anne-x' });
    const personaId = (await anne.agent.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    W = anne.agent.persona(personaId);
    expect((await anne.agent.callSkill('household', 'bindCirclePersona', { circleId: Y, personaId, relayUrl: relay.url })).ok).toBe(true);
    const invite = await buildCircleInviteUri({ callSkill: (a, o, x) => cor.agent.callSkill(a, o, x), circleId: Y, adminPeerAddr: cor.pubKey });
    const joined = await joinCircleFromInvite({
      inviteUri: invite.uri, callSkill: (a, o, x) => anne.agent.callSkill(a, o, x), sendPeerRedeem: anne.sendPeerRedeem,
      handle: 'anne-y', rulesAccepted: true, persona: personaId,
      circleAddressFor: (cid) => anne.agent.circleAddressFor(cid), signCircleLink: (s, d, a) => anne.agent.signCircleLink?.(s, d, a) ?? null,
    });
    expect(joined?.error ?? null, JSON.stringify(joined)).toBe(null);
    for (const n of [cor, anne]) {
      await bindCircleAddresses([n], X, Y);
      for (const c of [X, Y]) await bindCircleAddressKeysFor({ agent: n.agent, circleId: c });
    }
    const ts = Date.now();
    const res = await anne.agent.chatRail.appendMessage(X, { msgId: 'x-1', ts, text: 'hallo straat' });
    await anne.agent.callSkill('pinboard', 'broadcastCircleChatStatement', { groupId: X, event: res.statement, msgId: 'x-1', ts });
    await until(async () => cor.chatRail.storedStatements(X).find((st) => st?.body?.payload?.text === 'hallo straat') ?? null, { timeout: 20_000, step: 200 });
  }, 180_000);

  afterAll(async () => {
    await teardown(anne, cor);
    await relay?.close?.();
  });

  it('no frame from any main key reaches any circle address', () => {
    const names = {
      [anne.agent.identity.chat.pubKey]: 'anne-main', [W.chatId.pubKey]: 'persona-main', [cor.agent.identity.chat.pubKey]: 'cor-main',
      [anne.agent.circleAddressFor(X)]: 'anne-X', [W.circleAddressFor(Y)]: 'persona-Y', [cor.agent.circleAddressFor(X)]: 'cor-X', [cor.agent.circleAddressFor(Y)]: 'cor-Y',
    };
    const mains = new Set(['anne-main', 'persona-main', 'cor-main']);
    const circles = new Set(['anne-X', 'persona-Y', 'cor-X', 'cor-Y']);
    expect(frames.length, 'the tap saw the traffic').toBeGreaterThan(10);
    const mixed = frames.filter((f) => mains.has(names[f.from]) && circles.has(names[f.to])).map((f) => `${f.p} ${names[f.from]} -> ${names[f.to]}`);
    expect(mixed).toEqual([]);
  });

  it('what had to wait still arrived: Cor holds both of Anne\'s circle addresses and her X message', async () => {
    const xRow = await until(async () => (await readRoster(cor, X)).find((m) => m?.webid === anne.agent.identity.chat.pubKey && m?.circleAddress === anne.agent.circleAddressFor(X)) ?? null, { timeout: 20_000 });
    const yRow = await until(async () => (await readRoster(cor, Y)).find((m) => m?.webid === W.chatId.pubKey && m?.circleAddress === W.circleAddressFor(Y)) ?? null, { timeout: 20_000 });
    expect(xRow, 'Anne\'s X address on Cor\'s X roster').toBeTruthy();
    expect(yRow, 'the persona\'s Y address on Cor\'s Y roster').toBeTruthy();
    expect(cor.chatRail.storedStatements(X).some((st) => st?.body?.payload?.text === 'hallo straat'), 'the X message landed').toBe(true);
  }, 60_000);
});
