/**
 * The phone in Node (test/support/mobileNode.js) crosses a real relay socket: two phones, each its own boot, storage
 * and module graph; one phone's direct message lands through the OTHER phone's own inbound wiring
 * (`buildPhoneInboundWiring`, the function ChatScreen calls) — painted into its contact-thread inbox and stored in its
 * thread. This is the seam every M story in the function matrix stands on; if it is red, those stories prove nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startJourneyRelay } from '../../basis/test/support/testRelay.js';
import { bootMobileNode } from './support/mobileNode.js';

const until = async (pred, ms = 15_000) => {
  const t0 = Date.now();
  while (!(await pred())) {
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => { setTimeout(r, 50); });
  }
  return true;
};

describe('a phone in Node, over a real relay', () => {
  let relay; let anna; let bob;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    anna = await bootMobileNode({ name: 'anna', relayUrl: relay.url });
    bob = await bootMobileNode({ name: 'bob', relayUrl: relay.url });
  }, 90_000);

  afterAll(async () => {
    await anna?.dispose(); await bob?.dispose(); await relay?.close();
  });

  it('two phones are two devices: own storage, own identity, both on the relay their settings name', () => {
    expect(anna.storage).not.toBe(bob.storage);
    expect(anna.address).toBeTruthy();
    expect(bob.address).toBeTruthy();
    expect(anna.address).not.toBe(bob.address);
    for (const n of [anna, bob]) {
      expect(n.agent.relay.url).toBe(relay.url);
      expect(n.agent.relays.list().find((r) => r.url === relay.url)?.connected).toBe(true);
    }
  });

  it('a direct message from one phone lands in the other phone\'s contact thread, through its own wiring', async () => {
    // Bob chose Anna (her card in his book): a first message from someone he did not choose is a request instead
    const card = (await anna.agent.callSkill('pinboard', 'getContactShareQr', {}))?.payload;
    expect((await bob.agent.callSkill('pinboard', 'addContactFromQr', { payload: card }))?.error ?? null).toBe(null);
    // …and Anna holds Bob's card: she writes to someone she chose
    const bobCard = (await bob.agent.callSkill('pinboard', 'getContactShareQr', {}))?.payload;
    expect((await anna.agent.callSkill('pinboard', 'addContactFromQr', { payload: bobCard }))?.error ?? null).toBe(null);
    const text = `hallo bob ${Date.now()}`;
    const { sent } = anna.bundle.contactChannel.sendTurn({ peerAddr: bob.address, threadId: bob.address, text });
    await sent;
    // painted: the turn reached the contact-thread inbox the open thread screen reads
    expect(await until(() => bob.landed.contactReplies.some((r) => r.text === text)),
      `bob's inbox never got it; landed: ${JSON.stringify(bob.landed.contactReplies)}; unrouted: ${bob.landed.unrouted.length}`).toBe(true);
    // stored: the received copy is in bob's thread, read back the way the thread screen reads it
    expect(await until(async () => {
      const turns = await bob.bundle.contactChannel.rehydrate(anna.address);
      return turns.some((x) => x.text === text);
    }), 'the turn was painted but never stored in bob\'s thread').toBe(true);
    // and it did not fall through to the default handler
    expect(bob.landed.unrouted).toEqual([]);
  }, 30_000);
});
