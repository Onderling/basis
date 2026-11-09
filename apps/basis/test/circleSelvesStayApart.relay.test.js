/**
 * TWO CIRCLES, TWO SELVES, ONE CO-MEMBER — WHAT THE CO-MEMBER CAN TIE TOGETHER, over a real relay.
 *
 * The order a person walks it on a phone: Anne joins circle X as her default self (handle `anne-x`), then makes a
 * persona and joins circle Y AS that persona (handle `anne-y`). Cor runs both circles. Anne then writes in X. What a
 * persona exists to prevent is Cor tying `anne-x` to `anne-y`. Walked on two phones: the persona's join renamed the
 * DEFAULT self (the join set "my handle" without naming its circle, so it acted as the general self), and the default's
 * new name reached X — Cor then labelled Anne's X messages with the persona's handle. Four things are read:
 *
 *   - Anne's DEFAULT self after the persona's join: its own handle, and its row in X, as they were;
 *   - the WIRE: every `send` frame the relay receives is tapped, and the frames Anne's device sends in each step are
 *     sorted by the key they leave from (`_from`, the field the relay binds to the socket);
 *   - Cor's NAMES: the label Cor's own roster gives the author of Anne's X message;
 *   - Cor's ROSTERS: no row in X carries the persona's key or handle, no row in Y carries the default's.
 *
 * Production here: the real factory (twice), the real relay transport, the join path the wizard uses (as a persona:
 * `bindCirclePersona` then the redeem), the chat rail + circle fan the shells sign circle messages with, and
 * the sender stamp both shells paint (`memberLabelFor`).
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
import { memberLabelFor } from '../src/v2/circleStream.js';
import { EventLog } from '../src/eventLog.js';

const X = 'circle-x-default';
const Y = 'circle-y-persona';
const short = (k) => (typeof k === 'string' ? `${k.slice(0, 8)}…` : String(k));

describe('two circles, two selves: what the co-member of both can tie together', () => {
  let relay; let anne; let cor; let W; let personaId;
  /** every `send` frame the relay received: who it claims to be from, where it goes */
  const sends = [];
  const facts = {};

  /** Anne's keys, named — so a frame's `_from` reads as WHICH of her selves sent it */
  const anneKeys = () => ({
    'default-main': anne.agent.identity.chat.pubKey,
    'default-in-X': anne.agent.circleAddressFor(X),
    'persona-main': W.chatId.pubKey,
    'persona-in-Y': W.circleAddressFor(Y),
  });
  const nameOf = (k) => Object.entries(anneKeys()).find(([, v]) => v === k)?.[0] ?? null;
  /** the `_from` names of Anne's sends since `mark` */
  const anneSendsSince = (mark) => [...new Set(sends.slice(mark).map((s) => nameOf(s.from)).filter(Boolean))].sort();

  beforeAll(async () => {
    relay = await startJourneyRelay();
    relay.tapFrames((raw) => {
      let msg; try { msg = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)); } catch { return; }
      if (msg?.type === 'send' && msg.envelope) sends.push({ from: msg.envelope._from ?? null, to: msg.to ?? null });
    });
    [anne, cor] = await Promise.all([
      bootRealAgentNode('anne', { itemsLane: true, contactChannel: true, agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), allowAddressFallback: false, deviceLog: new EventLog({ initial: [], muted: [] }) } }),
      bootRealAgentNode('cor', { itemsLane: true, contactChannel: true, agentOpts: { allowAddressFallback: false, deviceLog: new EventLog({ initial: [], muted: [] }) } }),
    ]);
    await connectNodesOverRelay([anne, cor], { relayUrl: relay.url });
    await createCircle(cor, { groupId: X, name: 'Straat' });
    await createCircle(cor, { groupId: Y, name: 'Werk' });

    // 1. X as the default self, as the wizard does without a persona
    await joinExistingCircle(cor, anne, { groupId: X, handle: 'anne-x' });
    const xRowOfDefault = async () => (await readRoster(cor, X)).find((m) => m?.webid === anne.agent.identity.chat.pubKey) ?? null;
    await until(async () => ((await xRowOfDefault())?.handle === 'anne-x' ? true : null), { timeout: 15_000 });
    facts.before = { defaultHandle: (await anne.agent.callSkill('pinboard', 'getMyProfile', {}))?.entry?.handle ?? null, xRow: { handle: (await xRowOfDefault())?.handle ?? null, displayName: (await xRowOfDefault())?.displayName ?? null } };
    // 2. THEN a persona, and Y as that persona (the wizard's path: bind before the redeem)
    personaId = (await anne.agent.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
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
    await until(async () => ((await readRoster(cor, Y)).some((m) => m?.webid === W.chatId.pubKey) ? true : null), { timeout: 15_000 });
  }, 180_000);

  afterAll(async () => {
    await teardown(anne, cor);
    await relay?.close?.();
  });

  it('a join AS a persona leaves the default self as it was — its own handle, and its row in every other circle', async () => {
    // give the default's rider the time it would need to carry a rename into X
    await new Promise((r) => setTimeout(r, 3000));
    const xRow = (await readRoster(cor, X)).find((m) => m?.webid === anne.agent.identity.chat.pubKey) ?? null;
    facts.after = { defaultHandle: (await anne.agent.callSkill('pinboard', 'getMyProfile', {}))?.entry?.handle ?? null, xRow: { handle: xRow?.handle ?? null, displayName: xRow?.displayName ?? null } };
    expect(facts.after.defaultHandle, 'the default self keeps its own handle').toBe('anne-x');
    expect(facts.after.xRow, 'the default\'s row in X is untouched by a join elsewhere').toEqual(facts.before.xRow);
    const yRow = (await readRoster(cor, Y)).find((m) => m?.webid === W.chatId.pubKey) ?? null;
    expect(yRow?.handle, 'the persona is anne-y where it joined').toBe('anne-y');
  }, 60_000);

  it('Anne\'s message in X leaves from her X self and Cor names it anne-x', async () => {
    const mark = sends.length;
    const ts = Date.now();
    const res = await anne.agent.chatRail.appendMessage(X, { msgId: 'x-1', ts, text: 'hallo straat' });
    await anne.agent.callSkill('pinboard', 'broadcastCircleChatStatement', { groupId: X, event: res.statement, msgId: 'x-1', ts });
    const landed = await until(async () => cor.chatRail.storedStatements(X).find((st) => st?.body?.payload?.text === 'hallo straat') ?? null, { timeout: 20_000, step: 200 });
    expect(landed, 'it crossed').toBeTruthy();
    const author = landed.body.payload.authorRef;
    const roster = await readRoster(cor, X);
    facts.message = {
      wireFrom: anneSendsSince(mark), author: nameOf(author) ?? short(author),
      labelOnCor: memberLabelFor(author, { members: roster, viewerId: cor.agent.identity.chat.pubKey }),
    };
    expect(facts.message.wireFrom, 'the X message never leaves from the persona').not.toContain('persona-main');
    expect(facts.message.wireFrom).not.toContain('persona-in-Y');
    expect(facts.message.labelOnCor, 'Cor names the X author as she is in X').toBe('anne-x');
  }, 60_000);

  it('Cor\'s rosters: nothing of the persona in X, nothing of the default in Y — and the X message still reads anne-x', async () => {
    const k = anneKeys();
    const inX = JSON.stringify(await readRoster(cor, X));
    const inY = JSON.stringify(await readRoster(cor, Y));
    facts.rosters = {
      xCarries: ['persona-main', 'persona-in-Y'].filter((n) => inX.includes(k[n])).concat(inX.includes('anne-y') ? ['handle anne-y'] : []),
      yCarries: ['default-main', 'default-in-X'].filter((n) => inY.includes(k[n])).concat(inY.includes('anne-x') ? ['handle anne-x'] : []),
    };
    expect(facts.rosters.xCarries, 'X knows nothing of the persona').toEqual([]);
    expect(facts.rosters.yCarries, 'Y knows nothing of the default').toEqual([]);
    const st = cor.chatRail.storedStatements(X).find((s) => s?.body?.payload?.text === 'hallo straat');
    facts.messageLaterLabel = memberLabelFor(st?.body?.payload?.authorRef, { members: await readRoster(cor, X), viewerId: cor.agent.identity.chat.pubKey });
    expect(facts.messageLaterLabel, 'the X message is still anne-x after everything').toBe('anne-x');
  }, 60_000);
});
