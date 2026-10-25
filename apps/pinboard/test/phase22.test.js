/**
 * Pinboard — post relevance (`scorePostRelevance`): does a post meet what I offer, answered on this device only.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighbourhoodAgent } from '../src/index.js';

const ANNE = 'https://id.example/anne';

async function callSkill(agent, skillId, args) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     ANNE,
    agent,
    envelope: null,
  });
}

async function buildBundle({ offers = null } = {}) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:    [{ webid: ANNE }],
    // what Anne offers, as the host judges it on her device (her drivers; here: a category)
    ...(offers ? { matchesMine: async (_circleId, post) => post?.categoryId === offers } : {}),
  });
  await bundle.offeringMatch.start();
  return bundle;
}

describe('scorePostRelevance', () => {
  it('scorePostRelevance: a post outside what I offer does not match (no learned profile behind it)', async () => {
    const bundle = await buildBundle({ offers: 'tuinieren' });
    const r = await callSkill(bundle.agent, 'scorePostRelevance', {
      text:       'iemand die fiets band kan repareren?',
      categoryId: 'vervoer',
    });
    expect(r).toEqual({ matched: false, reason: 'no-offering-match' });
  });

  it('scorePostRelevance: Layer 1 hit short-circuits', async () => {
    const bundle = await buildBundle({ offers: 'vervoer' });
    const r = await callSkill(bundle.agent, 'scorePostRelevance', {
      text:       'fiets repareren',
      categoryId: 'vervoer',
    });
    expect(r.matched).toBe(true);
    expect(r.via).toBe('offering');
  });
});

describe('scorePostRelevance answers this device only', () => {
  // It now answers over the person's PRIVATE offerings (the host's matchesMine): from a peer it would be an oracle over
  // them — per category, and per circle a peer may name. Only the device's own calls get a verdict.
  it('a peer\'s task is refused; the shell\'s own call answers', async () => {
    const bundle = await buildBundle({ offers: 'vervoer' });
    const def = bundle.agent.skills.get('scorePostRelevance');
    const ask = (from, extra = {}) => def.handler({ parts: [DataPart({ text: 'fiets?', categoryId: 'vervoer', ...extra })], from, agent: bundle.agent, envelope: null });
    const own = await ask(ANNE);
    expect(own.matched).toBe(true);
    const peer = await ask('https://id.example/bob');
    expect(peer.matched).toBeUndefined();
    expect(peer.error).toBe('not-yours');
    const probe = await ask('https://id.example/bob', { circleId: 'someone-elses-circle' });
    expect(probe.error).toBe('not-yours');
  });
});
