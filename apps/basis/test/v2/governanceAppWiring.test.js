/**
 * Governance app wiring (Phase 4 §5, L4) — the shared shell binder.
 *
 * Locks the substrate binding both shells depend on: governance events round-trip through
 * the EventLog (append as a governance-kind silent entry → read back by circle), and the
 * membership is the DERIVED roster (`listGroupMembers`), which already includes this device (listGroupRoster
 * excludes), with roles honoured.
 */
import { describe, it, expect, vi } from 'vitest';
import { readCircleMembers, bindCircleGovernance } from '../../src/v2/governanceAppWiring.js';
import { EventLog } from '../../src/eventLog.js';
import { normalizeCirclePolicy } from '../../src/v2/circlePolicy.js';
import { DECISION_STATUS } from '../../src/v2/governanceDecision.js';
import { AgentIdentity, signSpine } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

const mkCid = () => AgentIdentity.generate(new VaultMemory());

describe('readCircleMembers', () => {
  // The DERIVED roster already contains this device, with the role the circle's own statements give
  // it — so these read one source in one ref space (webid) and append nothing.
  const derived = (rows) => vi.fn(async (origin, op) => (op === 'listGroupMembers' ? { members: rows } : { ok: true }));

  it('reads the derived roster as-is — every member, in webid space', async () => {
    const callSkill = derived([
      { webid: 'admin0', role: 'admin' }, { webid: 'm1', role: 'member' }, { webid: 'me', role: 'member' },
    ]);
    const members = await readCircleMembers({ callSkill, circleId: 'c1', myRef: 'me', getPolicy: async () => ({}) });
    expect(members).toContainEqual({ ref: 'me', role: 'member' });
    expect(members).toContainEqual({ ref: 'admin0', role: 'admin' });
    expect(members).toHaveLength(3);
    expect(callSkill).toHaveBeenCalledWith('stoop', 'listGroupMembers', { groupId: 'c1' });
  });

  it('does NOT invent a seat: someone the roster omits is not a member, whoever is asking', async () => {
    // The retired behaviour appended the caller unconditionally, so a device held an opinion about
    // its own membership the circle did not share. Absence is the circle's answer, not a gap to fill.
    const callSkill = derived([{ webid: 'm1', role: 'member' }]);
    const members = await readCircleMembers({ callSkill, circleId: 'c1', myRef: 'me', getPolicy: async () => ({}) });
    expect(members.find((m) => m.ref === 'me')).toBeUndefined();
    expect(members).toHaveLength(1);
  });

  it('does NOT make itself admin when the roster shows no admin', async () => {
    // The retired sole-admin fallback: "if no admin appears among the others, I am the admin". An
    // admin-less roster is a real state (it is what the caretaker exists for), not a cue to promote.
    const callSkill = derived([{ webid: 'me', role: 'member' }, { webid: 'm1', role: 'member' }]);
    const members = await readCircleMembers({ callSkill, circleId: 'c1', myRef: 'me', getPolicy: async () => ({}) });
    expect(members.find((m) => m.ref === 'me').role).toBe('member');
    expect(members.some((m) => m.role === 'admin')).toBe(false);
  });

  it('policy.admins is authoritative when present — compared in the SAME ref space as the rows', async () => {
    const callSkill = derived([{ webid: 'm1', role: 'member' }, { webid: 'me', role: 'admin' }]);
    const members = await readCircleMembers({ callSkill, circleId: 'c1', myRef: 'me', getPolicy: async () => ({ admins: ['m1'] }) });
    expect(members.find((m) => m.ref === 'm1').role).toBe('admin');
    expect(members.find((m) => m.ref === 'me').role).toBe('member');   // not in policy.admins
  });
});

describe('bindCircleGovernance — EventLog round-trip', () => {
  it('a proposal + votes ride the EventLog and re-read as a resolvable proposal', async () => {
    const eventLog = new EventLog({ initial: [] });
    const policy = normalizeCirclePolicy({ governance: { removeMember: 'any-admin' } });
    const callSkill = vi.fn(async (origin, op) => {
      // admin0 is this circle's admin, and the DERIVED roster says so — it is no longer inferred
      // from "nobody else looks like one".
      if (op === 'listGroupMembers') {
        return { members: [{ webid: 'admin0', role: 'admin' }, { webid: 'm1', role: 'member' }] };
      }
      if (op === 'listGroupRoster') return { members: [{ addr: 'm1', role: 'member' }] };
      return { ok: true };   // removeMember enactor
    });
    let n = 0;
    const cid = await mkCid();
    const gov = bindCircleGovernance({
      eventLog, callSkill, getPolicy: async () => policy, myRef: 'admin0', genId: () => `p${(n += 1)}`, now: () => 1,
      circleIdentityFor: async () => cid,
    });
    // admin0 is the circle's admin per the roster → any-admin removeMember enacts immediately
    const r = await gov.propose({ circleId: 'c1', action: 'removeMember', subject: 'm1', actor: { ref: 'admin0' } });
    expect(r.status).toBe(DECISION_STATUS.APPROVED);
    expect(callSkill).toHaveBeenCalledWith('stoop', 'removeMember', { groupId: 'c1', memberWebid: 'm1', policy: 'graceful' });
    // the propose + resolve entries are in the log as SIGNED statements, scoped to the circle
    const govEntries = eventLog.query({}).filter((e) => e.type === 'governance' && e.circleId === 'c1');
    expect(govEntries.map((e) => e.payload.body.kind).sort()).toEqual(['propose', 'resolve']);
    for (const e of govEntries) expect(e.payload.sig).toBeTruthy();
  });

  it('L3: an equivocating author is disputed and their votes are discounted from the tally', async () => {
    const eventLog = new EventLog({ initial: [] });
    const policy = normalizeCirclePolicy({ governance: { removeMember: 'member-vote' } });
    // full membership: admin0 + m0 + m1 + m2 (need 3 of 4 for a majority). m0's roster row carries his
    // circleAddress so his (equivocating) statements resolve their key↔ref binding on this device.
    const m0cid = await mkCid();
    // The rail's default binding is the DERIVED roster's set-aware verifier (listGroupMembers rows:
    // webid + proven circleAddress/set) — the same shape both shells project; listGroupRoster stays
    // the flat routing list the membership reader consumes.
    // The DERIVED roster carries every member INCLUDING this device (admin0) — that is what makes
    // the membership four, and it is stated here rather than reconstructed by the reader.
    const rosterRows = [
      { addr: 'admin0', webid: 'admin0', role: 'admin' },
      { addr: 'm0', webid: 'm0', role: 'member', circleAddress: m0cid.pubKey },
      { addr: 'm1', webid: 'm1', role: 'member' },
      { addr: 'm2', webid: 'm2', role: 'member' },
    ];
    const callSkill = vi.fn(async (origin, op) => (op === 'listGroupRoster' || op === 'listGroupMembers'
      ? { members: rosterRows }
      : { ok: true }));
    let n = 0;
    const cid = await mkCid();
    const gov = bindCircleGovernance({ eventLog, callSkill, getPolicy: async () => policy, myRef: 'admin0', genId: () => `p${(n += 1)}`, now: () => 1, circleIdentityFor: async () => cid });

    // admin0 opens a removeMember vote (auto-casts its own yes → 1/4).
    const { proposalId } = await gov.propose({ circleId: 'c1', action: 'removeMember', subject: 'm2', actor: { ref: 'admin0' }, deadline: 100 });

    // m0 EQUIVOCATES: two conflicting SIGNED votes on p1 from the same (genesis) parent — "yes" to one
    // peer, "no" to another. Ingested through the rail gate (simulating cross-partition delivery).
    const yes = signSpine(m0cid, { kind: 'vote', circleId: 'c1', subject: proposalId, payload: { voter: 'm0', choice: 'yes', at: 2, authorRef: 'm0' }, parent: null });
    const no  = signSpine(m0cid, { kind: 'vote', circleId: 'c1', subject: proposalId, payload: { voter: 'm0', choice: 'no',  at: 3, authorRef: 'm0' }, parent: null });
    expect((await gov.rail.ingest('c1', yes)).ok).toBe(true);
    expect((await gov.rail.ingest('c1', no)).ok).toBe(true);

    const v = await gov.view('c1');
    // m0 is flagged disputed…
    expect(v.hasDisputed).toBe(true);
    expect(v.disputed.map((d) => d.ref)).toContain('m0');
    // …and their vote does NOT count: the tally shows only admin0's yes (1 of 4), still pending.
    const row = v.open.find((r) => r.proposalId === proposalId);
    expect(row.tally).toEqual({ yes: 1, no: 0, need: 3, of: 4 });
    expect(row.status).toBe(DECISION_STATUS.PENDING);
  });

  it('governance entries are scoped per circle (another circle does not see them)', async () => {
    const eventLog = new EventLog({ initial: [] });
    const policy = normalizeCirclePolicy({ governance: { removeMember: 'member-vote' } });
    const callSkill = vi.fn(async (origin, op) => (op === 'listGroupRoster' ? { members: [{ addr: 'm1', role: 'member' }, { addr: 'm2', role: 'member' }] } : { ok: true }));
    let n = 0;
    const cid = await mkCid();
    const gov = bindCircleGovernance({ eventLog, callSkill, getPolicy: async () => policy, myRef: 'admin0', genId: () => `p${(n += 1)}`, now: () => 1, circleIdentityFor: async () => cid });
    await gov.propose({ circleId: 'c1', action: 'removeMember', subject: 'm2', actor: { ref: 'admin0' }, deadline: 100 });
    const otherCircle = eventLog.query({}).filter((e) => e.type === 'governance' && e.circleId === 'c2');
    expect(otherCircle).toHaveLength(0);
  });
});
