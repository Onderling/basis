import { describe, it, expect, vi } from 'vitest';
import { Agent }                      from '../src/Agent.js';
import { AgentIdentity }              from '../src/identity/AgentIdentity.js';
import { VaultMemory }                from '@onderling/vault';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { TextPart, Parts }            from '../src/Parts.js';
import { subscribe, unsubscribe, publish, setSubscribeAuthorizer, dropSubscriber } from '../src/protocol/pubSub.js';

async function makePair() {
  const bus   = new InternalBus();
  const aId   = await AgentIdentity.generate(new VaultMemory());
  const bId   = await AgentIdentity.generate(new VaultMemory());
  const alice = new Agent({ identity: aId, transport: new InternalTransport(bus, aId.pubKey) });
  const bob   = new Agent({ identity: bId, transport: new InternalTransport(bus, bId.pubKey) });
  alice.addPeer(bob.address, bob.pubKey);
  bob.addPeer(alice.address, alice.pubKey);
  await alice.start();
  await bob.start();
  return { alice, bob };
}

async function makeTriple() {
  const bus   = new InternalBus();
  const aId   = await AgentIdentity.generate(new VaultMemory());
  const bId   = await AgentIdentity.generate(new VaultMemory());
  const cId   = await AgentIdentity.generate(new VaultMemory());
  const alice = new Agent({ identity: aId, transport: new InternalTransport(bus, aId.pubKey) });
  const bob   = new Agent({ identity: bId, transport: new InternalTransport(bus, bId.pubKey) });
  const carol = new Agent({ identity: cId, transport: new InternalTransport(bus, cId.pubKey) });
  alice.addPeer(bob.address,   bob.pubKey);
  alice.addPeer(carol.address, carol.pubKey);
  bob.addPeer(alice.address,   alice.pubKey);
  carol.addPeer(alice.address, alice.pubKey);
  await alice.start();
  await bob.start();
  await carol.start();
  return { alice, bob, carol };
}

describe('pubSub subscribe / publish', () => {
  it('subscriber receives published message', async () => {
    const { alice, bob } = await makePair();
    const received = [];

    await subscribe(bob, alice.address, 'news', parts => received.push(parts));
    await new Promise(r => setTimeout(r, 10)); // let subscribe OW land

    await publish(alice, 'news', 'breaking news');
    await new Promise(r => setTimeout(r, 10));

    expect(received).toHaveLength(1);
    expect(Parts.text(received[0])).toBe('breaking news');
  });

  it('publish to unknown topic is silent (no error)', async () => {
    const { alice } = await makePair();
    await expect(publish(alice, 'empty-topic', 'ignored')).resolves.toBeUndefined();
  });

  it('multiple subscribers all receive the message', async () => {
    const { alice, bob, carol } = await makeTriple();
    const bobReceived   = [];
    const carolReceived = [];

    await subscribe(bob,   alice.address, 'events', p => bobReceived.push(p));
    await subscribe(carol, alice.address, 'events', p => carolReceived.push(p));
    await new Promise(r => setTimeout(r, 10));

    await publish(alice, 'events', 'hello all');
    await new Promise(r => setTimeout(r, 10));

    expect(Parts.text(bobReceived[0])).toBe('hello all');
    expect(Parts.text(carolReceived[0])).toBe('hello all');
  });

  it('unsubscribe stops delivery', async () => {
    const { alice, bob } = await makePair();
    const received = [];

    await subscribe(bob, alice.address, 'feed', parts => received.push(parts));
    await new Promise(r => setTimeout(r, 10));

    await publish(alice, 'feed', 'first');
    await new Promise(r => setTimeout(r, 10));

    await unsubscribe(bob, alice.address, 'feed');
    await new Promise(r => setTimeout(r, 10));

    await publish(alice, 'feed', 'second');
    await new Promise(r => setTimeout(r, 10));

    // Only 'first' should have been delivered via the OW publish route.
    // The 'second' publish goes to no subscribers (bob unsubscribed),
    // so alice's publish() call sends nothing.
    // bob.on('publish') will still fire for inbound PBs from alice,
    // but the subscriber map on alice should have been cleaned up.
    // At minimum, the callback must not have been called more than once
    // (because after unsubscribe alice has 0 subscribers for 'feed').
    expect(received).toHaveLength(1);
    expect(Parts.text(received[0])).toBe('first');
  });

  it('different topics do not cross-deliver', async () => {
    const { alice, bob } = await makePair();
    const sportsReceived = [];
    const techReceived   = [];

    await subscribe(bob, alice.address, 'sports', p => sportsReceived.push(p));
    await subscribe(bob, alice.address, 'tech',   p => techReceived.push(p));
    await new Promise(r => setTimeout(r, 10));

    await publish(alice, 'sports', 'goal!');
    await new Promise(r => setTimeout(r, 10));

    expect(sportsReceived).toHaveLength(1);
    expect(techReceived).toHaveLength(0);
  });

  it('Agent.publish() is the same as publish(agent, ...)', async () => {
    const { alice, bob } = await makePair();
    const received = [];

    await subscribe(bob, alice.address, 'ch', p => received.push(p));
    await new Promise(r => setTimeout(r, 10));

    await alice.publish('ch', 'via agent');
    await new Promise(r => setTimeout(r, 10));

    expect(Parts.text(received[0])).toBe('via agent');
  });
});

/**
 * The subscriber registry is a membership list living on the PUBLISHER, and it had neither a gate
 * nor a way to shrink: anyone who could reach an agent could register for any topic and be handed
 * the topic's history, and nothing ever removed a registration once made.
 */
describe('pubSub — who may receive what we publish', () => {
  it('refuses a subscribe the authorizer rejects, and publishes nothing to them', async () => {
    const { alice, bob } = await makePair();
    setSubscribeAuthorizer(alice, ({ topic }) => !topic.startsWith('circle-a/'));

    const heard = [];
    await subscribe(bob, alice.address, 'circle-a/requests', (parts) => heard.push(parts));
    await new Promise((r) => setTimeout(r, 30));
    await publish(alice, 'circle-a/requests', [TextPart('ledenpost')]);
    await new Promise((r) => setTimeout(r, 30));

    expect(heard).toEqual([]);
    expect(alice._pubSubSubscribers?.get('circle-a/requests')?.size ?? 0).toBe(0);
  });

  it('still admits a topic the authorizer allows — the gate is not a blanket refusal', async () => {
    const { alice, bob } = await makePair();
    setSubscribeAuthorizer(alice, ({ topic }) => !topic.startsWith('circle-a/'));

    const heard = [];
    await subscribe(bob, alice.address, 'contacts/hello', (parts) => heard.push(parts));
    await new Promise((r) => setTimeout(r, 30));
    await publish(alice, 'contacts/hello', [TextPart('hoi')]);
    await new Promise((r) => setTimeout(r, 30));

    expect(heard.length).toBe(1);
  });

  it('refuses BEFORE replaying history — a refusal after the replay hands over what it refuses', async () => {
    // History is constructor-configured, so this pair is built by hand rather than via makePair().
    const bus   = new InternalBus();
    const aId   = await AgentIdentity.generate(new VaultMemory());
    const bId   = await AgentIdentity.generate(new VaultMemory());
    const alice = new Agent({ identity: aId, transport: new InternalTransport(bus, aId.pubKey), pubSubHistory: 5 });
    const bob   = new Agent({ identity: bId, transport: new InternalTransport(bus, bId.pubKey) });
    alice.addPeer(bob.address, bob.pubKey);
    bob.addPeer(alice.address, alice.pubKey);
    await alice.start();
    await bob.start();
    await publish(alice, 'circle-a/requests', [TextPart('eerder gezegd')]);
    setSubscribeAuthorizer(alice, () => false);

    const heard = [];
    await subscribe(bob, alice.address, 'circle-a/requests', (parts) => heard.push(parts));
    await new Promise((r) => setTimeout(r, 50));
    expect(heard).toEqual([]);
  });

  it('a throwing authorizer refuses — it must never fail open', async () => {
    const { alice, bob } = await makePair();
    setSubscribeAuthorizer(alice, () => { throw new Error('roster unreadable'); });

    const heard = [];
    await subscribe(bob, alice.address, 'circle-a/requests', (parts) => heard.push(parts));
    await new Promise((r) => setTimeout(r, 30));
    await publish(alice, 'circle-a/requests', [TextPart('post')]);
    await new Promise((r) => setTimeout(r, 30));
    expect(heard).toEqual([]);
  });

  it('dropSubscriber stops delivery to one address, scoped by topic prefix', async () => {
    const { alice, bob, carol } = await makeTriple();
    const bobHeard = [];
    const carolHeard = [];
    await subscribe(bob,   alice.address, 'circle-a/requests', (p) => bobHeard.push(p));
    await subscribe(carol, alice.address, 'circle-a/requests', (p) => carolHeard.push(p));
    await subscribe(bob,   alice.address, 'circle-b/requests', () => {});
    await new Promise((r) => setTimeout(r, 30));

    // Only circle A — the whole point: removing someone from one circle must not touch another
    // circle you share with them.
    const dropped = dropSubscriber(alice, bob.address, { topicPrefix: 'circle-a/' });
    expect(dropped).toBe(1);
    expect(alice._pubSubSubscribers.get('circle-b/requests').has(bob.address)).toBe(true);

    await publish(alice, 'circle-a/requests', [TextPart('na de verwijdering')]);
    await new Promise((r) => setTimeout(r, 30));
    expect(bobHeard).toEqual([]);
    expect(carolHeard.length).toBe(1);   // and the circle still works for its members
  });
});
