// Drivers #5 — postRequest persists an OPTIONAL explicit driverSignature on the item source (so peers'
// on-device matchers can prefer it over the text/skillTags fallback). Additive + absent-safe.
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '../src/index.js';

const ADMIN = 'https://id.example/admin';
const GROUP = 'oosterpoort';

async function callSkill(agent, skillId, args, from = ADMIN) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
}
async function buildBundle() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({ identity: id, transport: tx, offeringMatch: { group: GROUP, localActor: ADMIN, peers: [] }, members: [{ webid: ADMIN, role: 'admin' }] });
  await bundle.offeringMatch.start();
  return bundle;
}

describe('postRequest — explicit driverSignature (#5)', () => {
  it('persists a driverSignature on the item source when provided', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'postRequest', {
      text: 'anyone up for sailing?', intent: 'ask',
      driverSignature: { text: 'learn to sail', tags: ['sailing', 'learning'] },
    });
    const items = await bundle.itemStore.listOpen({});
    const post = items.find((i) => i?.source?.driverSignature);
    expect(post?.source?.driverSignature).toEqual({ text: 'learn to sail', tags: ['sailing', 'learning'] });
  });

  it('omits the field entirely when absent (back-compat) or malformed', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'postRequest', { text: 'plain post', intent: 'ask' });
    await callSkill(bundle.agent, 'postRequest', { text: 'bad sig', intent: 'ask', driverSignature: ['not', 'an', 'object'] });
    const items = await bundle.itemStore.listOpen({});
    expect(items.every((i) => !('driverSignature' in (i.source ?? {})))).toBe(true);
  });
});
