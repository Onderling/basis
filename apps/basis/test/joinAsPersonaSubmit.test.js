/**
 * The join's choke point (finalSubmit) when a persona was picked: the circle is bound to it BEFORE the redeem, the
 * membership is recorded under it after, and a join that fails gives the circle back to the default. Without a
 * persona (or as the default) nothing is bound and the membership is the default's, as before.
 */
import { describe, it, expect, vi } from 'vitest';
import { initialState, decodeInvite, setPersona, finalSubmit } from '../src/core/wizards/joinGroupState.js';

const invite = { kind: 'membershipCode', groupId: 'g1', code: 'c1', relayUrl: 'ws://relay.test' };

function harness({ redeemFails = false } = {}) {
  const calls = [];
  const callSkill = vi.fn(async (app, op, args) => {
    calls.push({ app, op, args });
    if (op === 'redeemMembershipCode') return redeemFails ? { ok: false, error: 'invalid-or-expired-code' } : { ok: true, groupId: 'g1' };
    if (op === 'bindCirclePersona') return { ok: true, address: 'addr-of-persona' };
    if (op === 'getPersonaRelease') return { ok: true, released: {} };
    return { ok: true };
  });
  return { callSkill, calls };
}
const stateFor = (persona) => {
  const s = initialState(); decodeInvite(invite, s); s.handle = 'anne';
  if (persona) setPersona(s, persona);
  return s;
};
const order = (calls) => calls.map((c) => c.op);

describe('finalSubmit as a persona', () => {
  it('binds the circle to the persona before the redeem, and records the membership under it', async () => {
    const { callSkill, calls } = harness();
    await finalSubmit({ state: stateFor('p-0123456789ab'), callSkill, circleAddressFor: () => 'addr-of-persona' });
    const ops = order(calls);
    expect(ops.indexOf('bindCirclePersona')).toBeGreaterThanOrEqual(0);
    expect(ops.indexOf('bindCirclePersona')).toBeLessThan(ops.indexOf('redeemMembershipCode'));
    expect(calls.find((c) => c.op === 'bindCirclePersona').args).toEqual({ circleId: 'g1', personaId: 'p-0123456789ab', relayUrl: 'ws://relay.test' });
    expect(calls.find((c) => c.op === 'setProfileCircleMembership').args).toMatchObject({ id: 'p-0123456789ab', circleId: 'g1' });
  });

  it("with no name typed the persona's own name is the name, and the membership is still recorded under it", async () => {
    // what the join wizard's "As a new persona" leaves: the handle empty on purpose (the persona's name is the name).
    // The record not written meant the next start did not know the circle was the persona's: no socket of its own on
    // the circle's relay, so every line waited (found by the phone's personas walk).
    const { callSkill, calls } = harness();
    const s = initialState(); decodeInvite(invite, s);
    s.personas = [{ id: 'p-0123456789ab', name: 'Werk' }];
    setPersona(s, 'p-0123456789ab');
    s.handle = '';
    await finalSubmit({ state: s, callSkill, circleAddressFor: () => 'addr-of-persona' });
    expect(calls.find((c) => c.op === 'setProfileCircleMembership')?.args).toMatchObject({ id: 'p-0123456789ab', circleId: 'g1', handle: 'Werk', address: 'addr-of-persona' });
  });

  it('a join that fails gives the circle back to the default', async () => {
    const { callSkill, calls } = harness({ redeemFails: true });
    await finalSubmit({ state: stateFor('p-0123456789ab'), callSkill, circleAddressFor: () => 'addr' });
    const binds = calls.filter((c) => c.op === 'bindCirclePersona').map((c) => c.args.personaId);
    expect(binds).toEqual(['p-0123456789ab', null]);
    expect(calls.find((c) => c.op === 'setProfileCircleMembership')).toBeUndefined();
  });

  it('without a persona, or as the default: no persona is bound (the gate is asked with none), the membership is the default\'s', async () => {
    for (const persona of [null, 'default']) {
      const { callSkill, calls } = harness();
      await finalSubmit({ state: stateFor(persona), callSkill, circleAddressFor: () => 'addr-d' });
      // the one-self-per-circle gate is asked for the general persona — never a persona bound
      expect(calls.filter((c) => c.op === 'bindCirclePersona').map((c) => c.args?.personaId ?? null)).toEqual([null]);
      expect(calls.find((c) => c.op === 'setProfileCircleMembership').args).toMatchObject({ id: 'default' });
    }
  });
});
