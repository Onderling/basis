/**
 * An answer to a circle post goes to the poster at the key the circle's ROSTER holds for them. A post read from its
 * circle's own store names its poster by webid only — no carrier stamped a sender key on it — and the global member
 * map is not where a circle's members are known.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '../src/index.js';

const ME = 'pk-me';
const MEL = 'pk-mel';

describe('respondToItem addresses the poster by the circle\'s roster', () => {
  it('a post naming its poster by webid only is answered at the key on the roster', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const tx = new InternalTransport(new InternalBus(), id.pubKey);
    const bundle = await createNeighbourhoodAgent({
      identity: id, transport: tx,
      offeringMatch: { group: 'circle-b', localActor: ME, peers: [] },
      members: [{ webid: ME, role: 'admin', pubKey: ME }],          // Mel is NOT in the global member map
      reliableSend: async () => ({ held: false, delivered: true }),
    });
    await bundle.offeringMatch.start();
    await bundle.itemStore.addItems([
      { type: 'membership-redemption', text: 'joined', visibility: 'household', source: { groupId: 'circle-b', redeemedBy: MEL, signingPublicKey: MEL, circleAddress: 'addr-mel-in-b' } },
    ], { actor: ME });
    // Mel's post, as it reads from the circle store: `from` is the webid, no `fromPubKey`
    const [post] = await bundle.itemStore.addItems([{ type: 'request', text: 'een ladder?', visibility: 'household', source: { groupId: 'circle-b', from: MEL } }], { actor: MEL });
    const call = (op, args) => bundle.agent.skills.get(op).handler({ parts: [DataPart(args)], from: ME, agent: bundle.agent, envelope: null });
    const r = await call('respondToItem', { itemId: post.id, body: 'ik heb er een' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.toPubKey).toBe(MEL);
  });
});
