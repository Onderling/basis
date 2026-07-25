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
import { GOVERNANCE_KIND } from './governanceLog.js';
import { chainEvent, authorHead } from './governanceChain.js';

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
 */
export function bindCircleGovernance({ eventLog, callSkill, getPolicy, myRef, genId, now = () => Date.now() }) {
  const readGovernanceEvents = async (circleId) => eventLog
    .query({})
    .filter((e) => e && e.type === GOVERNANCE_KIND && e.circleId === circleId && e.payload)
    .map((e) => e.payload);
  // L3: hash-chain each event to its author's previous head before it lands, so equivocation
  // (two events by one author from the same parent) is detectable across replicas.
  const appendGovernanceEvent = async (circleId, event) => {
    const author = authorOf(event);
    let payload = event;
    if (author) {
      const existing = await readGovernanceEvents(circleId);
      payload = chainEvent(event, { author, parentHash: authorHead(existing, author) });
    }
    return eventLog.appendSilentEntry({ circleId, kind: GOVERNANCE_KIND, payload });
  };
  const getMembers = (circleId) => readCircleMembers({ callSkill, circleId, myRef, getPolicy });

  return makeCircleGovernance({
    callSkill, readGovernanceEvents, appendGovernanceEvent, getPolicy, getMembers,
    localActorRef: myRef, newProposalId: genId, now,
  });
}
