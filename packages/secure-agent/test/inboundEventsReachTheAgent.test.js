/**
 * What the wire does reaches the agent: a greeting says `peer`, a refusal says `security-error`.
 *
 * The kernel emits both — `peer` from its hello handler, `security-error` re-emitted from a transport
 * it owns — but the transports this factory wires hand their envelopes HERE, not to the kernel's
 * dispatch, and are owned here, not by the kernel. So neither event ever fired for a relay, a mesh or
 * a rendezvous transport: a first contact was invisible above the substrate, and a refused envelope
 * (an unknown sender, a bad signature) was indistinguishable from one that never arrived. Found
 * 2026-09-13 building "a person's own devices tell each other who they know", which needs the first
 * and had to prove the gap through the second.
 */
import { describe, it, expect } from 'vitest';
import { createSecureAgent } from '../src/createSecureAgent.js';
import { VaultMemory } from '@onderling/vault';

function fakeTransport() {
  const handlers = {};
  return {
    address: 'fake.addr',
    useSecurityLayer() {},
    on(evt, fn) { handlers[evt] = fn; },
    async connect() {}, async disconnect() {},
    async sendHello() {}, async sendOneWay() { return { ok: true }; },
    /** The two things a real transport does: emit a verified envelope, or emit a refusal. */
    async inbound(env) { await handlers.envelope?.(env); },
    refuse(err, raw) { handlers['security-error']?.(err, raw); },
  };
}

describe('inbound events reach the agent', () => {
  it('an accepted greeting emits `peer` on the agent, shaped like the kernel\'s own', async () => {
    const tx = fakeTransport();
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    await sa.addSecureTransport('relay', tx);
    const seen = [];
    sa.agent.on('peer', (p) => seen.push(p));
    await tx.inbound({ _from: 'cato', _id: 'env-1', _p: 'HI', payload: { pubKey: 'pk-cato', label: 'Cato', capabilities: { rendezvous: false } } });
    expect(seen).toEqual([{ address: 'cato', pubKey: 'pk-cato', label: 'Cato', ack: false, capabilities: { rendezvous: false } }]);
    // …and only a greeting says so: an ordinary message is not a first contact.
    await tx.inbound({ _from: 'cato', _id: 'env-2', _p: 'OW', payload: { text: 'hoi' } });
    expect(seen.length).toBe(1);
  });

  it('a muted peer\'s greeting does NOT say `peer` — the gates above still gate', async () => {
    const tx = fakeTransport();
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    await sa.addSecureTransport('relay', tx);
    await sa.mute.add('cato');
    const seen = [];
    sa.agent.on('peer', (p) => seen.push(p));
    await tx.inbound({ _from: 'cato', _id: 'env-1', _p: 'HI', payload: { pubKey: 'pk-cato' } });
    expect(seen).toEqual([]);
  });

  it('a transport\'s refusal is re-emitted as `security-error` on the agent, with the raw envelope', async () => {
    const tx = fakeTransport();
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    await sa.addSecureTransport('relay', tx);
    const seen = [];
    sa.agent.on('security-error', (err, raw) => seen.push({ code: err.code, from: raw?._from }));
    tx.refuse(Object.assign(new Error('No pubKey registered'), { code: 'UNKNOWN_SENDER' }), { _from: 'stranger', _p: 'OW' });
    expect(seen).toEqual([{ code: 'UNKNOWN_SENDER', from: 'stranger' }]);
  });
});
