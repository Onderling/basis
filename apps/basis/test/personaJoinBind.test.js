/**
 * JOINING AS A PERSONA, the bind (persona arc c3b1): before the redeem goes out, the circle is bound to the persona the
 * joiner picked — from then on its address, its link proof and its "me" are that persona's — and the redeem leaves AS
 * the persona, carrying the persona's person key. Unbinding returns the circle to the default.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { makeSendGroupRedeemRequest } from '../src/core/handlers/groupRedeem.js';

const boot = () => createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });

describe('bindCirclePersona — the circle is the persona\'s before the redeem', () => {
  it('binds: the circle\'s address and self are the persona\'s; unbinding gives it back to the default', async () => {
    const agent = await boot();
    const { id } = await agent.callSkill('agents', 'createProfile', { name: 'Buurt' });
    const B = agent.persona(id);
    const C = 'circle-joined-as-buurt';
    const r = await agent.callSkill('household', 'bindCirclePersona', { circleId: C, personaId: id });
    expect(r).toMatchObject({ ok: true, address: B.circleAddressFor(C) });
    expect(agent.circleAddressFor(C)).toBe(B.circleAddressFor(C));
    const self = agent.circleSelf(C);
    expect(self.webid).toBe(B.chatId.pubKey);
    expect(self.sendAs).toBe(B.chatId.pubKey);
    expect(self.personKey?.version).toBe(1);
    // the default's own self, by contrast, sends as nothing special
    expect(agent.circleSelf('some-default-circle')).toMatchObject({ webid: agent.identity.chat.pubKey, sendAs: null });

    const off = await agent.callSkill('household', 'bindCirclePersona', { circleId: C, personaId: null });
    expect(off.ok).toBe(true);
    expect(agent.circleAddressFor(C)).toBe(agent.persona('default').circleAddressFor(C));
  }, 60_000);

  it('refuses a persona this device does not run', async () => {
    const agent = await boot();
    const r = await agent.callSkill('household', 'bindCirclePersona', { circleId: 'c', personaId: 'p-0123456789ab' });
    expect(r).toMatchObject({ ok: false, reason: 'no-such-persona' });
  }, 60_000);
});

describe('the redeem leaves as the circle\'s persona', () => {
  it('sends AS the persona with its person key; a default circle sends as before', async () => {
    const sent = [];
    const pendingMap = new Map();
    const send = makeSendGroupRedeemRequest({
      sendPeer: async (addr, payload, opts) => { sent.push({ addr, payload, opts }); },
      pendingMap, timeoutMs: 50, logger: { warn() {} },
      currentPersonKey: () => ({ version: 1, pubKey: 'default-person-key' }),
      circleSelfFor: (gid) => (gid === 'persona-circle' ? { webid: 'B', sendAs: 'B', personKey: { version: 1, pubKey: 'b-person-key' } } : { webid: 'D', sendAs: null, personKey: null }),
    });
    await send({ adminPeerAddr: 'admin', groupId: 'persona-circle', code: 'x' }).catch(() => {});
    await send({ adminPeerAddr: 'admin', groupId: 'default-circle', code: 'y' }).catch(() => {});
    expect(sent[0].opts?.sendAs).toBe('B');
    expect(sent[0].payload.personKey).toEqual({ version: 1, pubKey: 'b-person-key' });
    expect(sent[1].opts?.sendAs).toBeUndefined();
    expect(sent[1].payload.personKey).toEqual({ version: 1, pubKey: 'default-person-key' });
  });
});
