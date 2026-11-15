/**
 * THE VOTE FREEZE — who may vote on a proposal: the members of the circle AS IT STOOD when the proposal was made, minus
 * anyone who has left or been removed since. An admin who may admit alone could otherwise invite accounts of their own
 * after proposing and outvote the circle (the tally counted the roster as folded now). Decided 2026-11-14 (Frits).
 *
 * The proposal names, signed, the membership it was made under: `membershipHeads`, the frontier of the circle's
 * membership statements on the proposer's device (the statements nothing else on the lane builds on; the lane is a DAG of
 * each author's `parentHash` chain and its cross-author `deps`). Every device then reads the circle as it stood from the
 * statements reachable from those heads, and:
 *   - a member counts when their admission lies within the heads (their `join` is reachable from them), or when they
 *     never had a join statement at all (a founder, or a member from before the signed membership lane);
 *   - a member with a `leave` or an `evict` about them OUTSIDE the heads (made since) does not count: they leave the
 *     base as well as the voters;
 *   - so the base can only SHRINK while a vote runs, never grow: a member admitted after the proposal never counts.
 * A device that does not yet hold every named head cannot say who could vote: the proposal stays PENDING there
 * ('waiting for the circle's member list'), never counted on a partial roster. A proposal made before this change (no
 * heads) is counted on the roster as it is now, as before.
 *
 * Pure: the host hands the circle's verified membership statement bodies (`{hash, kind, subject, author, parentHash,
 * deps}`) and the roster as it is now.
 */

/** The frontier of the membership lane: the hashes no other statement names as its parent or a dep (sorted). */
export function membershipFrontier(bodies) {
  const all = new Set(); const named = new Set();
  for (const b of Array.isArray(bodies) ? bodies : []) {
    if (!b || typeof b.hash !== 'string') continue;
    all.add(b.hash);
    if (typeof b.parentHash === 'string' && b.parentHash) named.add(b.parentHash);
    for (const d of Array.isArray(b.deps) ? b.deps : []) if (typeof d === 'string') named.add(d);
  }
  return [...all].filter((h) => !named.has(h)).sort();
}

/** The tip of `ref`'s own chain on the lane: their statement no later statement of theirs names as its parent (or null). */
export function authorTip(bodies, ref) {
  if (typeof ref !== 'string' || !ref) return null;
  const mine = (Array.isArray(bodies) ? bodies : []).filter((b) => b && b.author === ref && typeof b.hash === 'string');
  const parents = new Set(mine.map((b) => b.parentHash).filter(Boolean));
  const tips = mine.filter((b) => !parents.has(b.hash)).map((b) => b.hash).sort();
  return tips[0] ?? null;
}

/**
 * The circle as it stood at `heads`: who was admitted within them, who ever joined, and who has exited since.
 * @returns {{missing: string[]}|{admitted: Set<string>, joinedEver: Set<string>, exitedSince: Set<string>}}
 */
export function admissionWithin(bodies, heads) {
  const byHash = new Map();
  for (const b of Array.isArray(bodies) ? bodies : []) if (b && typeof b.hash === 'string') byHash.set(b.hash, b);
  const named = Array.isArray(heads) ? heads.filter((h) => typeof h === 'string' && h) : [];
  const missing = named.filter((h) => !byHash.has(h));
  if (missing.length) return { missing };
  // everything reachable from the heads, over each statement's parent and deps
  const within = new Set();
  const stack = [...named];
  while (stack.length) {
    const h = stack.pop();
    if (within.has(h)) continue;
    const b = byHash.get(h);
    if (!b) continue;   // an ancestor this device does not hold: what it holds still decides (the heads themselves are held)
    within.add(h);
    if (typeof b.parentHash === 'string' && b.parentHash) stack.push(b.parentHash);
    for (const d of Array.isArray(b.deps) ? b.deps : []) if (typeof d === 'string') stack.push(d);
  }
  const admitted = new Set(); const joinedEver = new Set(); const exitedSince = new Set();
  for (const b of byHash.values()) {
    const who = typeof b.subject === 'string' ? b.subject : null;
    if (!who) continue;
    if (b.kind === 'join') { joinedEver.add(who); if (within.has(b.hash)) admitted.add(who); }
    if ((b.kind === 'leave' || b.kind === 'evict') && !within.has(b.hash)) exitedSince.add(who);
  }
  return { admitted, joinedEver, exitedSince, within };
}

/**
 * THE ROSTER OF A PROPOSAL — the one function the tally, the drawn sample and the receiver gate use.
 * @param {{membershipHeads?: string[]}} proposal
 * @param {{members: Array<{ref: string, role?: string}>, admissionFor?: (heads: string[]) => object}} a
 * @returns {{members: Array<{ref: string, role?: string}>, frozen: boolean, waiting?: boolean, behindProposer?: boolean}}
 */
export function proposalRoster(proposal, { members = [], admissionFor = null } = {}) {
  const now = Array.isArray(members) ? members.filter((m) => m && typeof m.ref === 'string') : [];
  const heads = Array.isArray(proposal?.membershipHeads) ? proposal.membershipHeads : null;
  if (!heads || !heads.length || typeof admissionFor !== 'function') return { members: now, frozen: false };
  const a = admissionFor(heads);
  if (!a || a.missing) return { members: [], frozen: true, waiting: true };
  // the heads must reach what the proposer had itself signed on the membership lane (`membershipUpTo`): a proposal that
  // leaves out the proposer's own admissions counts for nothing (no voters, so it can never pass)
  const upTo = typeof proposal?.membershipUpTo === 'string' && proposal.membershipUpTo ? proposal.membershipUpTo : null;
  if (upTo && a.within instanceof Set && !a.within.has(upTo)) return { members: [], frozen: true, behindProposer: true };
  const counts = (ref) => (a.admitted.has(ref) || !a.joinedEver.has(ref)) && !a.exitedSince.has(ref);
  return { members: now.filter((m) => counts(m.ref)), frozen: true };
}
