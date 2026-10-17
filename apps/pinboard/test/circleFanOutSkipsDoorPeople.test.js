/**
 * A person admitted at a bot's DOOR (a keyless contact row: `telegram:<uid>`, a channel, a role, no key) is never a
 * peer a circle's traffic is fanned to.
 *
 * Found walking the household bot on the tablet (2026-09-29): the bot's own household circle has no membership trail
 * (nobody ever joined it), so the fan fell back to the device's global MemberMap — and the contact book's rows are
 * there, the door person's included. Every list write was then "fanned" to `telegram:6834468878` over the relay: a
 * HI handshake that can never be answered, three failed deliveries, "written off until presence". A keyless row has
 * no address; the fan now skips it on every branch (roster or fallback).
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '../src/index.js';

const ME = 'pk-me';
const PEER = 'pk-peer';
const DOOR = 'telegram:6834468878';

async function buildBundle({ members, sends }) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'household', localActor: ME, peers: [] },
    members,
    reliableSend: async (addr) => { sends.push(addr); return { held: false, delivered: true }; },
  });
  await bundle.offeringMatch.start();
  return bundle;
}

describe('the circle fan-out and a door person', () => {
  it('a circle with no trail fans over the member map — but never to a keyless door row', async () => {
    const sends = [];
    const bundle = await buildBundle({
      sends,
      members: [
        { webid: ME, role: 'admin', pubKey: ME },
        { webid: PEER, role: 'member', pubKey: PEER },
        { webid: DOOR, channel: 'telegram', role: 'admin', relation: 'contact', displayName: 'Frits' },
      ],
    });
    const def = bundle.agent.skills.get('broadcastCircleTask');
    await def.handler({ parts: [DataPart({ groupId: 'household', event: { body: { hash: 'h', kind: 'snapshot' }, sig: 's' }, msgId: 'task:h', ts: 1 })], from: ME, agent: bundle.agent, envelope: null });
    expect(sends.some((a) => String(a).startsWith('telegram:')), `sent to ${JSON.stringify(sends)}`).toBe(false);
  });
});
