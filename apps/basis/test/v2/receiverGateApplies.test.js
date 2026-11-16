/**
 * EVERY MEMBER'S DEVICE REFUSES A RULES OR SETTINGS CHANGE THAT SKIPPED THE VOTE (Frits 2026-11-10: kept, never applied).
 *
 * The two applies every shell runs when governance statements land (`applyRulesUpdates`, `applyPolicyUpdates`),
 * over a rail holding what a device holds: an admin's change statement and the governance events beside it. In a
 * circle whose admins decide rules and settings together, a lone admin's change (a modified app, or a door skipped)
 * is not applied; the same change carried with the proposal both admins approved is.
 */
import { describe, it, expect } from 'vitest';
import { applyRulesUpdates } from '../../src/v2/rulesUpdateLane.js';
import { applyPolicyUpdates, makePolicyHeadStore, POLICY_UPDATE_KIND } from '../../src/v2/policyUpdateLane.js';
import { proposeEvent, voteEvent } from '../../src/v2/governanceLog.js';
import { normalizeCirclePolicy } from '../../src/v2/circlePolicy.js';

const CIRCLE = 'c1';
const quorum = normalizeCirclePolicy({ governance: { changeRule: 'admin-quorum', changePolicy: 'admin-quorum' } });
const roster = [{ webid: 'a0', role: 'admin' }, { webid: 'a1', role: 'admin' }, { webid: 'm0', role: 'member' }];
const rules = { purpose: 'Samen koken', agreements: 'Om de beurt' };

/** A rail as the applies read it: change statements (bodies) + the governance events (readVerified). */
function rail(changeBodies, govEvents = []) {
  const stored = changeBodies.map((b) => ({ body: b, sig: 's' }));
  return {
    storedStatements: () => stored,
    readVerifiedBodies: async () => ({ bodies: changeBodies }),
    readVerified: async () => ({ events: govEvents.map((e) => ({ ...e, kind: 'governance' })), disputed: new Set() }),
  };
}
const approved = (proposalId, action, subject) => [
  proposeEvent({ proposalId, action, subject, by: 'a0', at: 0 }),
  voteEvent({ proposalId, voter: 'a0', choice: 'yes', at: 0 }),
  voteEvent({ proposalId, voter: 'a1', choice: 'yes', at: 0 }),
];

describe('a rules change', () => {
  const callSkill = (recorded) => async (_app, op, args) => {
    if (op === 'listGroupMembers') return { members: roster };
    if (op === 'recordGroupRulesUpdate') { recorded.push(args); return { applied: true }; }
    return {};
  };
  const body = (extra = {}) => ({ kind: 'rules-update', author: 'a0', hash: 'h1', payload: { rules, version: 2, ...extra } });

  it('a lone admin\'s change in a circle whose admins decide together is not applied', async () => {
    const recorded = [];
    const r = await applyRulesUpdates({ rail: rail([body()]), callSkill: callSkill(recorded), circleId: CIRCLE, readPolicy: async () => quorum });
    expect(r.applied).toBe(false);
    expect(recorded).toEqual([]);
  });

  it('the same change carried with the proposal both admins approved is applied', async () => {
    const recorded = [];
    const r = await applyRulesUpdates({ rail: rail([body({ proposalId: 'p1' })], approved('p1', 'changeRule', rules)), callSkill: callSkill(recorded), circleId: CIRCLE, readPolicy: async () => quorum });
    expect(r.applied).toBe(true);
    expect(recorded[0]?.rules).toEqual(rules);
  });
});

describe('a settings change', () => {
  const memIo = () => { const m = new Map(); return { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, v); } }; };
  const stated = { ...quorum, chat: 'off' };
  // the circle's rule comes from its FOUNDING statement on the lane: version 1 by its founder (a0)
  const founding = { kind: POLICY_UPDATE_KIND, author: 'a0', hash: 'h1', payload: { policy: quorum, version: 1 } };
  const body = (extra = {}) => ({ kind: POLICY_UPDATE_KIND, author: 'a0', hash: 'h2', payload: { policy: stated, version: 2, ...extra } });
  const members = roster.map((m) => ({ ref: m.webid, role: m.role, ...(m.webid === 'a0' ? { via: 'founder' } : {}) }));
  const args = (r, written, readPolicy = async () => quorum) => ({
    rail: r, circleId: CIRCLE, headStore: makePolicyHeadStore(memIo()),
    membersOf: async () => members, readPolicy,
    writePolicy: async (_c, p) => { written.push(p); },
  });

  it('a lone admin\'s settings change in a circle whose admins decide together is not applied', async () => {
    const written = [];
    const r = await applyPolicyUpdates(args(rail([founding, body()]), written));
    expect(r.version).toBe(1);   // the founding policy stands; version 2 is refused
    expect(written.map((p) => p.chat)).not.toContain('off');
  });

  it('the same change carried with the approved proposal is applied', async () => {
    const written = [];
    expect((await applyPolicyUpdates(args(rail([founding, body({ proposalId: 'p2' })], approved('p2', 'changePolicy', { chat: 'off' })), written))).version).toBe(2);
    expect(written.at(-1)?.chat).toBe('off');
  });

  it('A TIGHTENING STAYS (Opus\'s rollback case): any-admin founding, an admin\'s v2 asks for votes from now on, re-applied: still member-vote', async () => {
    const loose = normalizeCirclePolicy({ governance: { changePolicy: 'any-admin' } });
    const tight = normalizeCirclePolicy({ governance: { changePolicy: 'member-vote' } });
    const lane = rail([
      { kind: POLICY_UPDATE_KIND, author: 'a0', hash: 'h1', payload: { policy: loose, version: 1 } },
      { kind: POLICY_UPDATE_KIND, author: 'a1', hash: 'h2', payload: { policy: tight, version: 2 } },   // under any-admin: no vote needed
    ]);
    const headStore = makePolicyHeadStore(memIo());
    let local = loose;
    const a = { rail: lane, circleId: CIRCLE, headStore, membersOf: async () => members, readPolicy: async () => local, writePolicy: async (_c, p) => { local = p; } };
    await applyPolicyUpdates(a);
    expect(local.governance.changePolicy).toBe('member-vote');
    await applyPolicyUpdates(a);   // the next landing re-applies the lane: v2 is still judged by the rule BEFORE it
    expect(local.governance.changePolicy).toBe('member-vote');
  });

  it('a version 1 by someone who did not found the circle is judged by the founding rule, never exempt', async () => {
    const vote = normalizeCirclePolicy({ governance: { changePolicy: 'member-vote' } });
    const loose = normalizeCirclePolicy({ governance: { changePolicy: 'any-admin' } });
    let local = null;
    const lane = rail([
      { kind: POLICY_UPDATE_KIND, author: 'a0', hash: 'h1', payload: { policy: vote, version: 1 } },        // the founder's
      { kind: POLICY_UPDATE_KIND, author: 'a1', hash: 'h1z', payload: { policy: loose, version: 1 } },      // another admin's "version 1"
    ]);
    await applyPolicyUpdates({ rail: lane, circleId: CIRCLE, headStore: makePolicyHeadStore(memIo()), membersOf: async () => members, readPolicy: async () => local, writePolicy: async (_c, p) => { local = p; } });
    expect(local.governance.changePolicy).toBe('member-vote');
  });
});

describe('a rules change is judged by the settings version its author held', () => {
  const loose = normalizeCirclePolicy({ governance: { changeRule: 'any-admin', changePolicy: 'any-admin' } });
  const tight = normalizeCirclePolicy({ governance: { changeRule: 'admin-quorum', changePolicy: 'any-admin' } });
  const members = roster.map((m) => ({ webid: m.webid, role: m.role, ...(m.webid === 'a0' ? { adminVia: 'founder' } : {}) }));
  const policyLane = [
    { kind: POLICY_UPDATE_KIND, author: 'a0', hash: 'p1', payload: { policy: loose, version: 1 } },
    { kind: POLICY_UPDATE_KIND, author: 'a0', hash: 'p2', payload: { policy: tight, version: 2 } },
  ];
  const call = (recorded) => async (_app, op, args) => {
    if (op === 'listGroupMembers') return { members };
    if (op === 'recordGroupRulesUpdate') { recorded.push(args); return { applied: true }; }
    return {};
  };
  const rulesBody = (author, extra) => ({ kind: 'rules-update', author, hash: `r-${author}`, payload: { rules, version: 2, ...extra } });

  it('a change made under the loose rule (stamped 1) stands after the circle tightened (version 2)', async () => {
    const recorded = [];
    const r = await applyRulesUpdates({ rail: rail([...policyLane, rulesBody('a1', { policyVersion: 1 })]), callSkill: call(recorded), circleId: CIRCLE, readPolicy: async () => tight });
    expect(r.applied).toBe(true);
  });

  it('an author who WROTE the tightening cannot stamp below it', async () => {
    const recorded = [];
    const r = await applyRulesUpdates({ rail: rail([...policyLane, rulesBody('a0', { policyVersion: 1 })]), callSkill: call(recorded), circleId: CIRCLE, readPolicy: async () => tight });
    expect(r.applied).toBe(false);
  });

  it('the line is the author\'s own chain: a change they signed BEFORE their tightening keeps its stamp', async () => {
    // a0's own governance chain: p1 ← r-before ← p2 (the tightening) ← r-after
    const lane = [
      { kind: POLICY_UPDATE_KIND, author: 'a0', hash: 'p1', parentHash: null, payload: { policy: loose, version: 1 } },
      { kind: 'rules-update', author: 'a0', hash: 'r-before', parentHash: 'p1', payload: { rules, version: 2, policyVersion: 1 } },
      { kind: POLICY_UPDATE_KIND, author: 'a0', hash: 'p2', parentHash: 'r-before', payload: { policy: tight, version: 2 } },
    ];
    expect((await applyRulesUpdates({ rail: rail(lane), callSkill: call([]), circleId: CIRCLE, readPolicy: async () => tight })).applied, 'signed before the line').toBe(true);
    const after = { kind: 'rules-update', author: 'a0', hash: 'r-after', parentHash: 'p2', payload: { rules, version: 3, policyVersion: 1 } };
    const recorded = [];
    await applyRulesUpdates({ rail: rail([...lane, after]), callSkill: call(recorded), circleId: CIRCLE, readPolicy: async () => tight });
    expect(recorded.map((x) => x.version ?? x.rules?.version ?? x), 'signed after the line, stamped below it: not applied').not.toContain(3);
    expect(recorded.map((x) => x.version ?? x.rules?.version ?? x), 'the change before the line is the one applied').toContain(2);
  });
  it('a stamp the chain does not know yet waits; no stamp is judged by the rule in force now', async () => {
    expect((await applyRulesUpdates({ rail: rail([...policyLane, rulesBody('a1', { policyVersion: 9 })]), callSkill: call([]), circleId: CIRCLE, readPolicy: async () => tight })).applied).toBe(false);
    expect((await applyRulesUpdates({ rail: rail([...policyLane, rulesBody('a1', {})]), callSkill: call([]), circleId: CIRCLE, readPolicy: async () => tight })).applied).toBe(false);
  });
});

describe('a decided change carries the proposal that decided it', async () => {
  const { makeCircleGovernance } = await import('../../src/v2/governanceHost.js');
  const { policyEnactor } = await import('../../src/v2/governanceAppWiring.js');
  const host = (setPolicy = null) => {
    const events = []; let n = 0;
    const calls = [];
    const gov = makeCircleGovernance({
      callSkill: async (app, op, args) => { calls.push([op, args]); return { ok: true }; },
      readGovernanceState: async () => ({ events, disputed: new Set() }),
      appendGovernanceEvent: async (_c, e) => { events.push(e); },
      getPolicy: async () => quorum, getMembers: async () => [{ ref: 'a0', role: 'admin' }, { ref: 'a1', role: 'admin' }],
      localActorRef: 'a0', newProposalId: () => `p${(n += 1)}`, now: () => 0, setPolicy,
    });
    return { gov, calls, events };
  };

  it('a rules change both admins approved reaches editGroupRules with its proposal id', async () => {
    const { gov, calls, events } = host();
    const { proposalId } = await gov.propose({ circleId: CIRCLE, action: 'changeRule', subject: rules, actor: { ref: 'a0' } });
    // the other admin's yes arrives as THEIR event (a device votes only as its own self); this device then tallies
    events.push(voteEvent({ proposalId, voter: 'a1', choice: 'yes', at: 0 }));
    await gov.vote({ circleId: CIRCLE, proposalId, voter: 'a0', choice: 'yes' });
    expect(calls.find(([op]) => op === 'editGroupRules')?.[1]).toEqual({ groupId: CIRCLE, rules, proposalId });
  });

  it('a settings change both admins approved is stated with its proposal id', async () => {
    const stated = [];
    const { gov, events } = host(policyEnactor({ setPolicy: async () => {}, statePolicy: async (cid, meta) => { stated.push(meta); return { body: {} }; } }));
    const { proposalId } = await gov.propose({ circleId: CIRCLE, action: 'changePolicy', subject: { chat: 'off' }, actor: { ref: 'a0' } });
    events.push(voteEvent({ proposalId, voter: 'a1', choice: 'yes', at: 0 }));
    await gov.vote({ circleId: CIRCLE, proposalId, voter: 'a0', choice: 'yes' });
    expect(stated).toEqual([{ proposalId }]);
  });
});
