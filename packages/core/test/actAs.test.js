/**
 * ACTING AS one of this process's own identities (a persona) — `invoke(..., { actAs })` on the IN-PROCESS path only.
 *
 * The device is several people; its own calls leave as one agent. `actAs` names which of them a local call is, at
 * the one dispatch membrane every skill crosses: the policy gate still sees the real caller, while the handler's
 * `from` and the trail's actor are the persona. Never on the wire — a call that cannot run in-process is refused,
 * not sent as the agent, and a wire request that carries an `actAs` is not read.
 */
import { describe, it, expect } from 'vitest';
import { Agent } from '../src/Agent.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { DataPart } from '../src/Parts.js';

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
  bob.register('who', async ({ from, originFrom, envelope }) => [DataPart({ from, originFrom, envFrom: envelope?._from ?? null })], { visibility: 'public' });
  return { alice, bob };
}
const dataOf = (parts) => parts?.[0]?.data ?? null;

describe('actAs — the in-process caller is the persona', () => {
  it('the handler\'s from, originFrom and the trail\'s actor are the persona', async () => {
    const { alice, bob } = await makePair();
    const seen = [];
    bob.trailSink = (e) => seen.push(e);
    const r = dataOf(await alice.invoke(bob.address, 'who', [], { actAs: 'persona-p' }));
    expect(r).toEqual({ from: 'persona-p', originFrom: 'persona-p', envFrom: 'persona-p' });
    expect(seen.at(-1)).toMatchObject({ actor: 'persona-p', op: 'who', outcome: 'ok' });
  });

  it('without actAs, the call is the agent\'s, as before', async () => {
    const { alice, bob } = await makePair();
    expect(dataOf(await alice.invoke(bob.address, 'who', [])).from).toBe(alice.address);
  });

  it('a call that cannot run in-process is REFUSED when it carries actAs — never sent as the agent', async () => {
    const { alice, bob } = await makePair();
    // a streaming skill takes the wire path
    bob.register('whoStream', async function* ({ from }) { yield [DataPart({ from })]; }, { visibility: 'public', streaming: true });
    await expect(alice.invoke(bob.address, 'whoStream', [], { actAs: 'persona-p' })).rejects.toThrow(/actAs/);
  });

  it('a wire request carrying actAs is not read: the sender is who it is', async () => {
    const { alice, bob } = await makePair();
    const t = await alice.transportFor(bob.address);
    const rs = await t.request(bob.address, { type: 'task', taskId: 't-wire-1', skillId: 'who', parts: [], actAs: 'persona-p', _actAs: 'persona-p' }, 5000);
    expect(rs.payload?.status).toBe('completed');
    expect(dataOf(rs.payload.parts).from).toBe(alice.address);
  });
});
