/**
 * The noticeboard listing is a list of POSTS. A circle's other rows — its rules head, its trail, and above all the
 * admin's membership code (with the code in it) — never come out of it: a screen, the chat route or a digest that
 * lists "open requests" must not be able to show a circle's invite code. Asked for one type, it answers that type —
 * except a secret one, which no listing hands out.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { isNoticeboardPostType } from '@onderling/item-types';
import { createNeighbourhoodAgent } from '../src/index.js';

const ANNE = 'https://id.example/anne';
const call = (agent, id, args) => agent.skills.get(id).handler({ parts: [DataPart(args ?? {})], from: ANNE, agent, envelope: null });

async function bundleWithCircle() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const b = await createNeighbourhoodAgent({ identity: id, transport: new InternalTransport(new InternalBus(), id.pubKey),
    offeringMatch: { group: 'kring', localActor: ANNE, peers: [] }, members: [{ webid: ANNE }] });
  await b.offeringMatch.start();
  const made = await call(b.agent, 'createGroupV2', { groupId: 'kring', name: 'Kring', rules: { purpose: 'test' } });
  expect(made?.error, JSON.stringify(made)).toBeUndefined();
  await call(b.agent, 'postRequest', { text: 'wie heeft een ladder', intent: 'ask', groupId: 'kring', expectClaims: 0, timeoutMs: 1 });
  return b;
}

describe('listOpenRequests lists posts only', () => {
  it('no filter: posts, and never the code row or the rules head', async () => {
    const b = await bundleWithCircle();
    const items = (await call(b.agent, 'listOpenRequests', {}))?.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    expect(items.filter((i) => !isNoticeboardPostType(i)).map((i) => i.type)).toEqual([]);
    expect(JSON.stringify(items)).not.toMatch(/"code":/);
  });

  it('asked for a type, it answers that type; a secret type is never handed out', async () => {
    const b = await bundleWithCircle();
    const rules = (await call(b.agent, 'listOpenRequests', { type: 'group-rules' }))?.items ?? [];
    expect(rules.map((i) => i.type)).toEqual(['group-rules']);
    expect((await call(b.agent, 'listOpenRequests', { type: 'membership-code' }))?.items ?? []).toEqual([]);
  });
});
