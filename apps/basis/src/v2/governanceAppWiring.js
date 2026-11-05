/**
 * basis v2 — governance app wiring (Phase 4 §5, L4 — shared shell binder).
 *
 * Binds the governance host factory to the concrete circle substrate ONCE (invariant 1),
 * so the web shell (circleApp) and the mobile shell (CircleLauncher) drive governance
 * identically. Governance events ride the one EventLog as silent system entries of kind
 * `governance` (payload = the event); the full membership is assembled from the roster op
 * plus this device's own row (listGroupRoster excludes the caller).
 */
import { selfRefIn } from './selfRef.js';
import { makeCircleGovernance } from './governanceHost.js';
import { GOVERNANCE_KIND, foldGovernance } from './governanceLog.js';
import { makeCircleEntryRail } from './circleEntryRail.js';
import { entryKindRegistryFromManifests } from '@onderling/item-store';
import { governanceManifest, GOVERNANCE_LANE } from './governanceManifest.js';
import { rosterBindingVerifier } from './membershipRail.js';
import { memberLabel } from './mandate.js';
import { SETTINGS_ENUM_AXES } from './circlePolicy.js';

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
  const refIn = selfRefIn(myRef);   // in each circle, the self this device is there
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
    signerFor: async (circleId) => ({ identity: await circleIdentityFor(circleId), ref: refIn(circleId) }),
    entryKind: GOVERNANCE_KIND,
    declaredKinds: GOVERNANCE_RAIL_KINDS,
    // …and a REPORT statement lands only as its rule says (`reportLane.js`): a filed report's `by` is its author, a
    // resolution's author an admin — checked here, at ingest, so a live fan and a catch-up batch are held to it alike
    verifyBinding: withReportAdmission(verifyBinding ?? rosterBindingVerifier(callSkill), callSkill),
  });
}

/**
 * The ONE fan every shell hands `bindCircleGovernance`: a just-appended governance or report statement to the circle,
 * through pinboard's broadcast skills. The statement's hash is the message id, so a re-delivery dedups. `opts.to`
 * narrows the fan — the report channel passes the report's readers (`reportReaders`).
 *
 * @param {(app: string, op: string, args: object) => Promise<*>} callSkill
 */
export function makeGovernanceBroadcast(callSkill) {
  return (channel, circleId, statement, opts) => {
    if (typeof callSkill !== 'function' || !statement?.body?.hash) return;
    const op = channel === 'report' ? 'broadcastCircleReport' : 'broadcastCircleGovernance';
    const to = Array.isArray(opts?.to) ? opts.to : undefined;
    Promise.resolve(callSkill('pinboard', op, { groupId: circleId, event: statement, msgId: `gov:${statement.body.hash}`, ts: Date.now(), ...(to ? { to } : {}) }))
      .catch(() => { /* the fan is best-effort — catch-up reconciles */ });
  };
}

/** The rail's key↔ref binding, then — for a report kind only — its admission rule. */
function withReportAdmission(bind, callSkill) {
  return (q) => {
    if (!isReportStatementKind(q?.kind)) return bind(q);   // every other kind: the binding alone, unchanged
    return Promise.resolve(bind(q)).then((ok) => (ok ? reportStatementAdmissible(q, { callSkill }) : false));
  };
}
import { makeCircleReports } from './reportHost.js';
import { REPORT_FILE_KIND, REPORT_RESOLVE_KIND, isReportStatementKind, reportStatementAdmissible, reportReaders, reportEventOf } from './reportLane.js';
import { REPORT_EVENT } from './reportModel.js';

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
    const r = await callSkill('pinboard', 'listGroupMembers', { groupId: circleId });
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
 * @param {string|((circleId: string) => string|null)} deps.myRef  this device's member ref — or, for a device that is several
 *   selves, its self per circle (the agent's `circleSelf(cid).webid`)
 * @param {()=>string} deps.genId        fresh proposal ids
 * @param {()=>number} [deps.now]
 * @param {(channel:'governance'|'report', circleId:string, event:object, opts?:{to?:string[]})=>void} [deps.broadcast]
 *   fan a just-appended event to the circle's members (the shell wires it to the pinboard
 *   broadcastCircle{Governance,Report} skill). Absent ⇒ local-only (single-device).
 *   `opts.to` NARROWS the recipient set — the report channel passes the circle's admin refs, so a report
 *   never lands on the device of the person it is about.
 */
export function bindCircleGovernance({ eventLog, callSkill, getPolicy, myRef, genId, now = () => Date.now(), broadcast = null, removeReported = null, circleIdentityFor = null, setPolicy = null, spineGate = null }) {
  // Governance rides the RAIL, period: signed, circle-scoped, receiver-verified. The unsigned legacy
  // path was deleted with the cutover (one chained-statement primitive remains — signSpine); a composition
  // without a per-circle signer is a wiring bug, surfaced here rather than as silently-unsigned governance.
  // ONE answer to "who am I in this circle" for every side authority is judged on: the rail's signer, the members read, the
  // enact check, `iAmAdmin` and the report host — a persona's circle is the persona's on all of them, never the general one
  const refIn = selfRefIn(myRef);
  const rail = makeGovernanceRail({ eventLog, circleIdentityFor, myRef: refIn, callSkill });
  if (!rail) throw new Error('bindCircleGovernance: circleIdentityFor is required — governance entries are signed with the per-circle key');
  const fan = (channel, circleId, event, opts = undefined) => {
    if (typeof broadcast !== 'function') return;
    try { broadcast(channel, circleId, event, opts); } catch { /* fan is best-effort — never block the local write */ }
  };
  // L3: hash-chain each event to its author's previous head before it lands, so equivocation
  // (two events by one author from the same parent) is detectable across replicas. A STABLE
  // entry id (from the chain hash) lets the local copy + any fanned/received copy collapse.
  // SPINE STATEMENTS ONLY FROM THE POINT: on a device of the person that is not the point, the act goes to the point (the
  // agent's gate), which signs it on its own head — this device signs nothing on the chained governance lane.
  const viaPoint = (channel, circleId, event) => (spineGate && typeof spineGate.isPoint === 'function' && !spineGate.isPoint(circleId)
    ? spineGate.forward({ lane: 'governance', channel, circleId, event })
    : null);
  const appendGovernanceEvent = async (circleId, event) => {
    const forwarded = await viaPoint('governance', circleId, event);
    if (forwarded) return forwarded;
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
    localActorRef: refIn, newProposalId: genId, now, setPolicy,
    // The fold's input: VERIFIED events + the disputed (equivocator) ref set, from the rail's read.
    readGovernanceState: (circleId) => rail.readVerified(circleId),
  });

  // §8 reporting — SIGNED on this rail (`report-file` · `report-resolve`, `reportLane.js`): who filed a report and who
  // closed it are facts the rail proves. A member-target ban routes through the governance handle above (its
  // removeMember class).
  const readReportEvents = async (circleId) => {
    let bodies = [];
    try { ({ bodies = [] } = await rail.readVerifiedBodies(circleId)); } catch { return []; }
    return bodies.filter((b) => isReportStatementKind(b?.kind)).map(reportEventOf).filter(Boolean);
  };
  // The circle's ADMIN refs — who a report may be shown to. Read from the same membership the governance
  // fold uses, so "admin" means one thing in this file.
  const adminRefsOf = async (circleId) => {
    try { return (await getMembers(circleId)).filter((m) => m.role === 'admin').map((m) => m.ref).filter(Boolean); }
    catch { return []; }
  };
  const iAmAdmin = async (circleId) => (await adminRefsOf(circleId)).includes(refIn(circleId));

  /** Who filed the report this event concerns — a filing names it; a resolution is read through the report it closes. */
  const reporterOf = async (circleId, event) => {
    if (typeof event?.by === 'string' && event.event === REPORT_EVENT.REPORT) return event.by;
    if (typeof event?.reportId !== 'string') return null;
    const original = (await readReportEvents(circleId)).find((e) => e?.event === REPORT_EVENT.REPORT && e.reportId === event.reportId);
    return typeof original?.by === 'string' ? original.by : null;
  };

  // A report goes on the rail as a signed statement and is fanned to its READERS only — the circle's admins and the
  // person who filed it (`reportReaders`, the same rule the catch-up serve applies). Everyone else, the reported
  // person first, never receives it.
  const appendReportEvent = async (circleId, event) => {
    const forwarded = await viaPoint('report', circleId, event);
    if (forwarded) return forwarded;
    const filing = event?.event === REPORT_EVENT.REPORT;
    const res = await rail.append(circleId, filing
      ? { kind: REPORT_FILE_KIND, subject: event.reportId, payload: { targetType: event.targetType, targetRef: event.targetRef ?? null, targetLabel: event.targetLabel ?? null, reason: event.reason ?? '', by: event.by, at: event.at ?? 0 } }
      : { kind: REPORT_RESOLVE_KIND, subject: event.reportId, payload: { outcome: event.outcome ?? null, at: event.at ?? 0 } });
    if (!res) return null;   // no per-circle signer for this circle — nothing lands unsigned
    const to = await reportReaders({ circleId, reporter: await reporterOf(circleId, event) }, { callSkill });
    fan('report', circleId, res.statement, { to });
    return res.entry;
  };
  const reports = makeCircleReports({
    readReportEvents, appendReportEvent, governance, removeReported, newReportId: genId, localActorRef: refIn, now,
    isAdmin: iAmAdmin,
  });

  // `appendGovernanceEvent` / `appendReportEvent`: what the POINT runs for a sibling's forwarded act (the same signing,
  // fan and report readers as an act of its own)
  return { ...governance, reports, rail, appendGovernanceEvent, appendReportEvent };
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

/**
 * What the settings screen says under its fields about the open proposal (the first one): who proposed it, and the
 * admins whose answer it still waits on — as `{key, params}` lines each shell translates. Names by the roster
 * (`listGroupMembers` rows), an unknown ref as itself. Nothing open → no lines.
 * @param {{proposals: Array<{by?: string, votes?: Array<{voter: string}>}>, roster: object[]}} a
 * @returns {Array<{key: string, params: object}>}
 */
export function policyProposalNote({ proposals = [], roster = [] } = {}) {
  const first = proposals[0];
  if (!first) return [];
  const refOf = (m) => m?.webid ?? m?.pubKey ?? m?.ref ?? null;
  const nameOf = (ref) => { const m = roster.find((r) => refOf(r) === ref); return (m && memberLabel({ ...m, webid: refOf(m) })) || ref; };
  const voted = new Set((first.votes ?? []).map((v) => v.voter));
  const waiting = roster.filter((m) => m?.role === 'admin' && !voted.has(refOf(m))).map((m) => nameOf(refOf(m)));
  return [
    ...(first.by ? [{ key: 'circle.settings.proposed_by', params: { who: nameOf(first.by) } }] : []),
    ...(waiting.length ? [{ key: 'circle.settings.pending_waiting', params: { who: waiting.join(', ') } }] : []),
  ];
}

/**
 * What a policy proposal changes, in words: a feature on or off, an axis set to an option (the settings screen's own
 * labels, as locale keys the shell translates in `params`), and the rest counted.
 * @param {object} patch   the proposal's subject (a `policyPatch`)
 * @returns {Array<{key: string, params: object}>}
 */
export function policyChangeLines(patch = {}) {
  const lines = [];
  let other = 0;
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (k === 'features' && v && typeof v === 'object') {
      for (const [f, on] of Object.entries(v)) lines.push({ key: on ? 'circle.settings.change_on' : 'circle.settings.change_off', params: { whatKey: `circle.settings.feat.${f}` } });
    } else if (SETTINGS_ENUM_AXES.includes(k) && typeof v === 'string') {
      lines.push({ key: 'circle.settings.change_set', params: { whatKey: `circle.settings.${k}`, toKey: `circle.settings.opt.${v}` } });
    } else other += 1;
  }
  if (other) lines.push({ key: 'circle.settings.change_other', params: { n: other } });
  return lines;
}

/**
 * The open policy proposal an ADMIN viewer still has to answer — on their own settings screen ("Bea stelt voor: … ·
 * Overnemen / Afwijzen", the same governance vote) — or null (not an admin, nothing open, already answered).
 * @param {{proposals: object[], roster: object[], myRef: string}} a
 * @returns {{proposalId: string, who: string, changes: Array<{key: string, params: object}>}|null}
 */
export function policyProposalForAdmin({ proposals = [], roster = [], myRef = null } = {}) {
  const refOf = (m) => m?.webid ?? m?.pubKey ?? m?.ref ?? null;
  const me = roster.find((m) => refOf(m) === myRef);
  if (!myRef || me?.role !== 'admin') return null;
  const p = proposals.find((x) => !(x.votes ?? []).some((v) => v.voter === myRef));
  if (!p) return null;
  const by = roster.find((m) => refOf(m) === p.by);
  return { proposalId: p.proposalId, who: (by && memberLabel({ ...by, webid: refOf(by) })) || p.by, changes: policyChangeLines(p.subject) };
}

/** The change lines as one sentence in the viewer's words (`t` the shell's translator). */
export function policyChangeText(lines = [], t = (k) => k) {
  return lines.map((l) => t(l.key, {
    ...l.params,
    ...(l.params?.whatKey ? { what: t(l.params.whatKey) } : {}),
    ...(l.params?.toKey ? { to: t(l.params.toKey) } : {}),
  })).join(', ');
}

