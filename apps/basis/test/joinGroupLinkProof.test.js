/**
 * #4 join flow — the cross-circle link SIGNING PROOF, end to end at the logic level
 * (Decision B: "continue as an existing self" must be PROVABLE, not asserted).
 *
 * A linkable joiner presents the per-circle address of a circle they're already in, PLUS a
 * signature (by that circle's key) over a challenge bound to the joining circle. The admin
 * verifies it and records the linkage only if it holds — a co-member who has merely SEEN the
 * address can't forge the proof. This test drives the real `finalSubmit` with the same seams
 * the host binds (circleAddressFor + signCircleLink, over a real profile seed) and checks the
 * admin's `verifyCircleLink` accepts the emitted proof and rejects a forged one.
 */
import { describe, it, expect, vi } from 'vitest';
import { finalSubmit, setLinkChoice } from '../src/core/wizards/joinGroupState.js';
import { Bootstrap } from '@onderling/core';
import { deriveCircleAddress, signCircleLinkFromSeed, verifyCircleLink } from '@onderling/core';

const JOINING = 'werk-7';   // the circle being joined
const SOURCE = 'buurt-42';  // my existing self lives here

/** A joiner state that has chosen to continue as the existing self in SOURCE. */
function linkableState() {
  const state = {
    invite: { kind: 'membershipCode', code: 'CODE123', groupId: JOINING },
    handle: 'jan',
    existingSelves: [{ circleId: SOURCE, name: 'Buurt' }],
    linkChoice: 'fresh',
  };
  setLinkChoice(state, SOURCE);   // guarded to a known existing self
  return state;
}

/** callSkill double: ok for everything, capturing the redeemMembershipCode args. */
function makeCallSkill() {
  const redeemArgs = {};
  const callSkill = vi.fn(async (app, op, args) => {
    if (op === 'redeemMembershipCode') { Object.assign(redeemArgs, args); return { ok: true, groupId: args.groupId }; }
    if (op === 'setMyHandle') return { ok: true };
    if (op === 'getPersonaRelease') return { released: {} };
    return { ok: true };
  });
  return { callSkill, redeemArgs };
}

describe('#4 link proof — joiner emits a proof the admin verifies', () => {
  const seed = Bootstrap.fromMnemonic(Bootstrap.create().mnemonic).deriveAgentSeed('me');
  const circleAddressFor = (cid) => deriveCircleAddress(seed, cid);
  const signCircleLink = (cid, gid, addr) => signCircleLinkFromSeed(seed, cid, gid, addr);

  it('presents the SOURCE address + a valid proof; the admin accepts it', async () => {
    const { callSkill, redeemArgs } = makeCallSkill();
    await finalSubmit({ state: linkableState(), callSkill, circleAddressFor, signCircleLink });

    // the redeem carried the source self's address + its proof
    expect(redeemArgs.circleAddress).toBe(deriveCircleAddress(seed, SOURCE));
    expect(typeof redeemArgs.circleAddressProof).toBe('string');
    // the admin's verifier accepts it (bound to the JOINING circle)
    expect(verifyCircleLink({ groupId: JOINING, address: redeemArgs.circleAddress, proof: redeemArgs.circleAddressProof })).toBe(true);
  });

  it('the emitted proof does NOT verify for a different joining circle (no cross-circle replay)', async () => {
    const { callSkill, redeemArgs } = makeCallSkill();
    await finalSubmit({ state: linkableState(), callSkill, circleAddressFor, signCircleLink });
    expect(verifyCircleLink({ groupId: 'some-other-circle', address: redeemArgs.circleAddress, proof: redeemArgs.circleAddressProof })).toBe(false);
  });

  it('a forged proof (attacker who only knows the address) is rejected by the admin', async () => {
    const { redeemArgs } = makeCallSkill();
    // attacker presents the victim's SOURCE address but signs with THEIR OWN key
    const victimAddress = deriveCircleAddress(seed, SOURCE);
    const attackerSeed = Bootstrap.fromMnemonic(Bootstrap.create().mnemonic).deriveAgentSeed('attacker');
    const forged = signCircleLinkFromSeed(attackerSeed, SOURCE, JOINING, victimAddress);
    expect(verifyCircleLink({ groupId: JOINING, address: victimAddress, proof: forged })).toBe(false);
    void redeemArgs;
  });

  it('a FRESH joiner presents no address and no proof (nothing to prove)', async () => {
    const { callSkill, redeemArgs } = makeCallSkill();
    const fresh = { invite: { kind: 'membershipCode', code: 'C', groupId: JOINING }, handle: 'jan', linkChoice: 'fresh' };
    await finalSubmit({ state: fresh, callSkill, circleAddressFor, signCircleLink });
    expect(redeemArgs.circleAddress).toBeUndefined();
    expect(redeemArgs.circleAddressProof).toBeUndefined();
  });
});

describe('J-NP2 — the admin-offline case is a typed NOTICE, not a generic failure', () => {
  const unreachableState = () => ({
    invite: { kind: 'membershipCode', code: 'CODE123', groupId: 'g1', adminPeerAddr: 'admin-addr' },
    handle: 'jan',
    existingSelves: [],
    linkChoice: 'fresh',
  });
  // Local redeem says the code needs the admin (invalid HERE), so the peer bridge is the path taken.
  // NB the membershipCode path calls `redeemMembershipCode` — `redeemInviteWithGate` is path B, and a mock
  // keyed on the wrong op makes the join silently succeed locally (found writing this test).
  const callSkill = vi.fn(async (app, op) => (op === 'redeemMembershipCode'
    ? { error: 'invalid-or-expired-code' }
    : { ok: true }));

  it('a peer redeem that reaches NOBODY maps to the join_no_admin key, and the invite survives', async () => {
    // Reported generically, this is indistinguishable from a broken invite — people conclude the app does
    // not work, and the retry that would have succeeded never happens.
    const state = unreachableState();
    await finalSubmit({ state, callSkill, sendPeerRedeem: async () => null });
    expect(state.submitErrorKey).toBe('circle.nearbyScreen.join_no_admin');
    expect(state.invite.code).toBe('CODE123');          // the invitation stays valid — retry is the fix
  });

  it('a transport THROW on the way to the admin is the same notice', async () => {
    const state = unreachableState();
    await finalSubmit({ state, callSkill, sendPeerRedeem: async () => { throw new Error('nkn timeout'); } });
    expect(state.submitErrorKey).toBe('circle.nearbyScreen.join_no_admin');
  });

  it('a real REJECTION from a live admin is NOT dressed up as offline', async () => {
    // "Offline, try later" on a genuine refusal would send people retrying forever.
    const state = unreachableState();
    await finalSubmit({ state, callSkill, sendPeerRedeem: async () => ({ error: 'code-revoked' }) });
    expect(state.submitErrorKey).toBeNull();
    expect(state.submitError).toBe('code-revoked');
  });
});

