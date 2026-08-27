/**
 * The remaining three-device stories — §1.3/1.7 · §2.1/2.5 · §3.4 · §5.1/5.2 · §6.1/6.3 of
 * `plans/NOTE-multi-device-user-stories.md`.
 *
 * These sit in subsystems that ARE well covered at the unit level (handle uniqueness, the caretaker
 * election, the view-as gate, task grants). The corpus adds only what a unit test structurally cannot say:
 * what happens when several actors touch the same state, and whether every replica lands in the SAME place.
 * So each block here is about CONVERGENCE, RACE or the un-acted-on third party — never about re-testing a
 * pure function that already has its own suite.
 *
 * Cast: Anna (admin) · Bram · Cato.
 */
import { describe, it, expect } from 'vitest';
import { appointCaretaker, caretakerOrder, needsCaretaker } from '../src/v2/governanceCaretaker.js';
import { viewAsDirectory, revealedMemberLabel } from '../src/v2/circleViewAs.js';
import { memberPersonaView } from '../src/v2/memberCards.js';
import { foldGovernance } from '../src/v2/governanceLog.js';
import { normalizeCirclePolicy } from '../src/v2/circlePolicy.js';
import { proposeEvent, voteEvent } from '../src/v2/governanceLog.js';
import { AgentIdentity, TaskGrantManager } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import {
  generateKeypair, buildGroupKeyResource, generateGroupKey, grantMember,
  rotateGroupKeyResource, unwrapGroupKey,
} from '@onderling/pod-client';

const canOpen = (r, pk) => { try { return !!unwrapGroupKey(r, pk); } catch { return false; } };

// ── §2.5 — the last admin leaves: every device must elect the SAME caretaker ─────────────────────────
describe('2.5 — two devices independently land on the same caretaker', () => {
  const candidates = [
    { ref: 'did:bram', address: 'addr-bram' },
    { ref: 'did:cato', address: 'addr-cato' },
    { ref: 'did:dana', address: 'addr-dana' },
  ];

  it('the election is deterministic — same inputs, same answer on every replica', () => {
    const onBram = appointCaretaker({ candidates, departingHash: 'h-anna' });
    const onCato = appointCaretaker({ candidates: [...candidates].reverse(), departingHash: 'h-anna' });
    // Input ORDER must not matter: two devices holding the roster in different orders must still agree.
    expect(onCato).toEqual(onBram);
  });

  it('a DIFFERENT departing admin can yield a different caretaker — the hash really is an input', () => {
    // Asserted over SEVERAL seeds rather than two named ones. Three candidates permit six orders, so
    // any particular pair collides about one time in six — the old version compared exactly two
    // hashes and was one coincidence away from failing for a reason that says nothing about the
    // rule. The claim is that the seed is an input at all, so ask whether the seed ever changes the
    // answer, not whether these two happen to differ.
    const seeds = ['h-anna', 'h-someone-else', 'h-third', 'h-fourth', 'h-fifth', 'h-sixth', 'h-seventh'];
    const orders = new Set(seeds.map((h) => caretakerOrder({ candidates, departingHash: h })
      .map((c) => c.ref).join(',')));
    expect(orders.size).toBeGreaterThan(1);
    expect(seeds.every((h) => appointCaretaker({ candidates, departingHash: h }))).toBe(true);
  });

  it('an UNREACHABLE first choice still resolves identically on both devices', () => {
    const opts = { candidates, departingHash: 'h-anna', unreachable: ['did:bram'] };
    expect(appointCaretaker(opts)).toEqual(appointCaretaker({ ...opts, candidates: [...candidates].reverse() }));
  });

  it('a circle that still has an admin needs no caretaker at all', () => {
    expect(needsCaretaker([{ ref: 'did:anna', role: 'admin' }, { ref: 'did:bram', role: 'member' }])).toBe(false);
    expect(needsCaretaker([{ ref: 'did:bram', role: 'member' }])).toBe(true);
  });
});

// ── §3.4 — two decisions open at once must not contaminate each other ────────────────────────────────
describe('3.4 — concurrent conflicting decisions stay independent', () => {
  const members = [
    { ref: 'admin0', role: 'admin' }, { ref: 'm0', role: 'member' },
    { ref: 'm1', role: 'member' }, { ref: 'm2', role: 'member' },
  ];
  const policy = normalizeCirclePolicy({ governance: { removeMember: 'member-vote', changeRule: 'member-vote' } });

  it('a vote on one proposal never counts toward the other', () => {
    const events = [
      proposeEvent({ proposalId: 'p1', action: 'removeMember', subject: 'm2', by: 'admin0', at: 1 }),
      proposeEvent({ proposalId: 'p2', action: 'changeRule', subject: null, by: 'm0', at: 1 }),
      voteEvent({ proposalId: 'p1', voter: 'm0', choice: 'yes', at: 2 }),
      voteEvent({ proposalId: 'p1', voter: 'm1', choice: 'yes', at: 2 }),
    ];
    const fold = foldGovernance(events, { policy, members, now: 3 });
    const p1 = fold.proposals.find((p) => p.proposalId === 'p1');
    const p2 = fold.proposals.find((p) => p.proposalId === 'p2');
    expect(p1.decision.tally.yes).toBe(2);
    expect(p2.decision.tally.yes).toBeLessThan(2);        // p1's votes did not bleed across
  });

  it('the fold is order-independent — two devices receiving them in different orders agree', () => {
    const evs = [
      proposeEvent({ proposalId: 'p1', action: 'removeMember', subject: 'm2', by: 'admin0', at: 1 }),
      voteEvent({ proposalId: 'p1', voter: 'm0', choice: 'yes', at: 2 }),
      proposeEvent({ proposalId: 'p2', action: 'changeRule', subject: null, by: 'm0', at: 1 }),
      voteEvent({ proposalId: 'p2', voter: 'm1', choice: 'yes', at: 2 }),
    ];
    const tallies = (list) => Object.fromEntries(
      foldGovernance(list, { policy, members, now: 3 }).proposals.map((p) => [p.proposalId, p.decision.tally.yes]),
    );
    expect(tallies([...evs].reverse())).toEqual(tallies(evs));
  });
});

// ── §5.1 / §5.2 — reveal is per-circle and DIRECTIONAL ───────────────────────────────────────────────
// Revealing is the DISCLOSER's act (decision 19). A member who released their name to this circle is
// name-visible to circle members; one who released nothing shows only their handle. Per-VIEWER
// targeting ("release to Anna but not Cato") is the recorded future extension — no revealer-side
// per-viewer fact exists today, so the circle is the audience unit. The old fixtures encoded the
// INVERTED model (a viewer-side `reveals[]` deciding), and passed for the wrong reason.
describe('5.1 / 5.2 — a name is visible because its owner released it', () => {
  const bram = { id: 'bram', handle: 'fox', realName: 'Bram', released: true };    // released his name here
  const cato = { id: 'cato', handle: 'heron', realName: null, released: false, ownDisplayName: 'Cato' };

  it('a member who RELEASED shows their name to circle members; one who did not is withheld', () => {
    expect(memberPersonaView({ member: bram, viewerWebid: 'anna' }).sees.map((a) => a.key)).toContain('realName');
    expect(memberPersonaView({ member: bram, viewerWebid: 'cato' }).sees.map((a) => a.key)).toContain('realName');
    const catoAsAnna = memberPersonaView({ member: cato, viewerWebid: 'anna' });
    expect(catoAsAnna.sees.map((a) => a.key)).not.toContain('realName');
    expect(JSON.stringify(catoAsAnna.sees)).not.toContain('Cato');
  });

  it('DEFERRED (decision 19): per-viewer targeting is a future extension, not today', () => {
    // Today a release is circle-scoped — no way to release to Anna but not Cato. This asserts the
    // CURRENT truth so the day directional release lands, THIS is the test that changes, on purpose.
    expect(memberPersonaView({ member: bram, viewerWebid: 'anna' }).sees.map((a) => a.key))
      .toEqual(memberPersonaView({ member: bram, viewerWebid: 'cato' }).sees.map((a) => a.key));
  });

  it('the per-circle POLICY still flows through', () => {
    const rowFor = (policy) => viewAsDirectory({ members: [bram, cato], viewer: { kind: 'member', id: 'cato' }, policy })
      .find((r) => r.id === 'bram');
    expect(rowFor('pairwise').revealed).toBe(true);        // Bram released → visible pairwise
    expect(rowFor('pairwise').displayName).toBe('Bram');
    expect(rowFor('open').revealed).toBe(true);
    expect(rowFor('open').displayName).toBe('Bram');
  });

  it('an `open` circle WIDENS a release but never conjures a name nobody disclosed', () => {
    const rowFor = (policy) => viewAsDirectory({ members: [cato], viewer: { kind: 'member', id: 'bram' }, policy })
      .find((r) => r.id === 'cato');
    expect(rowFor('open').revealed).toBe(false);           // Cato released nothing → handle even in open
    expect(rowFor('open').displayName).toBe('heron');
  });

  it('a stranger/agent viewer never clears the member gate', () => {
    for (const kind of ['stranger', 'agent']) {
      const [row] = viewAsDirectory({ members: [bram], viewer: { kind }, policy: 'pairwise' });
      expect(row.revealed).toBe(false);
      expect(row.displayName).not.toBe('Bram');
    }
  });
});

// ── §1.3 / §1.7 — grants over time: re-grant after revoke, and a mandate's lifetime ───────────────────
describe('1.3 — revoke, then grant someone else', () => {
  it('the new grantee reads; the revoked one\'s retained key opens nothing new', () => {
    const controller = generateKeypair();
    const bram = generateKeypair();
    const cato = generateKeypair();

    let res = buildGroupKeyResource({ version: 1, groupKey: generateGroupKey(), recipients: [controller.publicKey] });
    res = grantMember(res, { newRecipient: bram.publicKey, granterPrivateKey: controller.privateKey, currentRecipients: res.recipients });
    expect(canOpen(res, bram.privateKey)).toBe(true);

    res = rotateGroupKeyResource({ previous: res, recipients: [controller.publicKey] });   // revoke Bram
    res = grantMember(res, { newRecipient: cato.publicKey, granterPrivateKey: controller.privateKey, currentRecipients: res.recipients });

    expect(canOpen(res, cato.privateKey)).toBe(true);     // the later grantee is in…
    expect(canOpen(res, bram.privateKey)).toBe(false);    // …and the revoked one stays out
  });
});

describe('1.7 — a mandate does not outlive its task', () => {
  it('completing the task revokes ITS grants and leaves an unrelated task\'s alone', async () => {
    const granter = await AgentIdentity.generate(new VaultMemory());
    const mgr = new TaskGrantManager({ identity: granter, agentId: granter.pubKey });
    const bram = await AgentIdentity.generate(new VaultMemory());
    const cato = await AgentIdentity.generate(new VaultMemory());

    const forT1 = await mgr.attachGrant({ taskId: 't1', memberPubKey: bram.pubKey, grant: { skill: 'calendar.write' } });
    const forT2 = await mgr.attachGrant({ taskId: 't2', memberPubKey: cato.pubKey, grant: { skill: 'calendar.write' } });

    const { revokedTokenIds } = await mgr.revokeTaskGrants('t1');
    expect(revokedTokenIds).toContain(forT1.id);
    expect(revokedTokenIds).not.toContain(forT2.id);      // the bystander task is untouched
  });
});

// ── §6.1 / §6.3 — one person, two devices ────────────────────────────────────────────────────────────
describe('6.1 / 6.3 — a person\'s own two devices', () => {
  it('6.1 — the same member ref votes once, however many devices they hold', () => {
    const members = [
      { ref: 'anna', role: 'admin' }, { ref: 'bram', role: 'member' },
      { ref: 'cato', role: 'member' }, { ref: 'dana', role: 'member' },
    ];
    const policy = normalizeCirclePolicy({ governance: { removeMember: 'member-vote' } });
    const events = [
      proposeEvent({ proposalId: 'p1', action: 'removeMember', subject: 'dana', by: 'anna', at: 1 }),
      voteEvent({ proposalId: 'p1', voter: 'bram', choice: 'yes', at: 2 }),   // Bram's phone
      voteEvent({ proposalId: 'p1', voter: 'bram', choice: 'yes', at: 3 }),   // Bram's laptop — same person
    ];
    const p = foldGovernance(events, { policy, members, now: 4 }).proposals.find((x) => x.proposalId === 'p1');
    // Bram voted from two devices; he counts ONCE. (A bare `proposeEvent` carries no auto-vote, so the
    // whole tally here is Bram — which is exactly what makes the dedup visible.)
    expect(p.decision.tally.yes).toBe(1);
  });

  it('6.3 — losing a DEVICE is not losing membership: the member ref is unchanged', () => {
    // A device is not a member; the roster keys on the member ref, so revoking one device cannot
    // silently drop the person from the tally.
    const members = [{ ref: 'anna', role: 'admin' }, { ref: 'bram', role: 'member' }];
    const policy = normalizeCirclePolicy({ governance: { removeMember: 'member-vote' } });
    const events = [
      proposeEvent({ proposalId: 'p1', action: 'removeMember', subject: 'x', by: 'anna', at: 1 }),
      voteEvent({ proposalId: 'p1', voter: 'bram', choice: 'yes', at: 2 }),
    ];
    const p = foldGovernance(events, { policy, members, now: 3 }).proposals.find((x) => x.proposalId === 'p1');
    expect(p.decision.tally.of).toBe(2);                  // still a 2-member circle
  });
});

// ── ✅ FIXED 2026-07-26 — the members list is reveal-gated (Frits's call) ────────────────────────────
//
// `normalizeCircleMembers` carries `realName` UNGATED (the MemberMap display cache holds names whether or
// not the member revealed — why item-author names are gated at READ time). Both members lists rendered it
// straight, so an unrevealed member's real name could appear in the main list. `revealedMemberLabel` now
// computes the label ONCE for both shells.
describe('5.2b — the members list respects the reveal gate', () => {
  const unrevealed = { id: 'bram', handle: 'fox', realName: null, released: false, ownDisplayName: 'Bram de Vries' };
  const revealed   = { id: 'cato', handle: 'heron', realName: 'Cato Jansen', released: true };

  it('an UNRELEASED member shows their handle — never their name, in either line', () => {
    const l = revealedMemberLabel(unrevealed, { viewerId: 'me', policy: 'pairwise' });
    expect(l.primary).toBe('@fox');
    expect(l.secondary).toBeNull();
    expect(JSON.stringify(l)).not.toContain('Vries');
  });

  it('a member who RELEASED their name shows it as the secondary line', () => {
    const l = revealedMemberLabel(revealed, { viewerId: 'me', policy: 'pairwise' });
    expect(l.primary).toBe('@heron');
    expect(l.secondary).toBe('Cato Jansen');
  });

  it('with NO handle it falls back to the id, never to the withheld name', () => {
    const l = revealedMemberLabel({ id: 'did:bram', realName: 'Bram de Vries', reveals: [] }, { viewerId: 'me' });
    expect(l.primary).toBe('did:bram');
    expect(l.primary).not.toContain('Vries');
  });

  it('an `open` circle shows RELEASED names, and my OWN row always shows mine', () => {
    // Unreleased Bram: even open shows only his handle — open widens a release, it never conjures one.
    expect(revealedMemberLabel(unrevealed, { viewerId: 'me', policy: 'open' }).secondary).toBeNull();
    // …but my OWN row falls back to my local cache — I always see myself.
    expect(revealedMemberLabel({ ...unrevealed, id: 'me' }, { viewerId: 'me' }).secondary).toBe('Bram de Vries');
  });

  it('a viewer with no identity yet (null) sees nothing revealed — fail-closed', () => {
    expect(revealedMemberLabel(unrevealed, { viewerId: null }).secondary).toBeNull();
  });
});
