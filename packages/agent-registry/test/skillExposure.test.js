/**
 * Per-skill exposure — the discovery filter, its two tiers, and the honesty property.
 *
 * The load-bearing tests here are the ones that pin what exposure is NOT: hiding a skill removes it
 * from what others READ and changes nothing about what may be DONE (the grant at dispatch is the
 * enforcement). A test suite that only checked "hidden skills disappear" would let the surface drift
 * into promising protection it cannot deliver.
 */
import { describe, it, expect } from 'vitest';
import {
  EMPTY_EXPOSURE, normalizeExposure, isSkillExposed, filterExposedSkills,
  setSkillExposure, setCircleSkillExposure,
} from '../src/skillExposure.js';
import { projectAgentCard } from '../src/agentCard.js';

const OWNER = 'fp-owner-abc';

describe('the default: an agent added to a circle is useful immediately', () => {
  it('nothing hidden ⇒ every skill is advertised', () => {
    expect(isSkillExposed({ skillId: 'summarise', circleId: 'c1' })).toBe(true);
    expect(filterExposedSkills({ skills: ['a', 'b'], circleId: 'c1' })).toEqual(['a', 'b']);
  });

  it('a corrupt policy degrades to nothing-hidden, not everything-hidden', () => {
    // An agent whose whole skill set vanished would read as broken; a filter must fail OPEN because
    // it is not a security control (the dispatch grant is).
    for (const junk of [null, 'nope', 42, { hidden: 'x', perCircle: 7 }]) {
      expect(normalizeExposure(junk)).toEqual(EMPTY_EXPOSURE);
      expect(isSkillExposed({ exposure: junk, skillId: 's', circleId: 'c1' })).toBe(true);
    }
  });
});

describe('tier 1 — the OWNER decides, and ownership is the key', () => {
  it('the owner hides a skill agent-wide; it is gone from every circle', () => {
    const r = setSkillExposure({
      skillId: 'delete-everything', exposed: false, ownerFingerprint: OWNER, bySigner: OWNER,
    });
    expect(r.ok).toBe(true);
    expect(isSkillExposed({ exposure: r.exposure, skillId: 'delete-everything', circleId: 'c1' })).toBe(false);
    expect(isSkillExposed({ exposure: r.exposure, skillId: 'delete-everything', circleId: 'c2' })).toBe(false);
    expect(isSkillExposed({ exposure: r.exposure, skillId: 'other' })).toBe(true);
  });

  it('a change signed by anyone else is refused — this is what "owns" means', () => {
    expect(setSkillExposure({
      skillId: 's', exposed: false, ownerFingerprint: OWNER, bySigner: 'fp-someone-else',
    })).toEqual({ ok: false, reason: 'not-owner' });
    // …and an unsigned change is refused too, rather than defaulting to trusted.
    expect(setSkillExposure({ skillId: 's', exposed: false, ownerFingerprint: OWNER }).ok).toBe(false);
  });

  it('the owner rule needs NO circle — it answers the circle-less agent', () => {
    // An agent that sits in no circle still has exactly one authority: its owner key.
    const r = setSkillExposure({ skillId: 's', exposed: false, ownerFingerprint: OWNER, bySigner: OWNER });
    expect(r.ok).toBe(true);
    expect(isSkillExposed({ exposure: r.exposure, skillId: 's' })).toBe(false);
  });

  it('hiding then re-exposing round-trips', () => {
    const hidden = setSkillExposure({ skillId: 's', exposed: false, ownerFingerprint: OWNER, bySigner: OWNER }).exposure;
    const back = setSkillExposure({ exposure: hidden, skillId: 's', exposed: true, ownerFingerprint: OWNER, bySigner: OWNER });
    expect(isSkillExposed({ exposure: back.exposure, skillId: 's' })).toBe(true);
  });
});

describe('tier 2 — a circle narrows, never widens (the ceiling)', () => {
  it("an admin hides a skill in THEIR circle only", () => {
    const r = setCircleSkillExposure({ skillId: 's', exposed: false, circleId: 'c1', isAdmin: true });
    expect(r.ok).toBe(true);
    expect(isSkillExposed({ exposure: r.exposure, skillId: 's', circleId: 'c1' })).toBe(false);
    expect(isSkillExposed({ exposure: r.exposure, skillId: 's', circleId: 'c2' })).toBe(true);   // untouched
  });

  it('a circle CANNOT reveal what the owner hid — refused loudly, not ignored', () => {
    const ownerHid = setSkillExposure({ skillId: 's', exposed: false, ownerFingerprint: OWNER, bySigner: OWNER }).exposure;
    const attempt = setCircleSkillExposure({ exposure: ownerHid, skillId: 's', exposed: true, circleId: 'c1', isAdmin: true });
    expect(attempt).toEqual({ ok: false, reason: 'cannot-widen' });
    // The leak this prevents: circle B's admins revealing what the owner keeps hidden in circle A.
    expect(isSkillExposed({ exposure: ownerHid, skillId: 's', circleId: 'c1' })).toBe(false);
  });

  it('a circle CAN undo its own narrowing', () => {
    const hid = setCircleSkillExposure({ skillId: 's', exposed: false, circleId: 'c1', isAdmin: true }).exposure;
    const back = setCircleSkillExposure({ exposure: hid, skillId: 's', exposed: true, circleId: 'c1', isAdmin: true });
    expect(back.ok).toBe(true);
    expect(isSkillExposed({ exposure: back.exposure, skillId: 's', circleId: 'c1' })).toBe(true);
  });

  it('a non-admin is refused (the EXISTING admin role, no new one)', () => {
    expect(setCircleSkillExposure({ skillId: 's', exposed: false, circleId: 'c1', isAdmin: false }))
      .toEqual({ ok: false, reason: 'admin-only' });
  });
});

describe('the card projection is where hiding takes effect', () => {
  const entry = {
    agentId: 'bot-x', pubKey: 'pub-x', role: 'service',
    capabilities: ['summarise', 'translate'],
    grants: [{ tokenId: 't1', skill: 'summarise', capability: 'read', expiresAt: null }],
  };

  it('a hidden skill is absent from the card other people read', () => {
    const exposure = setSkillExposure({ skillId: 'translate', exposed: false, ownerFingerprint: OWNER, bySigner: OWNER }).exposure;
    const card = projectAgentCard({ ...entry, exposure });
    expect(card.skills.map((s) => s.id)).toEqual(['summarise']);
  });

  it('the same agent shows different skills in different circles', () => {
    const exposure = setCircleSkillExposure({ skillId: 'summarise', exposed: false, circleId: 'c1', isAdmin: true }).exposure;
    const inC1 = projectAgentCard({ ...entry, exposure }, { circleId: 'c1' });
    const inC2 = projectAgentCard({ ...entry, exposure }, { circleId: 'c2' });
    expect(inC1.skills.map((s) => s.id)).toEqual(['translate']);
    expect(inC2.skills.map((s) => s.id).sort()).toEqual(['summarise', 'translate']);
  });

  it('THE HONESTY PROPERTY — hiding a skill does not remove its GRANT', () => {
    // Hiding is a discovery filter. The grant is what authorises a dispatch, so it stays on the card:
    // pretending otherwise would tell the user they had revoked something they had not. Someone
    // running a modified client who knows the skill id can still call it — and the token check, not
    // this filter, is what decides whether that call succeeds.
    const exposure = setSkillExposure({ skillId: 'summarise', exposed: false, ownerFingerprint: OWNER, bySigner: OWNER }).exposure;
    const card = projectAgentCard({ ...entry, exposure });
    expect(card.skills.map((s) => s.id)).not.toContain('summarise');
    expect(card['x-onderling'].grants.map((g) => g.skill)).toContain('summarise');
  });

  it('an entry with no exposure policy projects exactly as before (additive)', () => {
    const card = projectAgentCard(entry);
    expect(card.skills.map((s) => s.id).sort()).toEqual(['summarise', 'translate']);
  });
});
