/**
 * The kernel's task requests over the secure channel: handed to the kernel's own gated dispatch when the composition
 * takes them, refused (answered as a failed task, so the caller is not left waiting) when too large or too many from
 * one sender. The caller is the envelope's authenticated `_from`, never a field of the payload.
 */
import { describe, it, expect } from 'vitest';
import { Agent, AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { makePeerSkillCalls } from '../src/peerSkillCalls.js';

async function receiver() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const agent = new Agent({ identity: id, transport: new InternalTransport(new InternalBus(), id.pubKey) });
  const seen = [];
  agent.register('echo', async ({ parts, envelope }) => { seen.push(envelope?._from); return parts; }, { visibility: 'public', policy: 'requires-token' });
  return { agent, seen };
}
const fakeTx = () => { const sent = []; return { sent, respond: async (to, id, payload) => { sent.push({ to, id, payload }); } }; };
const env = (from, payload, id = 'e1') => ({ _from: from, _id: id, _p: 'RQ', payload: { type: 'task', taskId: `t-${id}`, skillId: 'echo', ...payload } });

describe('peer skill calls', () => {
  it('a task request runs the skill through the kernel, as the envelope\'s sender, answered on the same transport', async () => {
    const { agent, seen } = await receiver();
    const accept = makePeerSkillCalls({ agent });
    const tx = fakeTx();
    await accept(env('ALICE', { parts: [DataPart({ hi: 1 })], _from: 'MALLORY', from: 'MALLORY' }), tx);
    expect(seen).toEqual(['ALICE']);
    expect(tx.sent[0]).toMatchObject({ to: 'ALICE', id: 'e1', payload: { type: 'task-result', status: 'completed' } });
  });

  it('only skills that DEMAND a token (or that the composition names): a stranger calling reachable-peers is told unknown', async () => {
    const { agent } = await receiver();
    agent.enableReachabilityOracle();
    agent.register('loose', async () => [DataPart({ ran: true })], { visibility: 'authenticated', policy: 'on-request' });
    const tx = fakeTx();
    const accept = makePeerSkillCalls({ agent });
    for (const skillId of ['reachable-peers', 'loose', 'nope']) await accept(env('STRANGER', { skillId }, skillId), tx);
    expect(tx.sent.map((x) => x.payload.status)).toEqual(['failed', 'failed', 'failed']);
    for (const x of tx.sent) expect(x.payload.error).toMatch(/Unknown skill/);
    // a skill the composition names explicitly is taken, under its own gate
    const named = makePeerSkillCalls({ agent, alsoSkills: ['loose'] });
    const tx2 = fakeTx();
    await named(env('STRANGER', { skillId: 'loose' }), tx2);
    expect(tx2.sent[0].payload.status).toBe('completed');
  });

  it('too large, or too many from one sender: answered as failed, the skill never runs', async () => {
    const { agent, seen } = await receiver();
    const refused = [];
    const accept = makePeerSkillCalls({ agent, maxPartsBytes: 100, perPeer: { burst: 2, refillPerSec: 0 }, onRefused: (e) => refused.push(e.reason) });
    const tx = fakeTx();
    await accept(env('BOB', { parts: [DataPart({ big: 'x'.repeat(500) })] }, 'big'), tx);
    for (let i = 0; i < 3; i++) await accept(env('BOB', { parts: [] }, `n${i}`), tx);
    expect(refused).toEqual(['too-large', 'rate-limited']);
    expect(seen).toHaveLength(2);
    expect(tx.sent.filter((s) => s.payload.status === 'failed').map((s) => s.payload.error)).toEqual(['too-large', 'rate-limited']);
  });
});
