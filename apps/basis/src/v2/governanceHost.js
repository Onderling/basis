/**
 * basis v2 — governance host factory (Phase 4 §5, L4 — shared wiring).
 *
 * Binds the pure orchestrator to the real circle substrate so both shells drive governance
 * the same way (invariant 1 — the wiring lives once). It maps each governed action to the
 * EXISTING op (removeMember / editGroupRules via callSkill; policy + key rotation via
 * injected seams — it never reimplements them), reads the context (policy + full roster +
 * the governance events folded off the one log stream), and gates enactment to admins.
 *
 * Decision A (docs/decisions.md 2026-07-25): only an admin/caretaker device enacts an
 * approved decision. `canEnact` is "am I an admin in the current roster" — and because a
 * newly-appointed caretaker IS an admin in that roster, the same rule makes it the enactor
 * with no special case.
 */
import { makeGovernanceOrchestrator } from './governanceOrchestrator.js';
import { autoEnacts } from './circlePolicy.js';
import { foldGovernance } from './governanceLog.js';
import { buildGovernanceView } from './governanceView.js';
import { foldDisputes } from './governanceChain.js';

/**
 * @param {object} deps
 * @param {(origin:string, op:string, args:object)=>Promise<*>} deps.callSkill
 * @param {(circleId:string)=>Promise<Array<object>>} deps.readGovernanceEvents  governance entries off the log
 * @param {(circleId:string, event:object)=>Promise<*>} deps.appendGovernanceEvent  write to the log stream
 * @param {(circleId:string)=>Promise<object>} deps.getPolicy
 * @param {(circleId:string)=>Promise<Array<{ref:string, role?:string}>>} deps.getMembers  full roster
 * @param {string} deps.localActorRef                 this device's member ref (enact-authority check)
 * @param {(circleId:string, patch:object)=>Promise<*>} [deps.setPolicy]   enactor for changeRule/changePolicy
 * @param {(circleId:string)=>Promise<*>} [deps.rotateKey]                 enactor for rotateKey
 * @param {()=>string} deps.newProposalId
 * @param {()=>number} [deps.now]
 */
export function makeCircleGovernance({
  callSkill, readGovernanceEvents, appendGovernanceEvent, getPolicy, getMembers,
  localActorRef, setPolicy = null, rotateKey = null, newProposalId, now = () => 0,
  readGovernanceState = null,
}) {
  // Map a governed action to the REAL op. removeMember/editGroupRules are stoop skills;
  // policy + key rotation are injected seams (their routing isn't a plain callSkill op).
  async function enact(circleId, action, subject) {
    if (action === 'removeMember') return callSkill('stoop', 'removeMember', { groupId: circleId, memberWebid: subject, policy: 'graceful' });
    if (action === 'changeRule')   return callSkill('stoop', 'editGroupRules', { groupId: circleId, rules: subject });
    if (action === 'changePolicy') return setPolicy ? setPolicy(circleId, subject) : { ok: false, error: 'no-setPolicy' };
    if (action === 'rotateKey')    return rotateKey ? rotateKey(circleId) : { ok: false, error: 'no-rotateKey' };
    return { ok: false, error: 'unknown-action' };
  }

  async function getContext(circleId) {
    // THE RAIL: when the wiring supplies a VERIFIED state reader, the fold's input is the rail's —
    // signature-verified, binding-resolved events + the disputed set from real fork-proofs. The legacy path
    // (unsigned chained events + foldDisputes) stands for compositions without a circle signer.
    if (typeof readGovernanceState === 'function') {
      const [policy, members, state] = await Promise.all([
        getPolicy(circleId), getMembers(circleId), readGovernanceState(circleId),
      ]);
      return {
        policy, members: Array.isArray(members) ? members : [],
        events: Array.isArray(state?.events) ? state.events : [],
        disputed: state?.disputed instanceof Set ? state.disputed : new Set(),
      };
    }
    const [policy, members, events] = await Promise.all([
      getPolicy(circleId), getMembers(circleId), readGovernanceEvents(circleId),
    ]);
    const evts = Array.isArray(events) ? events : [];
    // L3: the set of authors caught equivocating on the chained governance events.
    const disputed = foldDisputes({ events: evts });
    return { policy, members: Array.isArray(members) ? members : [], events: evts, disputed };
  }

  // Decision A: an admin (or the appointed caretaker, who is an admin in the roster) enacts.
  const canEnact = (ctx) => (ctx.members || []).some((m) => m && m.ref === localActorRef && m.role === 'admin');

  const orch = makeGovernanceOrchestrator({
    appendEvent: appendGovernanceEvent, enact, getContext, newProposalId, now, canEnact,
  });

  /** The current governance view-model for a circle (the shells render this). */
  async function view(circleId, { labelForSubject } = {}) {
    let ctx = await getContext(circleId);
    // 'auto' enactment (circle setting): an admin device enacts an approved decision the moment it
    // SEES one, with no explicit tap. `view` is called on every governance ingest and re-render, so
    // settling here is the trigger — gated to admins by `settle`/`tally`'s own `canEnact` (a member
    // device's settle is a no-op), and to circles that chose 'auto'. The default 'settle' skips this
    // entirely: an approved decision waits, and the shell shows "waiting for an admin to enact".
    // Re-read the context afterward so the view reflects any proposal this settle just closed.
    if (autoEnacts(ctx.policy) && canEnact(ctx)) {
      try { await settle(circleId); ctx = await getContext(circleId); } catch { /* view must still render */ }
    }
    const me = (ctx.members || []).find((m) => m && m.ref === localActorRef) || null;
    const fold = foldGovernance(ctx.events, { policy: ctx.policy, members: ctx.members, now: now(), disputed: ctx.disputed });
    const base = buildGovernanceView({ fold, viewer: me, labelForSubject });
    // L3: surface the disputed authors (equivocators) so the shell can prompt "review & remove".
    const disputed = [...ctx.disputed].map((ref) => ({ ref, label: labelForSubject ? labelForSubject(ref, 'removeMember') : ref }));
    return { ...base, disputed, hasDisputed: disputed.length > 0 };
  }

  /**
   * SETTLE — enact any decision that is already APPROVED but was never enacted (Decision B, 2026-07-26).
   *
   * Enactment only ever ran as a side effect of a LOCAL `vote()`/`override()`. So when the tipping vote was
   * cast on a MEMBER's device and merely fanned here, this device folded APPROVED and stopped: every screen
   * read "Approved" while the member was never actually removed (three-device story 3.2).
   *
   * The chosen fix is an EXPLICIT admin sweep rather than enacting on ingest — a received message must not
   * by itself cause this device to remove someone; a human stays in the loop for the irreversible act. On a
   * non-admin device this is a no-op by construction: `tally` returns `awaitingEnactment` without acting.
   *
   * Idempotent: a proposal already closed is skipped, so calling it repeatedly (e.g. whenever the panel
   * opens) is safe.
   *
   * @param {string} circleId
   * @returns {Promise<{enacted: number, results: object[]}>}
   */
  async function settle(circleId) {
    const ctx = await getContext(circleId);
    const fold = foldGovernance(ctx.events, { policy: ctx.policy, members: ctx.members, now: now(), disputed: ctx.disputed });
    const open = (fold.proposals ?? []).filter((p) => p && !p.closed);
    const results = [];
    for (const p of open) {
      try { results.push(await orch.tally({ circleId, proposalId: p.proposalId, enactor: localActorRef })); }
      catch { /* one bad proposal must not block the rest */ }
    }
    return { enacted: results.filter((r) => r?.enacted === true).length, results };
  }

  return { propose: orch.propose, vote: orch.vote, override: orch.override, tally: orch.tally, view, settle, getContext };
}
