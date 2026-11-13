/**
 * THE RECEIVER GATE OF THE GOVERNED WRITES: a device applies a carried change only when the circle's rule for that
 * action allowed it. The doors (governanceDoors.js) make an honest app ask; this is what binds a device that skips
 * them, because every member's device judges for itself (the enforceability test: another app version gets nothing
 * from skipping the door).
 *
 * The rule, per write:
 *   - where the action's class lets one admin decide (`any-admin`, or `admin-quorum` with a single admin, who IS the
 *     quorum), an admin's write stands on its own (the author's admin role is checked by the lane, as before);
 *   - otherwise the write must NAME the proposal that decided it (`payload.proposalId`), and that proposal, tallied on
 *     THIS device from the verified governance events under the rule that applied, must be of the same action,
 *     APPROVED, and about the same change (the enacted value matches the proposal's subject).
 * A write that fails is not applied and not dropped: it stays on the lane, and the governance view shows it as a
 * change made without the vote (Frits 2026-11-10: kept and shown, never applied).
 *
 * WHICH RULE APPLIED (Opus's review of the first gate: judging every change by the policy in force NOW rolled a
 * legitimate tightening back). A change is judged by the rule in force BEFORE it:
 *   - settings changes fold in version order, each judged by the policy the previous KEPT change produced (the
 *     founding policy for the first), `judgePolicyChain`;
 *   - a rules change carries the settings version its author held (`payload.policyVersion`) and is judged by that
 *     version's rule; an author's stamps never go back (not below their own earlier stamps, nor below a settings
 *     version they wrote), so nobody signs under an old loose rule forever; a change with no stamp is judged by the
 *     strictest rule there is, the one in force now.
 * The founding write (version 1, by a founder of the circle) is not a change and is never judged; a version 1 by
 * anyone else is judged like any change.
 *
 * NO DEVICE CLOCK: an open proposal is judged by its votes alone, a closed one at its resolve's own signed time (the
 * override's deadline test), so devices either side of a deadline judge the same. The residual: an admin can sign an
 * override with a false time; the resolve is signed and visible to every member, so the lie is attributable.
 *
 * Pure: bodies, the policy chain, members and the folded proposals in; verdicts out.
 */
import { changeNeedsVote, normalizeCirclePolicy } from './circlePolicy.js';
import { DECISION_STATUS, resolveGovernance } from './governanceDecision.js';
import { foldGovernance } from './governanceLog.js';

/** Does a write of `action` need a decided proposal? THE one rule the doors ask too (`changeNeedsVote`, circlePolicy.js). */
export const writeNeedsVote = (policy, action, members = []) => changeNeedsVote(policy, action, Array.isArray(members) ? members : []);

/** Canonical JSON (sorted keys), so two equal objects compare equal whatever their key order. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** Every key the patch sets is set to the same value in `whole` (a policy patch against the stated whole policy). */
function patchHolds(patch, whole) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return canonical(patch) === canonical(whole);
  if (!whole || typeof whole !== 'object') return false;
  return Object.keys(patch).every((k) => patchHolds(patch[k], whole[k]));
}

/** The enacted value of a carried write, per action: what the proposal's subject must match. */
const ENACTED = Object.freeze({
  changeRule:   { value: (payload) => payload?.rules,  matches: (subject, value) => canonical(subject) === canonical(value) },
  changePolicy: { value: (payload) => payload?.policy, matches: (subject, value) => patchHolds(subject, value) },
});

const versionOf = (b) => Number.parseInt(b?.payload?.version, 10) || 0;

/** The founding write: version 1, written by a founder of the circle (the roster's `via: 'founder'`). */
export function isFoundingWrite(body, members = []) {
  if (versionOf(body) !== 1) return false;
  return (Array.isArray(members) ? members : []).some((m) => m?.ref === body?.author && m?.via === 'founder');
}

/**
 * Was this carried write made without the vote its circle's rule requires, judged by `policy` (the rule in force
 * before it)? The proposal is TALLIED HERE under that rule (never a recorded "resolve" alone: a lone admin can write
 * one); the one recorded approval that counts without the votes is the admin's past-deadline override, where this
 * tally says it was open.
 * @param {object} a
 * @param {'changeRule'|'changePolicy'} a.action
 * @param {{payload: object}} a.body              the verified statement body (`payload.proposalId`)
 * @param {object} a.policy                       the rule in force before this change
 * @param {Array<{ref: string, role: string}>} a.members
 * @param {Array<object>} a.proposals             this device's governance fold (`foldGovernance(...).proposals`)
 * @param {number} [a.now]
 * @returns {boolean}
 */
export function writeSkippedTheVote({ action, body, policy, members = [], proposals = [], now = Date.now(), need = null } = {}) {
  const payload = body?.payload ?? {};
  if (!writeNeedsVote(policy, action, members)) return false;
  const shape = ENACTED[action];
  if (!shape) return true;
  const id = typeof payload.proposalId === 'string' ? payload.proposalId : null;
  if (!id) return true;
  // `proposals: null` = not read yet (the read re-verifies the lane): say the judgement needs them
  if (proposals == null) { if (need) need.proposals = true; return true; }
  const p = (Array.isArray(proposals) ? proposals : []).find((x) => x?.proposalId === id);
  if (!p || p.action !== action) return true;
  // NO DEVICE CLOCK (Opus): an open proposal is judged by its votes alone; a closed one at its resolve's own signed
  // time (the override's deadline test), so every device judges the same statement the same way
  const d = resolveGovernance({
    action, policy, members, votes: p.votes ?? [], deadline: p.deadline ?? null, now: p.closed ? (p.closedAt ?? 0) : 0,
    seed: p.seed ?? p.proposalId, subject: p.subject, by: p.by,
  });
  const approved = d.status === DECISION_STATUS.APPROVED
    || (p.closed === true && p.status === DECISION_STATUS.APPROVED && d.overrideAvailable === true);
  if (!approved) return true;
  return !shape.matches(p.subject, shape.value(payload));
}

/**
 * THE SETTINGS CHAIN: the admins' settings changes in version order, each judged by the policy the previous KEPT one
 * produced (the founding policy for the first). A change that needed a vote and had none is skipped and the chain goes
 * on from the policy before it; so a legitimate tightening is never judged by its own stricter rule.
 * @param {object} a
 * @param {object[]} a.bodies          the admins' verified `policy-update` bodies
 * @param {Array<{ref: string, role: string, via?: string}>} a.members
 * @param {Array<object>} a.proposals
 * @param {(policies: object[]) => object} a.merge   the lane's merge of same-version statements (deny-wins)
 * @param {object} [a.basePolicy]      the policy before any statement (the defaults)
 * @returns {{kept: object[], skipped: object[], policyAt: (version: number) => object, head: number}}
 */
export function judgePolicyChain({ bodies = [], members = [], proposals = [], merge = (ps) => ps[0], basePolicy = normalizeCirclePolicy({}), now = Date.now(), need = null } = {}) {
  const byVersion = new Map();
  for (const b of bodies) { const v = versionOf(b); if (v >= 1) byVersion.set(v, [...(byVersion.get(v) ?? []), b]); }
  const kept = []; const skipped = [];
  const after = [[0, basePolicy]];   // [version, the policy in force from that version on]
  let current = basePolicy;
  for (const v of [...byVersion.keys()].sort((a, b) => a - b)) {
    const keptHere = [];
    const atV = byVersion.get(v).sort((x, y) => (x.hash < y.hash ? 1 : x.hash > y.hash ? -1 : 0));
    // the founding write comes before everything: another admin's version 1 is judged by the FOUNDING policy, never by
    // the defaults it would otherwise share a version with
    const founding = atV.filter((b) => isFoundingWrite(b, members));
    if (founding.length) { keptHere.push(...founding); current = normalizeCirclePolicy(merge(founding.map((b) => b.payload.policy))); }
    for (const b of atV.filter((x) => !founding.includes(x))) {
      const ok = !writeSkippedTheVote({ action: 'changePolicy', body: b, policy: current, members, proposals, now, need });
      (ok ? keptHere : skipped).push(b);
    }
    if (keptHere.length) {
      kept.push(...keptHere);
      current = normalizeCirclePolicy(merge(keptHere.map((b) => b.payload.policy)));
      after.push([v, current]);
    }
  }
  const policyAt = (version) => {
    let p = basePolicy;
    for (const [v, pol] of after) if (v <= version) p = pol;
    return p;
  };
  // `seen`: the highest settings version on the lane, kept or refused: a stamp up to it is judged (by the last kept
  // policy at or below it); only a stamp beyond it waits for a statement this device has not got yet
  const seen = Math.max(0, ...bodies.map(versionOf));
  return { kept, skipped, policyAt, head: after[after.length - 1][0], seen };
}

/**
 * THE RULES CHANGES, each judged by the settings version its author held (`payload.policyVersion`): never below the
 * author's own earlier stamps (by rules version) nor below a settings version they wrote; a stamp the chain does not
 * know yet waits (judged again when it lands); no stamp → the strictest rule there is (in force now).
 * @param {object} a
 * @param {object[]} a.bodies                the admins' verified `rules-update` bodies
 * @param {{policyAt: Function, head: number, kept: object[]}} a.chain   `judgePolicyChain`'s answer
 * @param {object} a.currentPolicy
 * @param {Array<{ref: string, role: string}>} a.members
 * @param {Array<object>} a.proposals
 * @returns {{kept: object[], skipped: object[], waiting: object[]}}
 */
export function judgeRulesWrites({ bodies = [], chain, currentPolicy = {}, members = [], proposals = [], now = Date.now(), need = null } = {}) {
  const kept = []; const skipped = []; const waiting = [];
  const floor = new Map();   // author → the lowest stamp they may still use
  for (const b of chain?.kept ?? []) floor.set(b.author, Math.max(floor.get(b.author) ?? 0, versionOf(b)));
  for (const b of [...bodies].sort((x, y) => versionOf(x) - versionOf(y) || (x.hash < y.hash ? -1 : 1))) {
    const stamp = Number.parseInt(b?.payload?.policyVersion, 10);
    let policy;
    if (!Number.isFinite(stamp)) policy = currentPolicy;
    else if (stamp > (chain?.seen ?? chain?.head ?? 0)) { waiting.push(b); continue; }
    else if (stamp < (floor.get(b.author) ?? 0)) { skipped.push(b); continue; }
    else policy = chain.policyAt(stamp);
    if (Number.isFinite(stamp)) floor.set(b.author, Math.max(floor.get(b.author) ?? 0, stamp));
    (writeSkippedTheVote({ action: 'changeRule', body: b, policy, members, proposals, now, need }) ? skipped : kept).push(b);
  }
  return { kept, skipped, waiting };
}

/** The governance fold this device holds for a circle (the proposals the gate tallies). */
export async function proposalsOn({ rail, circleId, policy = {}, members = [], now = Date.now() } = {}) {
  let events = []; let disputed = new Set();
  try { ({ events = [], disputed = new Set() } = (await rail?.readVerified?.(circleId)) ?? {}); } catch { events = []; }
  return foldGovernance(events, { policy, members, now, disputed }).proposals;
}

/**
 * Judge twice at most: first without the governance read; only when a change that needs a vote names a proposal is the
 * lane's governance read (it re-verifies every statement), and the judgement made again with it.
 * @param {(proposals: Array<object>|null, need: {proposals?: boolean}) => *} judge
 * @param {() => Promise<Array<object>>} load
 */
export async function judgeWithProposals(judge, load) {
  const need = {};
  const first = judge(null, need);
  if (!need.proposals) return first;
  let proposals = [];
  try { proposals = await load(); } catch { proposals = []; }
  return judge(proposals, {});
}

/**
 * THE CHANGES MADE WITHOUT THE VOTE, as the governance view shows them: every admin's carried rules or settings change
 * this device refused, judged EXACTLY as the applies judge them (the settings chain; a rules change by the settings
 * version it was stamped with), and newer than the newest one of its kind that was kept. Kept on the lane, never
 * applied, and SHOWN (Frits 2026-11-10). A non-admin's change is not listed (the lane drops it before any vote is
 * asked); a rules change whose stamp the chain does not know yet is waiting, not refused.
 * @param {object} a
 * @param {object[]} a.bodies     the rail's verified statement bodies (authors resolved to refs)
 * @param {object} a.policy       the policy in force now (for an unstamped rules change)
 * @param {Array<{ref: string, role: string, via?: string}>} a.members
 * @param {Array<object>} a.proposals
 * @param {(policies: object[]) => object} a.merge   the settings lane's same-version merge (deny-wins)
 * @returns {Array<{action: 'changeRule'|'changePolicy', by: string, version: number, hash: string}>}
 */
export function refusedCarriedChanges({ bodies = [], policy = {}, members = [], proposals = [], merge = (ps) => ps[0], now = Date.now() } = {}) {
  const admins = new Set((Array.isArray(members) ? members : []).filter((m) => m?.role === 'admin').map((m) => m.ref));
  const of = (kind) => (Array.isArray(bodies) ? bodies : []).filter((b) => b?.kind === kind && b.payload && admins.has(b.author));
  const chain = judgePolicyChain({ bodies: of('policy-update'), members, proposals, merge, now });
  const rules = judgeRulesWrites({ bodies: of('rules-update'), chain, currentPolicy: policy, members, proposals, now });
  const out = [];
  for (const [action, kept, skipped] of [['changePolicy', chain.kept, chain.skipped], ['changeRule', rules.kept, rules.skipped]]) {
    const head = Math.max(0, ...kept.map(versionOf));
    for (const b of skipped) if (versionOf(b) > head) out.push({ action, by: b.author, version: versionOf(b), hash: b.hash });
  }
  return out;
}

/**
 * THE MEMBERSHIP LANE'S GATE, as the roster fold asks it (`foldRoster`'s `governedGate`): another person's removal
 * (`evict` → removeMember) or role change (`role` → changeRole, decided by the settings class) takes effect only where
 * the circle's rule allowed it. The same rules as the rules lane: judged by the settings version the statement carries
 * (`payload.policyVersion`, Opus: a removal made under any-admin stays valid after the circle tightens); an author's
 * stamps never go back (not below their own earlier ones in the fold's order, nor below a settings version they
 * wrote); a stamp the chain does not know yet does not take effect yet; no stamp → the rule now. Where a vote was
 * needed, the statement names its proposal, re-tallied here under that rule (`members`: the roster read WITHOUT this
 * gate, the first pass), about the same member (and role).
 *
 * The fold calls it in its own deterministic order, so the per-author floor kept here is the same on every device.
 * @param {object} a
 * @param {{policyAt: Function, head: number, kept: object[]}} a.chain   `judgePolicyChain`'s answer
 * @param {object} a.currentPolicy
 * @param {Array<{ref: string, role: string}>} a.members                the first-pass roster
 * @param {Array<object>} a.proposals
 * @returns {(statement: object, ctx: {admins: Set<string>}) => boolean}
 */
export function membershipGateFor({ chain, currentPolicy = {}, members = [], proposals = [], now = Date.now() } = {}) {
  const floor = new Map();
  for (const b of chain?.kept ?? []) floor.set(b.author, Math.max(floor.get(b.author) ?? 0, versionOf(b)));
  return (s, { admins } = {}) => {
    const action = s?.kind === 'evict' ? 'removeMember' : s?.kind === 'role' ? 'changeRole' : null;
    if (!action) return true;
    const payload = s.payload && typeof s.payload === 'object' ? s.payload : {};
    const stamp = Number.parseInt(payload.policyVersion, 10);
    let policy;
    if (!Number.isFinite(stamp)) policy = currentPolicy;
    else if (stamp > (chain?.seen ?? chain?.head ?? 0)) return false;        // a rule this device has not seen yet
    else if (stamp < (floor.get(s.author) ?? 0)) return false;               // signed under a rule the author had left
    else policy = chain.policyAt(stamp);
    if (Number.isFinite(stamp)) floor.set(s.author, Math.max(floor.get(s.author) ?? 0, stamp));
    const atDepth = [...(admins ?? [])].map((ref) => ({ ref, role: 'admin' }));
    if (!changeNeedsVote(policy, action, atDepth)) return true;
    const id = typeof payload.proposalId === 'string' ? payload.proposalId : null;
    const p = id ? (Array.isArray(proposals) ? proposals : []).find((x) => x?.proposalId === id) : null;
    if (!p || p.action !== action) return false;
    const about = action === 'removeMember'
      ? p.subject === s.subject
      : p.subject?.member === s.subject && p.subject?.role === payload.role;
    if (!about) return false;
    const d = resolveGovernance({ action, policy, members, votes: p.votes ?? [], deadline: p.deadline ?? null, now: p.closed ? (p.closedAt ?? 0) : 0, seed: p.seed ?? p.proposalId, subject: p.subject, by: p.by });
    return d.status === DECISION_STATUS.APPROVED
      || (p.closed === true && p.status === DECISION_STATUS.APPROVED && d.overrideAvailable === true);
  };
}
