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
  beforeAll(async () => {
    relay = await startJourneyRelay();
    const opts = () => ({ contactChannel: true, agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() } });
    [me, ann] = await Promise.all([bootRealAgentNode('me', opts()), bootRealAgentNode('ann', opts())]);
    await connectNodesOverRelay([me, ann], { relayUrl: relay.url });
    await addCardOf(me, ann); await addCardOf(ann, me);
  }, 120_000);
  afterAll(async () => { await teardown(me, ann); await relay?.close?.(); });

  it('her device answers once; my row says she cannot receive it yet; a repeat is not answered again', async () => {
    const answers = [];
    const real = ann.agent.sendPeerMessage;
    // count what her agent sends back (her not-understood rides her own send gate)
    const sa = ann.agent.sa.peer;
    const sendTo = sa.sendTo;
    sa.sendTo = (to, payload, o) => { if (payload?.subtype === 'not-understood') answers.push(payload); return sendTo(to, payload, o); };
    try {
      await me.agent.sendPeerMessage(ann.pubKey, { subtype: 'from-the-future', msgId: 'f1' });
      expect(await until(() => { const l = me.agent.notUnderstoodBy(ann.pubKey); return l.length ? l : null; }, { timeout: 10_000, step: 100 }), 'her answer reached me')
        .toEqual(['from-the-future']);
      await me.agent.sendPeerMessage(ann.pubKey, { subtype: 'from-the-future', msgId: 'f2' });
      await tick(1500);
      expect(answers, 'once per peer and subtype per start').toHaveLength(1);
      expect(answers[0]).toEqual({ subtype: 'not-understood', of: 'from-the-future' });
    } finally { sa.sendTo = sendTo; ann.agent.sendPeerMessage = real; }

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
