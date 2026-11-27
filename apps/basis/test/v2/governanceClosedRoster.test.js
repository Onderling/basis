/**
 * A CLOSED DECISION STANDS ON ITS ADMIN'S CLOSING. A member-vote decided 1 of 1 was re-tallied by every device against
 * the roster as it is NOW: one join later it needed 2 of 2, and the change it carried was refused everywhere, the
 * deciding admin's own device included (two phones and a browser walk, 2026-11-27). Now the admin who closes a
 * decision names the members it counted, signed in the closing, and a closed decision is tallied against that list.
 * Only an admin's closing does that (an admin who admits alone could already reach any roster by admitting); a closing
 * by anyone else keeps "the roster as it is now". Open decisions are unchanged.
 */
import { describe, it, expect } from 'vitest';
import { writeSkippedTheVote } from '../../src/v2/governanceReceiverGate.js';
import { foldGovernance, proposeEvent, voteEvent, resolveEvent } from '../../src/v2/governanceLog.js';
import { makeGovernanceOrchestrator } from '../../src/v2/governanceOrchestrator.js';
import { normalizeCirclePolicy } from '../../src/v2/circlePolicy.js';

const policy = normalizeCirclePolicy({ governance: { changePolicy: 'member-vote' } });
const ADMIN = 'ref-admin'; const LATE = 'ref-late'; const MEMBER = 'ref-member';
const change = { features: { tasks: true } };
const body = (proposalId) => ({ payload: { policy: { ...policy, ...change, features: { ...policy.features, tasks: true } }, proposalId } });
let h = 0;
const signed = (e) => ({ ...e, hash: `h${String(h += 1).padStart(4, '0')}` });
const proposalsFor = (events, members) => foldGovernance(events, { policy, members, now: 0 }).proposals;

describe('a closed decision is tallied against the members its admin counted', () => {
  it('decided 1 of 1 and closed by the admin: a later join does not reopen it (whatever that join says about when)', () => {
    const events = [
      signed(proposeEvent({ proposalId: 'p1', action: 'changePolicy', subject: change, by: ADMIN, at: 10 })),
      signed(voteEvent({ proposalId: 'p1', voter: ADMIN, choice: 'yes', at: 11 })),
      signed(resolveEvent({ proposalId: 'p1', status: 'approved', by: ADMIN, at: 12, counted: [ADMIN] })),
    ];
    const now = [{ ref: ADMIN, role: 'admin' }, { ref: LATE, role: 'member' }];
    const skipped = writeSkippedTheVote({ action: 'changePolicy', body: body('p1'), policy, members: now, proposals: proposalsFor(events, now) });
    expect(skipped, 'the late joiner un-decided a closed decision').toBe(false);
  });

  it('an OPEN decision still counts the roster as it is now', () => {
    const events = [
      signed(proposeEvent({ proposalId: 'p2', action: 'changePolicy', subject: change, by: ADMIN, at: 10 })),
      signed(voteEvent({ proposalId: 'p2', voter: ADMIN, choice: 'yes', at: 11 })),
    ];
    const now = [{ ref: ADMIN, role: 'admin' }, { ref: LATE, role: 'member' }];
    expect(writeSkippedTheVote({ action: 'changePolicy', body: body('p2'), policy, members: now, proposals: proposalsFor(events, now) })).toBe(true);
  });

  it('a MEMBER who signs a closing with a list of one does not win alone', () => {
    const events = [
      signed(proposeEvent({ proposalId: 'p3', action: 'changePolicy', subject: change, by: MEMBER, at: 10 })),
      signed(voteEvent({ proposalId: 'p3', voter: MEMBER, choice: 'yes', at: 11 })),
      signed(resolveEvent({ proposalId: 'p3', status: 'approved', by: MEMBER, at: 1, counted: [MEMBER] })),
    ];
    const now = [{ ref: ADMIN, role: 'admin' }, { ref: MEMBER, role: 'member' }];
    expect(writeSkippedTheVote({ action: 'changePolicy', body: body('p3'), policy, members: now, proposals: proposalsFor(events, now) })).toBe(true);
  });

  it("an admin's closing wins over a member's competing one, whatever their hashes", () => {
    const events = [
      signed(proposeEvent({ proposalId: 'p4', action: 'changePolicy', subject: change, by: ADMIN, at: 10 })),
      signed(voteEvent({ proposalId: 'p4', voter: ADMIN, choice: 'yes', at: 11 })),
      { ...resolveEvent({ proposalId: 'p4', status: 'rejected', by: MEMBER, at: 13, counted: [ADMIN, MEMBER] }), hash: 'a0000' },
      { ...resolveEvent({ proposalId: 'p4', status: 'approved', by: ADMIN, at: 12, counted: [ADMIN] }), hash: 'z9999' },
    ];
    const now = [{ ref: ADMIN, role: 'admin' }, { ref: MEMBER, role: 'member' }];
    const p = proposalsFor(events, now).find((x) => x.proposalId === 'p4');
    expect(p).toMatchObject({ closedBy: ADMIN, counted: [ADMIN], status: 'approved' });
  });

  it('the orchestrator closes with the members it tallied against', async () => {
    const log = [];
    const members = [{ ref: ADMIN, role: 'admin' }];
    const orch = makeGovernanceOrchestrator({
      appendEvent: async (_c, e) => { log.push(signed(e)); },
      enact: async () => ({ ok: true }),
      getContext: async () => ({ events: log, policy, members, disputed: new Set() }),
      newProposalId: () => 'p5', now: () => 100, canEnact: () => true,
    });
    await orch.propose({ circleId: 'c', action: 'changePolicy', subject: change, actor: { ref: ADMIN } });
    const resolve = log.find((e) => e.event === 'resolve');
    expect(resolve, 'the decision closed').toBeTruthy();
    expect(resolve.counted).toEqual([ADMIN]);
  });
});
