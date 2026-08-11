/**
 * The activity-trail port on the dispatch membrane (`agent.trailSink`).
 *
 * runGatedSkill reports every GATE-PASSED skill exercise through the port with a
 * whitelisted shape — who (the verified origin), which skill, under what authority,
 * how it ended — and NEVER the parts/args (a trail carrying content becomes a second
 * copy of the data under different access rules). Refusals are not reported here:
 * they are the security audit's story; the trail records actions.
 */
import { describe, it, expect } from 'vitest';
import { Agent } from '../src/Agent.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { TextPart, Parts } from '../src/Parts.js';
import { runGatedSkill } from '../src/protocol/taskExchange.js';

async function makePair() {
  const bus = new InternalBus();
  const aliceId = await AgentIdentity.generate(new VaultMemory());
  const bobId = await AgentIdentity.generate(new VaultMemory());
  const alice = new Agent({ identity: aliceId, transport: new InternalTransport(bus, aliceId.pubKey, { identity: aliceId }) });
  const bob = new Agent({ identity: bobId, transport: new InternalTransport(bus, bobId.pubKey, { identity: bobId }) });
  alice.addPeer(bob.address, bob.pubKey);
  bob.addPeer(alice.address, alice.pubKey);
  await alice.start();
  await bob.start();
  return { alice, bob };
}

describe('the trailSink port on runGatedSkill', () => {
  it('a real cross-agent invoke reports {actor, op, via, outcome} — and no content', async () => {
    const { alice, bob } = await makePair();
    bob.register('greet', async ({ parts }) => [TextPart(`hi ${Parts.text(parts) ?? ''}`)], { visibility: 'public' });
    const seen = [];
    bob.trailSink = (e) => seen.push(e);

    await alice.invoke(bob.address, 'greet', [TextPart('geheim')]);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ actor: alice.address, op: 'greet', via: 'peer', outcome: 'ok' });
    expect(JSON.stringify(seen[0])).not.toContain('geheim');   // the whitelist holds
  });

  it('a handler error reports the outcome label; a token reports grant:<id>', async () => {
    const { bob } = await makePair();
    bob.register('boom', async () => { throw new Error('kapot'); }, { visibility: 'public' });
    const seen = [];
    bob.trailSink = (e) => seen.push(e);

    await runGatedSkill(bob, { skillId: 'boom', parts: [], from: 'caller-x', token: { id: 'tok-7' } });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ actor: 'caller-x', op: 'boom', via: 'grant:tok-7', outcome: 'kapot' });
  });

  it('an UNKNOWN skill (gate not passed) reports nothing — refusals are the audit\'s story', async () => {
    const { bob } = await makePair();
    const seen = [];
    bob.trailSink = (e) => seen.push(e);
    const res = await runGatedSkill(bob, { skillId: 'nope', parts: [], from: 'caller-x' });
    expect(res.status).toBe('failed');
    expect(seen).toHaveLength(0);
  });

  it('a throwing sink never breaks dispatch; no sink at all is fine', async () => {
    const { alice, bob } = await makePair();
    bob.register('greet', async () => [TextPart('hi')], { visibility: 'public' });
    bob.trailSink = () => { throw new Error('sink broken'); };
    const r1 = await alice.invoke(bob.address, 'greet', []);
    expect(Parts.text(r1)).toBe('hi');
    delete bob.trailSink;
    const r2 = await alice.invoke(bob.address, 'greet', []);
    expect(Parts.text(r2)).toBe('hi');
  });
});
