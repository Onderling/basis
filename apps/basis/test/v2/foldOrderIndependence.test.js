import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { foldGovernance } from '../../src/v2/governanceLog.js';
import { EventLog } from '../../src/eventLog.js';
import { makeChatRail } from '../../src/v2/chatRail.js';

// The Lamport-coordinate sweep's acceptance: every fold/merge that decides SUPERSEDENCE is
// ORDER-INDEPENDENT — two devices folding the same statements in different arrival orders reach the
// same result, and a writer-stamped wall clock can never resurrect a superseded thing.

const POLICY = { decisions: { changeRules: 'member-vote' } };
const MEMBERS = [{ ref: 'a', role: 'admin' }, { ref: 'b', role: 'member' }, { ref: 'c', role: 'member' }];

const fold = (events) => foldGovernance(events, { policy: POLICY, members: MEMBERS, now: 10_000 });
const tallyOf = (r) => {
  const p = r.proposals[0];
  const yes = p.decision?.tally?.yes ?? null;
  return { yes, status: p.status };
};

describe('governance fold — order independence (the sweep)', () => {
  const propose = { kind: 'governance', event: 'propose', proposalId: 'p1', action: 'changeRules', by: 'a', at: 1, hash: 'hp', parentHash: null };

  it('a REVOTE supersedes by the voter\'s own CHAIN — even when the wall clock lies', () => {
    // b votes yes (v1), then revotes no (v2, chained after v1) — but v2 carries an OLDER `at`
    // (clock skew / back-dating). The chain must win: the final vote is NO on every device.
    const v1 = { kind: 'governance', event: 'vote', proposalId: 'p1', voter: 'b', choice: 'yes', at: 500, hash: 'hv1', parentHash: 'hp0' };
    const v2 = { kind: 'governance', event: 'vote', proposalId: 'p1', voter: 'b', choice: 'no',  at: 100, hash: 'hv2', parentHash: 'hv1' };

    for (const order of [[propose, v1, v2], [propose, v2, v1], [v2, v1, propose]]) {
      const p = fold(order).proposals[0];
      const bVotes = p.decision?.tally ?? {};
      // one final vote for b, and it is the CHAIN-LATER one (no) — regardless of arrival order or `at`.
      expect(p.votes.filter((v) => v.voter === 'b')).toHaveLength(2);   // raw votes both recorded
      expect(bVotes.yes ?? 0).toBe(0);                                  // …but the tally counts only v2
    }
  });

  it('competing PROPOSES for one id settle deterministically (smallest hash), in any order', () => {
    const pA = { kind: 'governance', event: 'propose', proposalId: 'p1', action: 'changeRules', by: 'a', at: 1, hash: 'aaa', parentHash: null };
    const pB = { kind: 'governance', event: 'propose', proposalId: 'p1', action: 'changeRules', by: 'b', at: 2, hash: 'bbb', parentHash: null };
    const r1 = fold([pA, pB]).proposals[0];
    const r2 = fold([pB, pA]).proposals[0];
    expect(r1.by).toBe(r2.by);
    expect(r1.by).toBe('a');   // 'aaa' < 'bbb' — the same winner everywhere
  });

  it('competing RESOLVES settle deterministically too', () => {
    const rA = { kind: 'governance', event: 'resolve', proposalId: 'p1', status: 'approved', by: 'a', at: 5, hash: 'r-aaa' };
    const rB = { kind: 'governance', event: 'resolve', proposalId: 'p1', status: 'rejected', by: 'b', at: 6, hash: 'r-bbb' };
    const s1 = fold([propose, rA, rB]).proposals[0].status;
    const s2 = fold([propose, rB, rA]).proposals[0].status;
    expect(s1).toBe(s2);
    expect(s1).toBe('approved');   // 'r-aaa' < 'r-bbb'
  });
});

describe('chat lane — a resend converges regardless of arrival order (the sweep)', () => {
  const CIRCLE = 'circle:order';

  async function sender(ref) {
    const cid = await AgentIdentity.generate(new VaultMemory());
    const rail = makeChatRail({
      eventLog: new EventLog({ initial: [] }),
      circleIdentityFor: async () => cid, myRef: ref,
      callSkill: async () => ({}), verifyBinding: async () => true,
    });
    return { cid, rail };
  }
  async function receiver(senderCid) {
    const eventLog = new EventLog({ initial: [] });
    const cid = await AgentIdentity.generate(new VaultMemory());
    const rail = makeChatRail({
      eventLog, circleIdentityFor: async () => cid, myRef: 'webid:recv',
      callSkill: async () => ({}),
      verifyBinding: async ({ author }) => author === senderCid.pubKey,
    });
    return { eventLog, rail };
  }

  it('S1 then S2 ≡ S2 then S1 — both devices keep the CHAIN-LATER version', async () => {
    const a = await sender('webid:ada');
    const s1 = (await a.rail.appendMessage(CIRCLE, { msgId: 'm', ts: 1, text: 'v1' })).statement;
    const s2 = (await a.rail.appendMessage(CIRCLE, { msgId: 'm', ts: 2, text: 'v2' })).statement;   // chains after s1

    const x = await receiver(a.cid);
    await x.rail.ingest(CIRCLE, s1);
    await x.rail.ingest(CIRCLE, s2);
    const y = await receiver(a.cid);
    await y.rail.ingest(CIRCLE, s2);
    const stale = await y.rail.ingest(CIRCLE, s1);   // the catch-up's late duplicate of the OLD version

    expect(stale.existed).toBe(true);                // recognized as superseded, not re-landed
    const onX = x.eventLog.query({}).find((e) => e.id === 'm');
    const onY = y.eventLog.query({}).find((e) => e.id === 'm');
    expect(onX.payload.text).toBe('v2');
    expect(onY.payload.text).toBe('v2');             // CONVERGED — arrival order did not decide
  });
});
