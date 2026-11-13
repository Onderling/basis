/**
 * policyUpdateLane — a circle's POLICY travels the governance lane as a signed admin statement, and every member —
 * a joiner and a following device included — catches it up like the roster.
 *
 * The policy (storage posture, pod, features, sharing, the LLM posture, governance classes…) is CIRCLE state, but it
 * lived per device (`cc.circlePolicy.<id>`) and reached other members only through `broadcastCirclePolicy`: fired
 * when an admin SAVED settings, fire-and-forget, never caught up. So a member who joined after the founder created
 * the circle held no policy at all and read every axis at its default — a circle created sealed (p2) was sealed on
 * the founder's device and p0 on everyone else's (found 2026-09-25; Fable's ruling 2026-09-26: a lane, not a
 * bundle — a bundle is a snapshot, a lane is the truth).
 *
 * The same machinery the rules document already rides (`rulesUpdateLane.js`), one kind over:
 *
 *   write:  the shells' policy save (an admin's settings save, the create wizard's first write) calls the host's
 *           emitter, which appends a SIGNED `policy-update` statement (payload = the whole policy + a monotonic
 *           version) on the governance rail and fans it through the circle-governance broadcast.
 *   read:   the statement passes the rail's ingest gate like any governance statement; the APPLY step — kicked
 *           from the same governance onChange sites as the rules (live fan + catch-up) — re-verifies, keeps only
 *           statements whose author is an ADMIN on this device's roster (receiver-enforced authority), folds them
 *           (highest version wins; two admins at the same version: DENY-WINS per axis, the hash deciding the rest)
 *           and writes the device's policy store iff strictly newer than the head it holds.
 *   keep:   the winning ORIGINAL statement is kept beside the policy (the head store), so this device serves it at
 *           catch-up after the lane's audit window has compacted the entry — a member offline for weeks still
 *           converges, verifiably, from any peer.
 *
 * The governance fold ignores this kind (it branches on propose/vote/resolve): a policy-update is a carried fact.
 */
import { judgePolicyChain, judgeWithProposals, proposalsOn } from './governanceReceiverGate.js';

export const POLICY_UPDATE_KIND = 'policy-update';

/**
 * Deny-wins, per axis, for two admins' statements at the SAME version: the more restrictive value wins, whoever
 * said it. Most restrictive first; a value not listed ranks after every listed one. Axes not here take the
 * hash-deciding statement's value — where no value is plainly the protective one, the convergent pick is enough.
 */
const DENY_ORDER = Object.freeze({
  storagePosture:   ['p2', 'p3', 'p1', 'p0'],        // the two CLIENT-sealed postures first (group-key, then recipient-wrap), the enclave's p1, plaintext last
  llmTool:          ['off', 'local', 'user', 'cloud'],
  sharePosture:     ['closed'],
  shareOutOfCircle: ['prohibit', 'notify', 'silent'],
  revealPolicy:     ['pairwise', 'open'],
  agents:           ['no', 'admin-approval', 'yes'],
  privateDm:        [false, true],
});

const rank = (order, v) => { const i = order.indexOf(v); return i < 0 ? order.length : i; };

/**
 * Merge policies stated at the same version into one, deny-wins. `policies` are ordered by statement hash
 * (descending) so the base — and every axis without a deny order — is the same on every device.
 * @param {object[]} policies
 * @returns {object}
 */
export function denyWinsMerge(policies) {
  const [base, ...rest] = policies;
  if (!rest.length) return base;
  const out = { ...base };
  for (const [axis, order] of Object.entries(DENY_ORDER)) {
    const vals = policies.map((p) => p?.[axis]).filter((v) => v !== undefined);
    if (vals.length) out[axis] = vals.reduce((a, b) => (rank(order, b) < rank(order, a) ? b : a));
  }
  // A feature is on only if every statement at this version turned it on.
  const featureKeys = new Set(policies.flatMap((p) => Object.keys(p?.features ?? {})));
  if (featureKeys.size) {
    out.features = {};
    for (const k of featureKeys) out.features[k] = policies.every((p) => p?.features?.[k] !== false);
  }
  return out;
}

/**
 * Fold a lane's verified policy-update bodies into ONE policy — pure, the part both the apply step and its tests read.
 * @param {object[]} bodies   verified statement bodies (`{kind, author, hash, payload}`)
 * @param {{admins: Set<string>}} o  the roster's current admin refs on THIS device
 * @returns {{policy: object, version: number, hash: string, key: string}|null}  `hash` = the deciding statement;
 *   `key` = every statement at the winning version — a late second admin's statement changes the merge, so the head
 *   compares on the set, not on one hash
 */
export function foldPolicyUpdates(bodies, { admins } = {}) {
  const updates = (Array.isArray(bodies) ? bodies : []).filter((b) => b?.kind === POLICY_UPDATE_KIND
    && b.payload && typeof b.payload === 'object'
    && b.payload.policy && typeof b.payload.policy === 'object'
    && Number.isFinite(Number.parseInt(b.payload.version, 10))
    && admins instanceof Set && admins.has(b.author));
  if (!updates.length) return null;
  const top = Math.max(...updates.map((b) => Number.parseInt(b.payload.version, 10)));
  const atTop = updates.filter((b) => Number.parseInt(b.payload.version, 10) === top)
    .sort((a, b) => (a.hash < b.hash ? 1 : a.hash > b.hash ? -1 : 0));
  return {
    policy: denyWinsMerge(atTop.map((b) => b.payload.policy)), version: top, hash: atTop[0].hash,
    key: atTop.map((b) => b.hash).sort().join(','),
  };
}

/**
 * The write half: append + fan one policy-update statement. Built by the host over its governance-lane rail.
 * @param {object} a
 * @param {{append: Function}} a.rail  a governance-lane rail (declared kinds include 'policy-update')
 * @param {(circleId: string, statement: object) => void|Promise<*>} [a.fan]  best-effort fan
 * @returns {(u: {groupId: string, policy: object, version: number}) => Promise<object|null>}
 */
export function makePolicyUpdateEmitter({ rail, fan = null, membershipUpToFor = null } = {}) {
  if (!rail || typeof rail.append !== 'function') {
    throw new Error('makePolicyUpdateEmitter: a governance-lane rail is required');
  }
  return async function emitPolicyUpdate({ groupId, policy, version, proposalId = null } = {}) {
    if (typeof groupId !== 'string' || !groupId) return null;
    const v = Number.parseInt(version, 10);
    if (!Number.isFinite(v) || v < 1) return null;
    if (!policy || typeof policy !== 'object') return null;
    let res = null;
    try {
      // the proposal that decided this change, where the circle's rule asked for one: every receiver checks it
      // `membershipUpTo`: the tip of my own membership chain in this circle — what I signed there BEFORE this change keeps
      // the settings version it carries; whatever I sign after is judged by this one or later (the receivers' line)
      let upTo = null;
      try { upTo = typeof membershipUpToFor === 'function' ? (membershipUpToFor(groupId) ?? null) : null; } catch { upTo = null; }
      res = await rail.append(groupId, { kind: POLICY_UPDATE_KIND, subject: `policy-v${v}`, payload: { policy, version: v, ...(typeof proposalId === 'string' && proposalId ? { proposalId } : {}), ...(typeof upTo === 'string' && upTo ? { membershipUpTo: upTo } : {}) } });
    } catch { res = null; }
    if (!res) return null;
    if (typeof fan === 'function') {
      try { await fan(groupId, res.statement); } catch { /* fan is best-effort — catch-up reconciles */ }
    }
    return res.statement;
  };
}

/**
 * Where a device keeps the head of each circle's policy lane: the version it applied and the ORIGINAL statement.
 * Duck-typed io (`localStorage` on web, AsyncStorage on mobile), like the contact seen-marks.
 */
export const POLICY_HEAD_KEY = (circleId) => `cc.circlePolicyHead.${circleId}`;
export function makePolicyHeadStore(io) {
  return {
    async read(circleId) {
      try {
        const raw = await io.getItem(POLICY_HEAD_KEY(circleId));
        const v = raw ? JSON.parse(raw) : null;
        return v && typeof v === 'object' && Number.isFinite(v.version) ? v : null;
      } catch { return null; }
    },
    async write(circleId, head) {
      try { await io.setItem(POLICY_HEAD_KEY(circleId), JSON.stringify(head)); } catch { /* the next apply retries */ }
    },
  };
}

/**
 * The next version THIS device states for a circle — one past the head it holds (0 when it holds none).
 * @param {{read: Function}} headStore
 */
export async function nextPolicyVersion(headStore, circleId) {
  const head = await headStore?.read?.(circleId);
  return (Number.isFinite(head?.version) ? head.version : 0) + 1;
}

/**
 * The read half: fold the lane's verified policy-update statements into this device's policy store. Idempotent and
 * convergent — safe to call on every governance change signal.
 *
 * @param {object} a
 * @param {{storedStatements: Function, readVerifiedBodies: Function}} a.rail  the receive-side governance rail
 * @param {string} a.circleId
 * @param {(circleId: string) => Promise<Array<{ref: string, role: string}>>} [a.membersOf]  the circle's roster on this
 *   device (what the shells hand: a member-vote tally needs every member, not only the admins)
 * @param {() => Promise<Set<string>>} [a.adminsOf]    the admin refs alone (without `membersOf`)
 * @param {(circleId: string) => Promise<object|null>} [a.readPolicy]  the policy in force here: the receiver gate judges
 *   each change by the circle's settings rule (governanceReceiverGate.js)
 * @param {{read: Function, write: Function}} a.headStore
 * @param {(circleId: string, policy: object) => Promise<*>} a.writePolicy  replaces the device's policy for the circle
 * @returns {Promise<{applied: boolean, version?: number, skipped?: number}>}
 */
export async function applyPolicyUpdates({ rail, circleId, membersOf = null, adminsOf = null, readPolicy = null, headStore, writePolicy } = {}) {
  if (!rail || typeof circleId !== 'string' || !circleId || typeof writePolicy !== 'function' || !headStore) {
    return { applied: false };
  }
  let present = false;
  try { present = rail.storedStatements(circleId).some((s) => s?.body?.kind === POLICY_UPDATE_KIND); } catch { present = false; }
  if (!present) return { applied: false };
  let bodies = [];
  try { bodies = (await rail.readVerifiedBodies(circleId))?.bodies ?? []; } catch { return { applied: false }; }
  let members = [];
  try {
    members = typeof membersOf === 'function'
      ? ((await membersOf(circleId)) ?? [])
      : [...((await adminsOf?.(circleId)) ?? new Set())].map((ref) => ({ ref, role: 'admin' }));
  } catch { members = []; }
  const admins = new Set(members.filter((m) => m?.role === 'admin').map((m) => m.ref));
  // THE RECEIVER GATE: the admins' changes in version order, each judged by the policy the previous kept one produced
  // (never by the policy in force now: that rolled a legitimate tightening back); where that rule asked for a vote, a
  // change counts only with the proposal that decided it, and one that skipped it stays on the lane, never applied.
  let policy = {};
  try { policy = (typeof readPolicy === 'function' ? await readPolicy(circleId) : null) ?? {}; } catch { policy = {}; }
  const changes = bodies.filter((b) => b?.kind === POLICY_UPDATE_KIND && admins.has(b.author));
  const { kept, skipped } = await judgeWithProposals(
    (proposals, need) => judgePolicyChain({ bodies: changes, members, proposals, merge: denyWinsMerge, need }),
    () => proposalsOn({ rail, circleId, policy, members }),
  );
  const won = foldPolicyUpdates(kept, { admins });
  if (!won) return { applied: false, ...(skipped.length ? { skipped: skipped.length } : {}) };
  const head = await headStore.read(circleId);
  if (head && (won.version < head.version || (won.version === head.version && won.key === head.key))) return { applied: false };
  let statement = null;
  try { statement = rail.storedStatements(circleId).find((s) => s?.body?.hash === won.hash) ?? null; } catch { statement = null; }
  try { await writePolicy(circleId, won.policy); } catch { return { applied: false }; }
  await headStore.write(circleId, { version: won.version, key: won.key, ...(statement ? { statement } : {}) });
  return { applied: true, version: won.version };
}

/**
 * The catch-up serve's durable-head hook — the preserved original statement for a circle, as an array the
 * governance catch-up appends to its batch (`extraStatementsFor`), beside the rules one.
 */
export async function preservedPolicyStatementsFor({ headStore, circleId } = {}) {
  const head = await headStore?.read?.(circleId);
  return (head?.statement?.body && typeof head.statement.sig === 'string') ? [head.statement] : [];
}

/**
 * THE ONE COMPOSITION both shells build — so "state the policy", "apply the lane" and "serve the head" are written
 * once, and a shell only injects its stores (invariant 1: a shell composes, it does not decide).
 *
 * @param {object} a
 * @param {() => Function|null} a.emitter      lazy: the agent's `emitPolicyUpdate` (bound after boot)
 * @param {{read: Function, write: Function}} a.headStore
 * @param {(circleId: string) => Promise<object|null>} a.readPolicy
 * @param {(circleId: string, policy: object) => Promise<*>} a.writePolicy
 * @param {(circleId: string) => Promise<Set<string>>} a.adminsOf
 */
export function makeCirclePolicyLane({ emitter, headStore, readPolicy, writePolicy, membersOf = null, adminsOf = null } = {}) {
  // The receive rail this device folds the lane with — handed over by the shell when it builds it, and remembered from
  // every apply, so a SAVE can bring the head up to date before it counts one past it.
  let knownRail = null;
  const apply = (circleId, rail) => {
    if (rail) knownRail = rail;
    return applyPolicyUpdates({ rail: rail ?? knownRail, circleId, membersOf, adminsOf, readPolicy, headStore, writePolicy });
  };
  return {
    /**
     * State this device's current policy for the circle (an admin's save, the founder's first write).
     *
     * The policy is read FIRST — it is what the admin just saved — then the lane is applied, so the head is the
     * lane's and not only this device's: a device that had not caught up (offline, a fresh enrol) used to state
     * head+1 from its OWN head, a version the lane had passed, and its save was ignored on every device while the
     * admin saw "saved" (L144). It states one past the lane's head, makes its own statement the head, and puts the
     * saved policy back locally — applying the lane may have written the older one there, and the save is now newest.
     */
    async state(circleId, { proposalId = null } = {}) {
      const emit = typeof emitter === 'function' ? emitter() : null;
      if (typeof emit !== 'function' || typeof circleId !== 'string' || !circleId) return null;
      const policy = await readPolicy(circleId).catch(() => null);
      if (!policy || typeof policy !== 'object') return null;
      if (knownRail) await apply(circleId, knownRail).catch(() => {});
      const version = await nextPolicyVersion(headStore, circleId);
      let statement = null;
      try {
        statement = await emit({ groupId: circleId, policy, version, ...(proposalId ? { proposalId } : {}) });
        if (statement?.body?.hash) await headStore.write(circleId, { version, key: statement.body.hash, statement });
      } finally {
        // The admin's save stays the local truth whether or not the lane took it: applying the lane above may have
        // written an older policy here, and a failed emit must not leave that older one in the store the screen shows.
        await writePolicy(circleId, policy).catch(() => {});
      }
      return statement;
    },
    apply,
    /** The policy in force on this device: what the rules apply's receiver gate judges an unstamped rules change by. */
    /** The settings version this device holds: a rules change it writes is stamped with it (the receiver gate). */
    headVersion: async (circleId) => (await headStore.read(circleId).catch(() => null))?.version ?? 0,
    readPolicy: (circleId) => readPolicy(circleId),
    /** The shell hands over its receive rail when it builds it. */
    useRail(rail) { if (rail) knownRail = rail; },
    preserved: (circleId) => preservedPolicyStatementsFor({ headStore, circleId }),
  };
}

/**
 * The `membersOf` every shell hands the lane: the circle's roster on THIS device (`{ref, role}`), read through the
 * roster op. One definition for web, mobile and the box. A shell whose `callSkill` binds after boot passes a wrapper
 * that reaches it lazily. An unreadable roster reads as nobody, so the lane applies nothing rather than trusting anyone.
 * @param {(app: string, op: string, args: object) => Promise<*>} callSkill
 * @returns {(circleId: string) => Promise<Array<{ref: string, role: 'admin'|'member'}>>}
 */
export function membersOfViaSkill(callSkill) {
  return async (circleId) => {
    let res = null;
    try { res = typeof callSkill === 'function' ? await callSkill('pinboard', 'listGroupMembers', { groupId: circleId }) : null; }
    catch { res = null; }
    // `via`: how an admin holds the role (`'founder'` · `'role'` · caretaker): the founding write is a founder's
    return (res?.members ?? []).filter((m) => m?.webid).map((m) => ({ ref: m.webid, role: m.role === 'admin' ? 'admin' : 'member', ...(m.adminVia ? { via: m.adminVia } : {}) }));
  };
}

/** The admin refs alone, from the same roster read (`membersOfViaSkill`'s admins). */
export function adminsOfViaSkill(callSkill) {
  return async (circleId) => {
    let res = null;
    try { res = typeof callSkill === 'function' ? await callSkill('pinboard', 'listGroupMembers', { groupId: circleId }) : null; }
    catch { res = null; }
    return new Set((res?.members ?? []).filter((m) => m?.role === 'admin').map((m) => m.webid).filter(Boolean));
  };
}
