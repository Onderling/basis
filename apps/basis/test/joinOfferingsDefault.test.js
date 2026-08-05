/**
 * Charter-driven skill-sharing default at join — fold-in phase C
 * (plans NOTE-skills-properties-audit.md 5), shared wizard state.
 *
 * Contract:
 *   - applyCharterOfferingsDefault: invite.offeringsMatching === true (the circle's
 *     embedded "this kring is about skills-matching" signal) pre-checks the
 *     visible share-skills line; any other circle — incl. every older invite
 *     without the field — keeps the protective default-withhold.
 *   - setShareOfferingsAtJoin: the joiner can uncheck (never silent).
 *   - finalSubmit (path A): an ACCEPTED default enables disclosure for the
 *     persona's skill-kind driver keys at the COARSE 'category' rung in the
 *     joined circle, BEFORE the release is computed — so the coarse skill keys
 *     ride the join release onto the roster. Joining minimally still works:
 *     the skills default falls back to the 'default' persona.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  initialState,
  decodeInvite,
  applyCharterOfferingsDefault,
  setShareOfferingsAtJoin,
  applyOfferingsDisclosureAtJoin,
  setPersona,
  finalSubmit,
  OFFERINGS_JOIN_RUNG,
} from '../src/core/wizards/joinGroupState.js';

const matchingInvite = { kind: 'membershipCode', groupId: 'b1', code: 'c1', offeringsMatching: true };
// Legacy invite shape: pre-rename circles embedded `skillsMatching`. Read-accepted.
const legacyMatchingInvite = { kind: 'membershipCode', groupId: 'b1', code: 'c1', skillsMatching: true };
const plainInvite    = { kind: 'membershipCode', groupId: 'b2', code: 'c2' };

function stateFor(invite) {
  const s = initialState();
  decodeInvite(invite, s);
  applyCharterOfferingsDefault(s);
  s.handle = 'anne';
  return s;
}

/** callSkill stub with a skill + a non-skill driver on every persona. */
function makeCallSkill() {
  const calls = [];
  const callSkill = vi.fn(async (app, op, args) => {
    calls.push({ app, op, args });
    if (op === 'getProfileDrivers') {
      return {
        ok: true,
        drivers: {
          'fix-bikes': { kind: 'skill', text: 'fix bikes', tags: ['bike-repair'] },
          'sailing':   { kind: 'hobby', text: 'sailing',   tags: ['sailing'] },
        },
      };
    }
    if (op === 'setProfileDisclosure') return { ok: true };
    if (op === 'getPersonaRelease') return { ok: true, released: { 'fix-bikes': { categoryId: 'klus' } } };
    return { ok: true };
  });
  return { callSkill, calls };
}

describe('applyCharterOfferingsDefault — the two defaults', () => {
  it('matching circle → pre-checked (enabled at the coarse rung comes later, at submit)', () => {
    const s = stateFor(matchingInvite);
    expect(s.offeringsMatching).toBe(true);
    expect(s.shareOfferingsAtJoin).toBe(true);      // pre-checked, uncheckable
  });

  it('legacy invite carrying skillsMatching → still pre-checked (wire read-accept)', () => {
    const s = stateFor(legacyMatchingInvite);
    expect(s.offeringsMatching).toBe(true);
    expect(s.shareOfferingsAtJoin).toBe(true);
  });

  it('non-matching circle (and any older invite without the field) → withheld', () => {
    const s = stateFor(plainInvite);
    expect(s.offeringsMatching).toBe(false);
    expect(s.shareOfferingsAtJoin).toBe(false);
    // initialState alone is also withhold-by-default
    expect(initialState().shareOfferingsAtJoin).toBe(false);
  });

  it('setShareOfferingsAtJoin records the uncheck (and re-check)', () => {
    const s = stateFor(matchingInvite);
    setShareOfferingsAtJoin(s, false);
    expect(s.shareOfferingsAtJoin).toBe(false);
    setShareOfferingsAtJoin(s, true);
    expect(s.shareOfferingsAtJoin).toBe(true);
    setShareOfferingsAtJoin(s, 'junk');             // defensive: only literal true enables
    expect(s.shareOfferingsAtJoin).toBe(false);
  });
});

describe('applyOfferingsDisclosureAtJoin — enact the accepted default', () => {
  it('enables ONLY skill-kind driver keys, at the coarse category rung, on the effective persona', async () => {
    const s = stateFor(matchingInvite);
    const { callSkill, calls } = makeCallSkill();
    const enabled = await applyOfferingsDisclosureAtJoin({ state: s, callSkill, contextId: 'b1' });
    expect(enabled).toEqual(['fix-bikes']);      // the hobby driver is NOT part of the skills default
    const disc = calls.filter((c) => c.op === 'setProfileDisclosure');
    expect(disc).toHaveLength(1);
    expect(disc[0].app).toBe('agents');
    expect(disc[0].args).toEqual({
      id: 'default', contextId: 'b1', key: 'fix-bikes', enabled: true, rung: OFFERINGS_JOIN_RUNG,
    });
    expect(OFFERINGS_JOIN_RUNG).toBe('category');
  });

  it('is a strict no-op when the line was unchecked (or the circle is not matching)', async () => {
    const s = stateFor(matchingInvite);
    setShareOfferingsAtJoin(s, false);
    const { callSkill } = makeCallSkill();
    expect(await applyOfferingsDisclosureAtJoin({ state: s, callSkill, contextId: 'b1' })).toEqual([]);
    expect(callSkill).not.toHaveBeenCalled();
  });
});

describe('finalSubmit — the skills default rides the join release', () => {
  it('matching circle, accepted, joining minimally → default persona released with the coarse skills', async () => {
    const s = stateFor(matchingInvite);        // persona stays null (join minimally)
    const { callSkill, calls } = makeCallSkill();
    const { result } = await finalSubmit({ state: s, callSkill });
    expect(result?.ok).toBe(true);
    // disclosure enacted BEFORE the release
    const ops = calls.map((c) => c.op);
    expect(ops.indexOf('setProfileDisclosure')).toBeLessThan(ops.indexOf('getPersonaRelease'));
    // release computed for the effective ('default') persona and carried into the redeem
    const rel = calls.find((c) => c.op === 'getPersonaRelease');
    expect(rel.args.id).toBe('default');
    const redeem = calls.find((c) => c.op === 'redeemMembershipCode');
    expect(redeem.args.personaProperties).toEqual({ 'fix-bikes': { categoryId: 'klus' } });
  });

  it('matching circle, accepted, chosen persona → that persona carries the default', async () => {
    const s = stateFor(matchingInvite);
    setPersona(s, 'work');
    const { callSkill, calls } = makeCallSkill();
    await finalSubmit({ state: s, callSkill });
    expect(calls.find((c) => c.op === 'setProfileDisclosure').args.id).toBe('work');
    expect(calls.find((c) => c.op === 'getPersonaRelease').args.id).toBe('work');
  });

  it('non-matching circle → no agents traffic at all, redeem without personaProperties (unchanged join)', async () => {
    const s = stateFor(plainInvite);
    const { callSkill, calls } = makeCallSkill();
    const { result } = await finalSubmit({ state: s, callSkill });
    expect(result?.ok).toBe(true);
    expect(calls.every((c) => c.app !== 'agents')).toBe(true);
    expect('personaProperties' in calls.find((c) => c.op === 'redeemMembershipCode').args).toBe(false);
  });

  it('matching circle but UNCHECKED → identical to the protective default (withhold)', async () => {
    const s = stateFor(matchingInvite);
    setShareOfferingsAtJoin(s, false);
    const { callSkill, calls } = makeCallSkill();
    const { result } = await finalSubmit({ state: s, callSkill });
    expect(result?.ok).toBe(true);
    // No `circleAddressFor` here → the restore-data membership write is skipped (address-less record is
    // invalid), so this stays no-agents-traffic. The write itself is proven below.
    expect(calls.every((c) => c.app !== 'agents')).toBe(true);
  });
});

describe('finalSubmit — write-on-join records the circle membership (registry restore-data)', () => {
  it('on a successful join, writes { handle, address } to the default profile via setProfileCircleMembership', async () => {
    const s = stateFor(plainInvite);
    s.handle = 'anne';                                       // the handle the joiner chose
    const { callSkill, calls } = makeCallSkill();
    const circleAddressFor = (circleId) => `nkn:addr-${circleId}`;
    const { result } = await finalSubmit({ state: s, callSkill, circleAddressFor });
    expect(result?.ok).toBe(true);
    // The writer is now REACHED in production — a completed join records the per-circle membership so a
    // restored device knows its circles + the handle it used (the built-but-unadopted gap, closed).
    const write = calls.find((c) => c.app === 'agents' && c.op === 'setProfileCircleMembership');
    expect(write, 'the membership write fired on join').toBeTruthy();
    expect(write.args).toEqual({
      id: 'default', circleId: result.groupId, handle: 'anne', address: `nkn:addr-${result.groupId}`,
    });
  });

  it('skips the write when no circleAddressFor is available (an address-less record is invalid)', async () => {
    const s = stateFor(plainInvite);
    s.handle = 'anne';
    const { callSkill, calls } = makeCallSkill();
    const { result } = await finalSubmit({ state: s, callSkill });   // no circleAddressFor
    expect(result?.ok).toBe(true);
    expect(calls.some((c) => c.op === 'setProfileCircleMembership')).toBe(false);
  });
});
