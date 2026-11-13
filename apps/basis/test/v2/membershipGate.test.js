/**
 * THE MEMBERSHIP LANE'S GATE (the host side the roster fold asks): a removal or a role change takes effect only where
 * the circle's rule allowed it, judged by the settings version the statement carries (Opus: a removal made under
 * any-admin stays valid after the circle tightens).
 */
import { describe, it, expect } from 'vitest';
import { membershipGateFor, judgePolicyChain } from '../../src/v2/governanceReceiverGate.js';
import { foldGovernance, proposeEvent, voteEvent } from '../../src/v2/governanceLog.js';
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
});
