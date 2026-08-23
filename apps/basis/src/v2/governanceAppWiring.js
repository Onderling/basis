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
import { GOVERNANCE_KIND, foldGovernance } from './governanceLog.js';
import { makeCircleEntryRail } from './circleEntryRail.js';
import { entryKindRegistryFromManifests } from '@onderling/item-store';
import { governanceManifest, GOVERNANCE_LANE } from './governanceManifest.js';
import { rosterBindingVerifier } from './membershipRail.js';

/** The statement kinds the governance lane carries — DERIVED from the manifest's declared `appends` rows
 *  (the declared route: the manifest is the source; the rail enforces it at append AND ingest). They are the
 *  fold's own event vocabulary (propose/vote/resolve), so the projection needs no mapping table. */
export const GOVERNANCE_RAIL_KINDS = entryKindRegistryFromManifests(governanceManifest).kindsFor(GOVERNANCE_LANE);

/**
 * Build the governance RAIL: signed, circle-scoped, chained entries on the device log.
 * Shared by the write side (bindCircleGovernance) and the receive side (circleLogReceiver) so both
 * ends verify against the same declaration + binding rules. `circleIdentityFor` is the per-circle
 * signer resolver (realAgent's surface); `myRef` the member ref it represents. The key↔ref binding
 * for FOREIGN statements verifies against the roster's proof-checked circleAddress rows.
 */
export function makeGovernanceRail({ eventLog, circleIdentityFor, myRef, callSkill, verifyBinding = null }) {
  if (typeof circleIdentityFor !== 'function') return null;
  // The default binding is the SAME set-aware verifier the membership rail uses (the derived
  // roster's proven circleAddress SET, add-a-device aware). The old inline default read
  // `listGroupRoster` — whose rows are flat `{addr, role}` and carry NO circleAddress — so it
  // could never match a foreign author: every fanned statement from another member was silently
  // refused as "unverifiable key-ref binding" wherever a composition relied on the default
  // (found 2026-08-20 while putting rules-updates on this lane; the harness had been supplying
  // the binding explicitly, which is why node repros passed).
  return makeCircleEntryRail({
    eventLog,
    signerFor: async (circleId) => ({ identity: await circleIdentityFor(circleId), ref: myRef }),
    entryKind: GOVERNANCE_KIND,
    declaredKinds: GOVERNANCE_RAIL_KINDS,
    verifyBinding: verifyBinding ?? rosterBindingVerifier(callSkill),
  });
}
import { makeCircleReports } from './reportHost.js';
import { REPORT_KIND, REPORT_EVENT, reportEntryId } from './reportModel.js';

/**
 * The circle's membership as `{ref, role}` — the electorate every governance fold counts against.
 *
 * ONE SOURCE, ONE REF SPACE. `ref` is a **webid**, because that is what a governance statement's
 * `voter`/`by` carries. This used to read `listGroupRoster`, whose rows are per-circle ADDRESSES,
 * and map them straight into `ref` — two spaces that never meet, so any comparison against an actor
 * (`policy.admins`, an admin-vote's `isAdmin(v.voter)`) silently matched nobody. `listGroupMembers`
 * is the DERIVED roster: it carries `webid`, it folds the membership spine, and it is the same
 * source the rail's binding verifier and the rules-update apply gate read.
 *
 * The local person is NOT appended separately, and there is no "if no admin appears among the
 * others, I am the admin" fallback. Both existed because `listGroupRoster` excludes the caller;
 * `listGroupMembers` includes them, with the role the circle's own statements give them. Assuming
 * your own authority when the roster is silent is the habit this whole arc exists to remove.
 */
export async function readCircleMembers({ callSkill, circleId, myRef, getPolicy }) {
  let members = [];
  try {
    const r = await callSkill('stoop', 'listGroupMembers', { groupId: circleId });
    members = (Array.isArray(r?.members) ? r.members : [])
      .map((m) => ({ ref: m.webid ?? m.pubKey ?? m.ref, role: m.role === 'admin' ? 'admin' : 'member' }))
      .filter((m) => m.ref);
  } catch { members = []; }

  // `policy.admins`, when a circle sets one, overrides the roster's role. It is compared against
  // `ref`, so it must be written in the same webid space the rows now carry.
  let policy = {};
  try { policy = (await getPolicy(circleId)) ?? {}; } catch { policy = {}; }
  const admins = Array.isArray(policy.admins) ? policy.admins : [];
  if (admins.length) {
    members = members.map((m) => ({ ...m, role: admins.includes(m.ref) ? 'admin' : 'member' }));
  }

  const seen = new Set();
  return members.filter((m) => (seen.has(m.ref) ? false : (seen.add(m.ref), true)));
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
 *   broadcastCircle{Governance,Report} skill). Absent ⇒ local-only (single-device).
 *   `opts.to` NARROWS the recipient set — the report channel passes the circle's admin refs, so a report
 *   never lands on the device of the person it is about.
 */
export function bindCircleGovernance({ eventLog, callSkill, getPolicy, myRef, genId, now = () => Date.now(), broadcast = null, removeReported = null, circleIdentityFor = null, setPolicy = null }) {
  // Governance rides the RAIL, period: signed, circle-scoped, receiver-verified. The unsigned legacy
  // path was deleted with the cutover (one chained-statement primitive remains — signSpine); a composition
  // without a per-circle signer is a wiring bug, surfaced here rather than as silently-unsigned governance.
  const rail = makeGovernanceRail({ eventLog, circleIdentityFor, myRef, callSkill });
  if (!rail) throw new Error('bindCircleGovernance: circleIdentityFor is required — governance entries are signed with the per-circle key');
  const fan = (channel, circleId, event, opts = undefined) => {
    if (typeof broadcast !== 'function') return;
    try { broadcast(channel, circleId, event, opts); } catch { /* fan is best-effort — never block the local write */ }
  };
  // L3: hash-chain each event to its author's previous head before it lands, so equivocation
  // (two events by one author from the same parent) is detectable across replicas. A STABLE
  // entry id (from the chain hash) lets the local copy + any fanned/received copy collapse.
  const appendGovernanceEvent = async (circleId, event) => {
    // THE RAIL: the event becomes a SIGNED chained statement — kind = the event verb, subject = the
    // proposalId, everything else rides the signed payload. The fan carries the STATEMENT; receivers
    // verify before it lands (circleLogReceiver → the rail's ingest).
    const { event: verb, proposalId, kind: _k, ...payload } = event ?? {};
    const res = await rail.append(circleId, { kind: verb, subject: proposalId, payload });
    if (!res) return null;   // no per-circle signer resolvable for THIS circle — nothing lands unsigned
    fan('governance', circleId, res.statement);
    return res.entry;
  };
  const getMembers = (circleId) => readCircleMembers({ callSkill, circleId, myRef, getPolicy });

  const governance = makeCircleGovernance({
    callSkill, appendGovernanceEvent, getPolicy, getMembers,
    localActorRef: myRef, newProposalId: genId, now, setPolicy,
    // The fold's input: VERIFIED events + the disputed (equivocator) ref set, from the rail's read.
    readGovernanceState: (circleId) => rail.readVerified(circleId),
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
