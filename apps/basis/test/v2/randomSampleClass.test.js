/**
 * THE DRAWN SAMPLE (`random-sample`, Frits 2026-11-10, the conflict question made real): a few members drawn from the
 * proposal's own hash decide, all of them (`unanimous`, the wizard's "two random members mediate") or most of them
 * (`majority`, a drawn jury). The people the proposal is about (its proposer, the member it names) are never drawn;
 * every device draws the same people; a circle with nobody left to draw falls to its admins.
 */
import { describe, it, expect } from 'vitest';
import { resolveGovernance, drawSample, DECISION_STATUS } from '../../src/v2/governanceDecision.js';
import { foldGovernance, proposeEvent } from '../../src/v2/governanceLog.js';
import { normalizeCirclePolicy, changeNeedsVote, GOVERNANCE_CLASSES, GOVERNANCE_CLASS_KEYS, DRAWN_SAMPLE_ENABLED, OFFERED_GOVERNANCE_CLASSES } from '../../src/v2/circlePolicy.js';
import { policyPatchFromState, CONFLICT_TO_CLASS, CONFLICT_POLICIES, ALL_CONFLICT_POLICIES, initialState } from '../../src/core/wizards/createGroupState.js';
import { buildGovernanceView } from '../../src/v2/governanceView.js';

const members = ['a0', 'm1', 'm2', 'm3', 'm4', 'm5'].map((ref) => ({ ref, role: ref === 'a0' ? 'admin' : 'member' }));
// RAW policies: the class is held back for the alpha (DRAWN_SAMPLE_ENABLED false), so normalising a policy maps it to the
// action's default; the decision code is tested as the post-alpha build will use it
const pair = { governance: { removeMember: 'random-sample' } };
const jury = { governance: { removeMember: 'random-sample' }, decisionSample: { size: 3, rule: 'majority' } };
const base = { action: 'removeMember', members, seed: 'h-proposal', subject: 'm5', by: 'a0' };

describe('the draw', () => {
  it('draws `size` members, never the proposer or the member the proposal is about, the same on every device', () => {
    const s = drawSample({ roster: members, size: 2, seed: 'h-proposal', subject: 'm5', by: 'a0' });
    expect(s).toHaveLength(2);
    expect(s).not.toContain('a0');
    expect(s).not.toContain('m5');
    expect(drawSample({ roster: [...members].reverse(), size: 2, seed: 'h-proposal', subject: 'm5', by: 'a0' })).toEqual(s);
    // another proposal draws from its own hash: over many proposals the draw is not always the same pair
    const draws = new Set(Array.from({ length: 20 }, (_, i) => drawSample({ roster: members, size: 2, seed: `proposal-${i}`, subject: 'm5', by: 'a0' }).join(',')));
    expect(draws.size).toBeGreaterThan(1);
  });
});

describe('the pair decides together (unanimous)', () => {
  const sample = drawSample({ roster: members, size: 2, seed: 'h-proposal', subject: 'm5', by: 'a0' });
  const outsider = members.map((m) => m.ref).find((r) => !sample.includes(r) && r !== 'a0' && r !== 'm5');
  it('both drawn say yes → approved; one is not enough; an outsider\'s yes does not count', () => {
    expect(resolveGovernance({ ...base, policy: pair, votes: [{ voter: sample[0], choice: 'yes' }] }).status).toBe(DECISION_STATUS.PENDING);
    expect(resolveGovernance({ ...base, policy: pair, votes: [{ voter: sample[0], choice: 'yes' }, { voter: outsider, choice: 'yes' }] }).status).toBe(DECISION_STATUS.PENDING);
    const r = resolveGovernance({ ...base, policy: pair, votes: sample.map((voter) => ({ voter, choice: 'yes' })) });
    expect(r.status).toBe(DECISION_STATUS.APPROVED);
    expect(r.sample).toEqual(sample);
  });
  it('one drawn no → rejected', () => {
    expect(resolveGovernance({ ...base, policy: pair, votes: [{ voter: sample[1], choice: 'no' }] }).status).toBe(DECISION_STATUS.REJECTED);
  });
});

describe('a drawn jury decides by majority', () => {
  it('two of three drawn → approved', () => {
    const sample = drawSample({ roster: members, size: 3, seed: 'h-proposal', subject: 'm5', by: 'a0' });
    expect(resolveGovernance({ ...base, policy: jury, votes: sample.slice(0, 2).map((voter) => ({ voter, choice: 'yes' })) }).status).toBe(DECISION_STATUS.APPROVED);
  });
});

describe('a circle with nobody left to draw', () => {
  it('falls to its admins (a circle of two is never stuck)', () => {
    const two = [{ ref: 'a0', role: 'admin' }, { ref: 'm5', role: 'member' }];
    const r = resolveGovernance({ ...base, members: two, policy: pair, votes: [{ voter: 'a0', choice: 'yes' }] });
    expect(r.status).toBe(DECISION_STATUS.APPROVED);
    expect(r.reason).toBe('no-sample-admins');
  });
});

describe('through the fold, the view and the one rule', () => {
  it('the fold draws from the proposal; only the drawn may vote in the view; a removal needs the vote', () => {
    const events = [proposeEvent({ proposalId: 'p1', action: 'removeMember', subject: 'm5', by: 'a0', at: 0 })].map((e) => ({ ...e, kind: 'governance' }));
    const fold = foldGovernance(events, { policy: pair, members, now: 1 });
    const sample = fold.proposals[0].decision.sample;
    expect(sample).toHaveLength(2);
    const asDrawn = buildGovernanceView({ fold, viewer: { ref: sample[0], role: 'member' } });
    const notDrawn = buildGovernanceView({ fold, viewer: { ref: members.map((m) => m.ref).find((r) => !sample.includes(r) && r !== 'a0'), role: 'member' } });
    expect(asDrawn.open[0].canVote).toBe(true);
    expect(notDrawn.open[0].canVote).toBe(false);
    expect(changeNeedsVote(pair, 'removeMember', members)).toBe(true);
  });
  it('a class every screen can name', () => {
    expect(GOVERNANCE_CLASSES).toContain('random-sample');
    for (const c of GOVERNANCE_CLASSES) expect(GOVERNANCE_CLASS_KEYS[c]).toBeTruthy();
  });
});

describe('held back for the alpha: no circle holds the drawn sample, nothing offers it', () => {
  it('normalising maps it to the action\'s default; the offered classes leave it out', () => {
    expect(DRAWN_SAMPLE_ENABLED).toBe(false);
    expect(normalizeCirclePolicy({ governance: { removeMember: 'random-sample' } }).governance.removeMember).toBe('any-admin');
    expect(OFFERED_GOVERNANCE_CLASSES).not.toContain('random-sample');
  });
  it('the wizard does not offer "two random members mediate"; its default is "admin decides"; the other answers compile', () => {
    expect(CONFLICT_POLICIES.map((p) => p.id)).toEqual(['admin-decides', 'vote']);
    expect(ALL_CONFLICT_POLICIES.map((p) => p.id)).toContain('mediation');
    expect(initialState().conflictPolicy).toBe('admin-decides');
    expect(policyPatchFromState({ conflictPolicy: 'mediation' }).governance?.removeMember).toBeUndefined();
    expect(policyPatchFromState({ conflictPolicy: 'admin-decides' }).governance.removeMember).toBe('any-admin');
    expect(policyPatchFromState({ conflictPolicy: 'vote' }).governance.removeMember).toBe('member-vote');
    expect(Object.keys(CONFLICT_TO_CLASS).sort()).toEqual(['admin-decides', 'mediation', 'vote']);
  });
});

describe('the one rule fails closed on an unknown roster (Opus, reviewing door 1)', () => {
  // a roster not yet read is an empty array; counting it said "no admins → no vote", so an admin-quorum change went
  // through directly whenever a screen asked before its roster answered
  const quorum = normalizeCirclePolicy({ governance: { changePolicy: 'admin-quorum' } });
  it('an empty roster under admin-quorum needs a vote; one admin on the roster does not', () => {
    expect(changeNeedsVote(quorum, 'changePolicy', [])).toBe(true);
    expect(changeNeedsVote(quorum, 'changePolicy', [{ ref: 'a', role: 'admin' }])).toBe(false);
  });
});
