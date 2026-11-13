/**
 * EVERY MEMBER'S DEVICE REFUSES A RULES OR SETTINGS CHANGE THAT SKIPPED THE VOTE (L663 Q3: kept, never applied).
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
  const body = (extra = {}) => ({ kind: POLICY_UPDATE_KIND, author: 'a0', hash: 'h2', payload: { policy: stated, version: 2, ...extra } });
  const args = (r, written) => ({
    rail: r, circleId: CIRCLE, headStore: makePolicyHeadStore(memIo()),
    membersOf: async () => roster.map((m) => ({ ref: m.webid, role: m.role })),
    readPolicy: async () => quorum,
    writePolicy: async (_c, p) => { written.push(p); },
  });

  it('a lone admin\'s settings change in a circle whose admins decide together is not applied', async () => {
    const written = [];
    expect((await applyPolicyUpdates(args(rail([body()]), written))).applied).toBe(false);
    expect(written).toEqual([]);
  });

  it('the same change carried with the approved proposal is applied', async () => {
    const written = [];
    expect((await applyPolicyUpdates(args(rail([body({ proposalId: 'p2' })], approved('p2', 'changePolicy', { chat: 'off' })), written))).applied).toBe(true);
    expect(written[0]?.chat).toBe('off');
  });
});
