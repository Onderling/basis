/**
 * A CIRCLE BELONGS TO THE PERSONA IT WAS JOINED AS (persona arc c3a). The registry records a circle under one profile;
 * from then on that circle's per-circle keys — its address, its signing identity, its sealing keys, its commitment —
 * are THAT persona's, and its traffic is owned by that persona: it leaves only on that persona's own sockets. A circle
 * of a persona with no socket yet is refused with the typed outcome, never sent as the default.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

const boot = (v) => createRealHouseholdAgent({ seedHousehold: false, ...v });
const vaults = () => ({ ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });

describe('a circle is its persona\'s', () => {
  it('the circle\'s keys are the persona\'s, and its send is owned by it (no socket → the typed refusal)', async () => {
    const v = vaults();
    const agent = await boot(v);
    const { id } = await agent.callSkill('agents', 'createProfile', { name: 'Buurt' });
    const B = agent.persona(id);
    const D = agent.persona('default');
    const C = 'circle-of-buurt';
    const before = agent.circleAddressFor(C);
    expect(before, 'unrecorded: the default\'s').toBe(D.circleAddressFor(C));

    // what a join as the persona writes: the circle under that profile, with that persona's address for it
    const set = await agent.callSkill('agents', 'setProfileCircleMembership', { id, circleId: C, handle: 'b', address: B.circleAddressFor(C) });
    expect(set.ok).toBe(true);
    expect(agent.circleAddressFor(C), 'recorded under the persona: its address').toBe(B.circleAddressFor(C));
    expect(agent.circleAddressFor(C)).not.toBe(D.circleAddressFor(C));
    expect(agent.ceremonyCommitmentFor(C)).toBe(B.ceremonyCommitmentFor(C));

    const r = await agent.sendPeerMessage('a-member-of-that-circle', { subtype: 'note', text: 'x' }, { circleId: C });
    expect(r).toMatchObject({ delivered: false, reason: 'persona-no-connection', persona: B.chatId.pubKey });

    // a reboot keeps the circle with its persona
    const again = await boot(v);
    expect(again.circleAddressFor(C)).toBe(again.persona(id).circleAddressFor(C));
  }, 60_000);

  it('a circle of the default persona is unchanged — its send is not refused as a persona\'s', async () => {
    const agent = await boot(vaults());
    await agent.callSkill('agents', 'createProfile', { name: 'Werk' });
    const C = 'circle-of-default';
    await agent.callSkill('agents', 'setProfileCircleMembership', { id: 'default', circleId: C, handle: 'a', address: agent.persona('default').circleAddressFor(C) });
    expect(agent.circleAddressFor(C)).toBe(agent.persona('default').circleAddressFor(C));
    const r = await agent.sendPeerMessage('a-member', { subtype: 'note', text: 'y' }, { circleId: C, guarantee: 'hold-forward' }).catch((e) => ({ threw: String(e?.message ?? e) }));
    expect(r?.reason).not.toBe('persona-no-connection');
  }, 60_000);
});
