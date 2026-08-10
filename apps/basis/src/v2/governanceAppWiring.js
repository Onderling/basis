/**
 * basis v2 — governance app wiring (Phase 4 §5, L4 — shared shell binder).
 *
 * Binds the governance host factory to the concrete circle substrate ONCE (invariant 1),
 * so the web shell (circleApp) and the mobile shell (CircleLauncher) drive governance
 * identically. Governance events ride the one EventLog as silent system entries of kind
 * `governance` (payload = the event); the full membership is assembled from the roster op
 * plus this device's own row (listGroupRoster excludes the caller).
 */
import { makeCircleGovernance } from './governanceHost.js';
import { GOVERNANCE_KIND, governanceEntryId, foldGovernance } from './governanceLog.js';
import { chainEvent, authorHead } from './governanceChain.js';
import { makeCircleEntryRail } from './circleEntryRail.js';

/** The statement kinds the governance lane declares — the fold's own event vocabulary. */
export const GOVERNANCE_RAIL_KINDS = ['propose', 'vote', 'resolve'];

/**
 * Build the governance RAIL: signed, circle-scoped, chained entries on the device log.
 * Shared by the write side (bindCircleGovernance) and the receive side (kringLogReceiver) so both
 * ends verify against the same declaration + binding rules. `circleIdentityFor` is the per-circle
 * signer resolver (realAgent's surface); `myRef` the member ref it represents. The key↔ref binding
 * for FOREIGN statements verifies against the roster's proof-checked circleAddress rows.
 */
export function makeGovernanceRail({ eventLog, circleIdentityFor, myRef, callSkill, verifyBinding = null }) {
  if (typeof circleIdentityFor !== 'function') return null;
  const defaultVerifyBinding = async ({ author, ref, circleId }) => {
    try {
      const r = await callSkill('stoop', 'listGroupRoster', { groupId: circleId });
      return (Array.isArray(r?.members) ? r.members : []).some((m) =>
        m && m.circleAddress === author && (m.addr ?? m.webid ?? m.ref) === ref);
    } catch { return false; }
  };
  return makeCircleEntryRail({
    eventLog,
    signerFor: async (circleId) => ({ identity: await circleIdentityFor(circleId), ref: myRef }),
    entryKind: GOVERNANCE_KIND,
    declaredKinds: GOVERNANCE_RAIL_KINDS,
    verifyBinding: verifyBinding ?? defaultVerifyBinding,
  });
}
import { makeCircleReports } from './reportHost.js';
import { REPORT_KIND, REPORT_EVENT, reportEntryId } from './reportModel.js';

/** The author of a governance event — the voter (a vote) or the proposer/enactor (propose/resolve). */
function authorOf(event) {
  return (event && (event.voter ?? event.by)) || null;
}

/**
 * The FULL circle membership as `{ref, role}` — the roster's other members plus me.
 * Role is authoritative from `policy.admins` when present; otherwise the roster's own role,
 * with a sole-admin fallback (if no admin appears among the others, I am the admin).
 */
export async function readCircleMembers({ callSkill, circleId, myRef, getPolicy }) {
  let others = [];
  try {
    const r = await callSkill('stoop', 'listGroupRoster', { groupId: circleId });
    others = (Array.isArray(r?.members) ? r.members : [])
      .map((m) => ({ ref: m.addr ?? m.webid ?? m.ref, role: m.role === 'admin' ? 'admin' : 'member' }))
      .filter((m) => m.ref);
  } catch { others = []; }

  let policy = {};
  try { policy = (await getPolicy(circleId)) ?? {}; } catch { policy = {}; }
  const admins = Array.isArray(policy.admins) ? policy.admins : [];
  const applyPolicyRole = (m) => (admins.length ? { ...m, role: admins.includes(m.ref) ? 'admin' : 'member' } : m);
  others = others.map(applyPolicyRole);

  const iAmAdmin = admins.length ? admins.includes(myRef) : !others.some((m) => m.role === 'admin');
  const me = myRef ? [{ ref: myRef, role: iAmAdmin ? 'admin' : 'member' }] : [];
  const seen = new Set(me.map((m) => m.ref));
  return [...me, ...others.filter((m) => !seen.has(m.ref))];
}

/**
 * Build a circle-governance handle wired to this shell's substrate.
 * @param {object} deps
 * @param {{query:Function, appendSilentEntry:Function}} deps.eventLog  the one circle log
 * @param {(origin:string,op:string,args:object)=>Promise<*>} deps.callSkill
 * @param {(circleId:string)=>Promise<object>} deps.getPolicy
 * @param {string} deps.myRef            this device's member ref (webid)
 * @param {()=>string} deps.genId        fresh proposal ids
 * @param {()=>number} [deps.now]
 * @param {(channel:'governance'|'report', circleId:string, event:object, opts?:{to?:string[]})=>void} [deps.broadcast]
 *   fan a just-appended event to the circle's members (the shell wires it to the stoop
 *   broadcastKring{Governance,Report} skill). Absent ⇒ local-only (single-device).
 *   `opts.to` NARROWS the recipient set — the report channel passes the circle's admin refs, so a report
 *   never lands on the device of the person it is about.
 */
export function bindCircleGovernance({ eventLog, callSkill, getPolicy, myRef, genId, now = () => Date.now(), broadcast = null, removeReported = null, circleIdentityFor = null, setPolicy = null }) {
  // The cutover switch: with a per-circle signer resolver, governance rides the RAIL (signed,
  // circle-scoped, receiver-verified). Without one (legacy compositions/tests) the unsigned path stands.
  const rail = makeGovernanceRail({ eventLog, circleIdentityFor, myRef, callSkill });
  const fan = (channel, circleId, event, opts = undefined) => {
    if (typeof broadcast !== 'function') return;
    try { broadcast(channel, circleId, event, opts); } catch { /* fan is best-effort — never block the local write */ }
  };
  const readGovernanceEvents = async (circleId) => eventLog
    .query({})
    .filter((e) => e && e.type === GOVERNANCE_KIND && e.circleId === circleId && e.payload)
    .map((e) => e.payload);
  // L3: hash-chain each event to its author's previous head before it lands, so equivocation
  // (two events by one author from the same parent) is detectable across replicas. A STABLE
  // entry id (from the chain hash) lets the local copy + any fanned/received copy collapse.
  const appendGovernanceEvent = async (circleId, event) => {
    // THE RAIL: the event becomes a SIGNED chained statement — kind = the event verb, subject =
    // the proposalId, everything else rides the signed payload. The fan carries the STATEMENT; receivers
    // verify before it lands (kringLogReceiver + the rail's ingest). Falls to the legacy unsigned path only
    // when no circle signer resolves (cutover safety — one path per composition).
    if (rail) {
      const { event: verb, proposalId, kind: _k, ...payload } = event ?? {};
      const res = await rail.append(circleId, { kind: verb, subject: proposalId, payload });
      if (res) { fan('governance', circleId, res.statement); return res.entry; }
    }
    const author = authorOf(event);
    let payload = event;
    if (author) {
      const existing = await readGovernanceEvents(circleId);
      payload = chainEvent(event, { author, parentHash: authorHead(existing, author) });
    }
    const entry = eventLog.appendSilentEntry({ circleId, kind: GOVERNANCE_KIND, payload, id: governanceEntryId(payload) });
    fan('governance', circleId, payload);   // propagate to members (best-effort)
    return entry;
  };
  const getMembers = (circleId) => readCircleMembers({ callSkill, circleId, myRef, getPolicy });

  const governance = makeCircleGovernance({
    callSkill, readGovernanceEvents, appendGovernanceEvent, getPolicy, getMembers,
    localActorRef: myRef, newProposalId: genId, now, setPolicy,
    // Rail read: VERIFIED events + the disputed (equivocator) ref set — replaces the unsigned fold input.
    readGovernanceState: rail ? ((circleId) => rail.readVerified(circleId)) : null,
  });

  // §8 reporting — rides the same log (kind `report`, unchained: admin records, not votes);
  // a member-target ban routes through the governance handle above (its removeMember class).
  const readReportEvents = async (circleId) => eventLog
    .query({})
    .filter((e) => e && e.type === REPORT_KIND && e.circleId === circleId && e.payload)
    .map((e) => e.payload);
  // The circle's ADMIN refs — who a report may be shown to. Read from the same membership the governance
  // fold uses, so "admin" means one thing in this file.
  const adminRefsOf = async (circleId) => {
    try { return (await getMembers(circleId)).filter((m) => m.role === 'admin').map((m) => m.ref).filter(Boolean); }
    catch { return []; }
  };
  const iAmAdmin = async (circleId) => (await adminRefsOf(circleId)).includes(myRef);

  // A report is fanned ONLY to the circle's admins (story 3.6). It used to go to every member, which put the
  // reporter's identity and the free-text reason about the REPORTED person onto that person's own device —
  // the `if (isAdmin)` in each shell was hiding it, not withholding it. `to` narrows the recipient set at the
  // broadcast seam; an empty admin list means nobody but the local writer holds it, which is the safe end.
  /** Who filed the report this event concerns — the REPORT event carries it directly; a RESOLVE event only
   *  names the reportId, so we look the original up in the local log. */
  const reporterOf = async (circleId, event) => {
    if (typeof event?.by === 'string' && event.event === REPORT_EVENT.REPORT) return event.by;
    if (typeof event?.reportId !== 'string') return null;
    const events = await readReportEvents(circleId);
    const original = events.find((e) => e?.event === REPORT_EVENT.REPORT && e.reportId === event.reportId);
    return typeof original?.by === 'string' ? original.by : null;
  };

  // Admins ∪ the REPORTER. Admins because the report is for them to act on; the reporter because otherwise
  // narrowing the fan silently strands them — they would never learn their own report was actioned or
  // dismissed, and it would sit "open" on their device forever. Everyone ELSE (in particular the person
  // being reported) is excluded, which is the point (story 3.6).
  const appendReportEvent = async (circleId, event) => {
    const entry = eventLog.appendSilentEntry({ circleId, kind: REPORT_KIND, payload: event, id: reportEntryId(event) });
    const reporter = await reporterOf(circleId, event);
    const to = [...new Set([...(await adminRefsOf(circleId)), ...(reporter ? [reporter] : [])])];
    fan('report', circleId, event, { to });
    return entry;
  };
  const reports = makeCircleReports({
    readReportEvents, appendReportEvent, governance, removeReported, newReportId: genId, localActorRef: myRef, now,
    isAdmin: iAmAdmin,
  });

  return { ...governance, reports, rail };
}

/**
 * The OPEN changePolicy proposals for a circle — the settings screens' pending list + the launcher badge.
 * Folded from the governance context (rail-verified when the bind has a circle signer), so a settings
 * proposal raised on ANY admin device shows on every device: the pending list rides the log, not a
 * device-local side-store. Each row: { proposalId, subject (the policy patch), by, votes, decision }.
 */
export async function openPolicyProposals(gov, circleId, { now = Date.now() } = {}) {
  const ctx = await gov.getContext(circleId);
  const fold = foldGovernance(ctx.events, {
    policy: ctx.policy, members: ctx.members, now, disputed: ctx.disputed,
  });
  return {
    proposals: (fold.proposals ?? []).filter((p) => !p.closed && p.action === 'changePolicy'),
    members: ctx.members,
  };
}
