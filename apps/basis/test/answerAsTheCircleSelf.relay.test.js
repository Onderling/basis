/**
 * AN ANSWER TO A POST LEAVES AS THE SELF THE POST'S CIRCLE KNOWS — over a real relay.
 *
 * Anne is in circle X as her default self and in circle Y as a persona. Cor posts on both noticeboards; Anne answers
 * each ("Help with"). The answer is a 1:1 message to the poster, and it must come from the self that circle knows:
 * in X the default self, in Y the persona — never the default's key in the persona's circle, which would tie the two
 * together for Cor and for the relay. Walked on two phones: in the persona's circle the answer did not leave at all
 * (`recipient-pubkey-unknown` — the call acted as the default self, which is not a member there).
 *
 * Production here: the real factory (twice), the real relay transport, the join as a persona (`bindCirclePersona`,
 * then the redeem), the noticeboard's own ops (`postRequest`, `respondToItem`), the circle store a screen opens.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle, bindCircleAddresses, until, teardown,
} from './support/pairRealAgents.js';
import { buildCircleInviteUri, joinCircleFromInvite } from '../src/v2/circleInvite.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';

const X = 'circle-x-default';
const Y = 'circle-y-persona';

describe('an answer to a post leaves as the circle\'s self', () => {
  let relay; let anne; let cor; let W;
  const sends = [];

  /** Cor posts in a circle; Anne (with that circle open) answers it; the frames Anne sent meanwhile, by whose key */
  async function answerIn(circleId, text) {
    anne.agent.circleStoreFor(circleId);   // the circle open on Anne's screen, as a shell opens it
    await cor.agent.callSkill('pinboard', 'postRequest', { intent: 'ask', text, groupId: circleId });
    const post = await until(async () => ((await anne.agent.callSkill('pinboard', 'listOpenRequests', {}))?.items ?? [])
      .find((i) => (i.text ?? i.body) === text) ?? null, { timeout: 20_000, step: 300 });
    expect(post, 'the post reached Anne').toBeTruthy();
    const mark = sends.length;
    const r = await anne.agent.callSkill('pinboard', 'respondToItem', { itemId: post.id, body: 'ik help' });
    await new Promise((res) => setTimeout(res, 3000));
    const names = { [anne.agent.identity.chat.pubKey]: 'anne-main', [W.chatId.pubKey]: 'persona-main' };
    return { r, from: [...new Set(sends.slice(mark).map((s) => names[s.from]).filter(Boolean))].sort() };
  }

  beforeAll(async () => {
    relay = await startJourneyRelay();
    relay.tapFrames((raw) => {
      let msg; try { msg = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)); } catch { return; }
      if (msg?.type === 'send' && msg.envelope) sends.push({ from: msg.envelope._from ?? null, to: msg.to ?? null });
    });
    [anne, cor] = await Promise.all([
      bootRealAgentNode('anne', { itemsLane: true, contactChannel: true, agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), allowAddressFallback: false } }),
      bootRealAgentNode('cor', { itemsLane: true, contactChannel: true, agentOpts: { allowAddressFallback: false } }),
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
  }, 180_000);

  afterAll(async () => {
    await teardown(anne, cor);
    await relay?.close?.();
  });

  it('in the persona\'s circle: the answer goes out, from the persona\'s key, nothing from the default\'s', async () => {
    const { r, from } = await answerIn(Y, 'wie heeft een boormachine?');
    expect(r?.error ?? null, JSON.stringify(r)).toBe(null);
    expect(from, 'the answer left as the persona').toContain('persona-main');
    expect(from, 'nothing from the default self while answering in the persona\'s circle').not.toContain('anne-main');
    // …and it ARRIVED at Cor, from the persona's key (what the harness's router hands on, with its verified sender;
    // recording "who answered" on the post is a shell's chat door, composed on mobile only — not this harness)
    const got = await until(async () => cor.received.find((m) => JSON.stringify(m.payload ?? {}).includes('ik help') && m.from === W.chatId.pubKey) ?? null, { timeout: 20_000, step: 200 });
    expect(got, 'Cor received the answer from the persona').toBeTruthy();
    expect(JSON.stringify(got.payload).includes(anne.agent.identity.chat.pubKey), 'nothing of the default self inside the answer').toBe(false);
  }, 90_000);

  it('in the default\'s circle: unchanged — the answer leaves as the default self', async () => {
    const { r, from } = await answerIn(X, 'kan iemand mijn plant water geven?');
    expect(r?.error ?? null, JSON.stringify(r)).toBe(null);
    expect(from).toContain('anne-main');
    expect(from).not.toContain('persona-main');
  }, 90_000);
});
