/**
 * THE MEMBERSHIP LANE'S GATE (the host side the roster fold asks): a removal or a role change takes effect only where
 * the circle's rule allowed it, judged by the settings version the statement carries (Opus: a removal made under
 * any-admin stays valid after the circle tightens).
 */
import { describe, it, expect } from 'vitest';
import { membershipGateFor, judgePolicyChain } from '../../src/v2/governanceReceiverGate.js';
import { foldGovernance, proposeEvent, voteEvent, resolveEvent } from '../../src/v2/governanceLog.js';
import { normalizeCirclePolicy } from '../../src/v2/circlePolicy.js';

const members = [{ ref: 'a0', role: 'admin', via: 'founder' }, { ref: 'a1', role: 'admin' }, { ref: 'm0', role: 'member' }, { ref: 'm1', role: 'member' }];
const admins = new Set(['a0', 'a1']);
const loose = normalizeCirclePolicy({ governance: { removeMember: 'any-admin', changePolicy: 'any-admin' } });
const tight = normalizeCirclePolicy({ governance: { removeMember: 'admin-quorum', changePolicy: 'admin-quorum' } });
const chain = judgePolicyChain({ bodies: [
  { kind: 'policy-update', author: 'a0', hash: 'p1', payload: { policy: loose, version: 1 } },
  { kind: 'policy-update', author: 'a0', hash: 'p2', payload: { policy: tight, version: 2 } },
], members, proposals: [] });
const evict = (author, subject, extra = {}) => ({ kind: 'evict', author, subject, hash: `e-${author}-${subject}`, payload: { ...extra } });

describe('the membership gate', () => {
  it('a removal made under the loose rule (stamped 1) stands after the circle tightened', () => {
    expect(membershipGateFor({ chain, currentPolicy: tight, members })(evict('a1', 'm0', { policyVersion: 1 }), { admins })).toBe(true);
  });
  it('under the tight rule a lone removal does not take effect; with both admins\' yes it does', () => {
    const gate = membershipGateFor({ chain, currentPolicy: tight, members });
    expect(gate(evict('a1', 'm0', { policyVersion: 2 }), { admins })).toBe(false);
    const proposals = foldGovernance([
      proposeEvent({ proposalId: 'p9', action: 'removeMember', subject: 'm0', by: 'a1', at: 0 }),
      voteEvent({ proposalId: 'p9', voter: 'a1', choice: 'yes', at: 0 }),
      voteEvent({ proposalId: 'p9', voter: 'a0', choice: 'yes', at: 0 }),
    ].map((e) => ({ ...e, kind: 'governance' })), { policy: tight, members, now: 1 }).proposals;
    const voted = membershipGateFor({ chain, currentPolicy: tight, members, proposals });
    expect(voted(evict('a1', 'm0', { policyVersion: 2, proposalId: 'p9' }), { admins })).toBe(true);
    expect(voted(evict('a1', 'm1', { policyVersion: 2, proposalId: 'p9' }), { admins })).toBe(false);   // the vote was about m0
  });
  it('the author who WROTE the tightening cannot stamp a removal below it; an unknown stamp does not take effect yet', () => {
    const gate = membershipGateFor({ chain, currentPolicy: tight, members });
    expect(gate(evict('a0', 'm0', { policyVersion: 1 }), { admins })).toBe(false);
    expect(gate(evict('a1', 'm0', { policyVersion: 7 }), { admins })).toBe(false);
  });
  it('the line is the author\'s OWN chain: what they signed before their tightening keeps its stamp, what they sign after does not', () => {
    // a0's membership chain: e1 (the removal, under any-admin) ← e2; the tightening (version 2) names e2 as where it stood
    const e1 = { kind: 'evict', author: 'a0', authorKey: 'k0', subject: 'm0', hash: 'e1', parentHash: null, payload: { policyVersion: 1 } };
    const e2 = { kind: 'role', author: 'a0', authorKey: 'k0', subject: 'a1', hash: 'e2', parentHash: 'e1', payload: { role: 'admin', policyVersion: 1 } };
    const later = { kind: 'evict', author: 'a0', authorKey: 'k0', subject: 'm1', hash: 'e3', parentHash: 'e2', payload: { policyVersion: 1 } };   // backdated stamp
    const forked = { kind: 'evict', author: 'a0', authorKey: 'k0', subject: 'm1', hash: 'e4', parentHash: 'e1', payload: { policyVersion: 1 } }; // claims an early parent
    const raw = new Map([e1, e2, later, forked].map((b) => [b.hash, { ...b, author: 'k0' }]));   // the stored lane holds raw keys
    const lined = judgePolicyChain({ bodies: [
      { kind: 'policy-update', author: 'a0', hash: 'p1', payload: { policy: loose, version: 1 } },
      { kind: 'policy-update', author: 'a0', hash: 'p2', payload: { policy: tight, version: 2, membershipUpTo: 'e2' } },
    ], members, proposals: [] });
    const gate = () => membershipGateFor({ chain: lined, currentPolicy: tight, members, chainOf: (h) => raw.get(h) ?? null });
    expect(gate()(e1, { admins }), 'the removal before the line stands').toBe(true);
    expect(gate()(later, { admins }), 'after the line, a stamp below it does not').toBe(false);
    expect(gate()(forked, { admins }), 'nor one that claims an early parent').toBe(false);
  });
  it('an author\'s stamps never go back in the fold\'s order', () => {
    const gate = membershipGateFor({ chain, currentPolicy: tight, members });
    expect(gate(evict('a1', 'm0', { policyVersion: 2 }), { admins })).toBe(false);   // needs a vote (and moves a1's floor to 2)
    expect(gate(evict('a1', 'm1', { policyVersion: 1 }), { admins })).toBe(false);   // a1 had already signed under 2
  });
  it('a role change follows the settings class and must be about the same member and role', () => {
    const role = (subject, r, extra) => ({ kind: 'role', author: 'a1', subject, hash: `r-${subject}`, payload: { role: r, ...extra } });
    expect(membershipGateFor({ chain, currentPolicy: tight, members })(role('m0', 'admin', { policyVersion: 1 }), { admins })).toBe(true);
    expect(membershipGateFor({ chain, currentPolicy: tight, members })(role('m0', 'admin', { policyVersion: 2 }), { admins })).toBe(false);
  });
  it('a stamp up to the highest version SEEN is judged (a refused version included); only beyond it does it wait', () => {
    const refusedV3 = judgePolicyChain({ bodies: [
      { kind: 'policy-update', author: 'a0', hash: 'p1', payload: { policy: loose, version: 1 } },
      { kind: 'policy-update', author: 'a0', hash: 'p2', payload: { policy: tight, version: 2 } },
      { kind: 'policy-update', author: 'a1', hash: 'p3', payload: { policy: loose, version: 3 } },   // a lone loosening: refused
    ], members, proposals: [] });
    expect(refusedV3.head).toBe(2);
    expect(refusedV3.seen).toBe(3);
    const gate = membershipGateFor({ chain: refusedV3, currentPolicy: tight, members });
    expect(gate(evict('a1', 'm0', { policyVersion: 3 }), { admins })).toBe(false);   // judged by v2's tight rule, not waiting
    expect(gate(evict('a1', 'm1', { policyVersion: 9 }), { admins })).toBe(false);   // unseen: waits
  });
  it('NO DEVICE CLOCK: an admin\'s override is judged at the resolve\'s own signed time', () => {
    const vote = normalizeCirclePolicy({ governance: { removeMember: 'member-vote', changePolicy: 'any-admin' } });
    const voteChain = judgePolicyChain({ bodies: [{ kind: 'policy-update', author: 'a0', hash: 'v1', payload: { policy: vote, version: 1 } }], members, proposals: [] });
    const fold = (resolveAt) => foldGovernance([
      proposeEvent({ proposalId: 'p7', action: 'removeMember', subject: 'm0', by: 'a1', deadline: 100, at: 0 }),
      voteEvent({ proposalId: 'p7', voter: 'a1', choice: 'yes', at: 0 }),
      resolveEvent({ proposalId: 'p7', status: 'approved', by: 'a1', at: resolveAt }),
    ].map((e) => ({ ...e, kind: 'governance' })), { policy: vote, members, now: 1 }).proposals;
    const gate = (proposals) => membershipGateFor({ chain: voteChain, currentPolicy: vote, members, proposals });
    expect(gate(fold(150))(evict('a1', 'm0', { policyVersion: 1, proposalId: 'p7' }), { admins })).toBe(true);    // overridden after the deadline
    expect(gate(fold(50))(evict('a1', 'm0', { policyVersion: 1, proposalId: 'p7' }), { admins })).toBe(false);    // an "override" before it
  });
});
