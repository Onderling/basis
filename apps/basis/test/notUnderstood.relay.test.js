/**
 * AN UNKNOWN SUBTYPE IS ANSWERED, NOT DROPPED. A newer build sends something an older one has no handler for: the older
 * device answers ONE `not-understood` frame (the subtype named, no content), and the sender's contact row says the other
 * side cannot receive it yet. Three limits: a `not-understood` is never answered (no loops); it only goes to a sender that
 * passed the receive gate (the router only ever sees verified envelopes); at most once per peer and subtype per start.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown, addCardOf } from './support/pairRealAgents.js';
import { contactRowMeta, withPeerNotices } from '../src/v2/contactsSource.js';
import { makePeerRouter, NOT_TAKEN } from '../src/core/handlers/peerRouter.js';
import { SecurityLayer, WIRE_VERSION } from '@onderling/core';

const t = (k, v = {}) => `${k}${v.name ? `:${v.name}` : ''}`;
const tick = (ms) => new Promise((r) => { setTimeout(r, ms); });

describe('the router names a subtype nobody took', () => {
  it('no handler and no fallback: not understood, with the subtype', async () => {
    const r = makePeerRouter({ handlers: { known: () => undefined }, logger: {} });
    expect(await r({ from: 'a', payload: { subtype: 'from-the-future' } })).toEqual({ ...NOT_TAKEN, notUnderstood: 'from-the-future' });
    expect(await r({ from: 'a', payload: { subtype: 'known' } })).toBeUndefined();
    expect(await r({ from: 'a', payload: { body: 'no subtype' } })).toEqual(NOT_TAKEN);
  });
  it('a fallback that refuses it: not understood; a fallback that takes it: taken', async () => {
    const refuses = makePeerRouter({ handlers: {}, defaultHandler: () => NOT_TAKEN, logger: {} });
    expect(await refuses({ from: 'a', payload: { subtype: 'x' } })).toEqual({ ...NOT_TAKEN, notUnderstood: 'x' });
    const takes = makePeerRouter({ handlers: {}, defaultHandler: () => undefined, logger: {} });
    expect(await takes({ from: 'a', payload: { subtype: 'x' } })).toBeUndefined();
  });
});

describe('an unknown subtype between two real agents over a relay', () => {
  let relay; let me; let ann;
  const coreOf = (n) => n.agent.sa.agent;
  beforeAll(async () => {
    relay = await startJourneyRelay();
    const opts = () => ({ contactChannel: true, agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() } });
    [me, ann] = await Promise.all([bootRealAgentNode('me', opts()), bootRealAgentNode('ann', opts())]);
    await connectNodesOverRelay([me, ann], { relayUrl: relay.url });
    await addCardOf(me, ann); await addCardOf(ann, me);
  }, 120_000);
  afterAll(async () => { await teardown(me, ann); await relay?.close?.(); });

  /** Count the not-understood answers a node's agent sends (they ride its own send gate, then the secure agent). */
  function countAnswers(node) {
    const answers = [];
    const peer = node.agent.sa.peer;
    const sendTo = peer.sendTo;
    peer.sendTo = (to, payload, o) => { if (payload?.subtype === 'not-understood') answers.push(payload); return sendTo(to, payload, o); };
    return { answers, restore: () => { peer.sendTo = sendTo; } };
  }

  it('between two CURRENT builds it is a shell gap: answered once (with her wire), but no words on my row', async () => {
    const { answers, restore } = countAnswers(ann);
    try {
      await me.agent.sendPeerMessage(ann.pubKey, { subtype: 'from-a-sibling-shell', msgId: 's1' });
      expect(await until(() => (answers.length ? answers : null), { timeout: 10_000, step: 100 }), 'she answered')
        .toEqual([{ subtype: 'not-understood', of: 'from-a-sibling-shell', wire: WIRE_VERSION }]);
      await me.agent.sendPeerMessage(ann.pubKey, { subtype: 'from-a-sibling-shell', msgId: 's2' });
      await tick(1500);
      expect(answers, 'once per peer and subtype per start').toHaveLength(1);
      expect(me.agent.notUnderstoodBy(ann.pubKey), 'the same wire is not "an older Basis"').toEqual([]);
    } finally { restore(); }
    const [row] = withPeerNotices([{ contactId: ann.pubKey, name: 'Ann', peerAddr: ann.pubKey, reachable: true }], me.agent);
    expect(contactRowMeta(row, t)).not.toContain('not_understood');
  }, 40_000);

  it('from a NEWER build: her older device answers once, and my row says she cannot receive it yet', async () => {
    // my device as a NEWER build: every envelope it signs carries a wire above hers (she still accepts it: the newer
    // side decides), and it compares answers against that wire
    const mySec = coreOf(me).security;
    const newer = new SecurityLayer({ identity: coreOf(me).identity, wire: WIRE_VERSION + 1 });
    newer.registerPeer(ann.pubKey, mySec.getPeerKey(ann.pubKey) ?? ann.pubKey);
    const realEncrypt = mySec.encrypt;
    mySec.encrypt = (env) => newer.encrypt(env);
    Object.defineProperty(mySec, 'wire', { value: WIRE_VERSION + 1, configurable: true });
    const { answers, restore } = countAnswers(ann);
    try {
      await me.agent.sendPeerMessage(ann.pubKey, { subtype: 'from-the-future', msgId: 'f1' });
      expect(await until(() => { const l = me.agent.notUnderstoodBy(ann.pubKey); return l.length ? l : null; }, { timeout: 10_000, step: 100 }), 'her answer reached me')
        .toEqual(['from-the-future']);
      expect(answers).toEqual([{ subtype: 'not-understood', of: 'from-the-future', wire: WIRE_VERSION }]);
    } finally { restore(); mySec.encrypt = realEncrypt; delete mySec.wire; }
    const [row] = withPeerNotices([{ contactId: ann.pubKey, name: 'Ann', peerAddr: ann.pubKey, reachable: true }], me.agent);
    expect(contactRowMeta(row, t)).toContain('circle.contacts.not_understood:Ann');
  }, 40_000);

  it('a not-understood is never answered, even one about a subtype nobody knows', async () => {
    const sent = [];
    const sa = me.agent.sa.peer;
    const sendTo = sa.sendTo;
    sa.sendTo = (to, payload, o) => { if (payload?.subtype === 'not-understood') sent.push(payload); return sendTo(to, payload, o); };
    try {
      await ann.agent.sendPeerMessage(me.pubKey, { subtype: 'not-understood', of: 'something-else' });
      await tick(1500);
      expect(sent).toHaveLength(0);
    } finally { sa.sendTo = sendTo; }
  }, 20_000);
});
