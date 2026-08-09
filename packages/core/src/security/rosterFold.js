/**
 * rosterFold — fold a circle's SPINE membership statements into the roster HEAD (who is a member, who is admin).
 *
 * This is the membership head over the spine chain (see spineStatement.js): a pure, DETERMINISTIC projection so
 * every peer that holds the same statements computes the SAME roster (principle 10 — what must be agreed is
 * folded identically everywhere), and a partition simply diverges then re-converges as statements propagate
 * (principle 2 — an append-only peer log; "verwijderen kun je vragen, niet afdwingen": eviction is a folded
 * request, not instant global enforcement). No wall-clock — a deterministic causal order + authority-at-fold-
 * point + deny-wins is enough for safe + convergent membership. See PLAN-membership-on-the-log.md §8.
 *
 * The order is the deps-DAG causal order (DESIGN-log-ordering-unification §2–4). Each statement's causal DEPTH
 * is its longest path over the multi-parent DAG — its author's own `parentHash` chain UNION its `deps` (the
 * cross-author frontier the author had SEEN). That depth IS the Lamport scalar derived from the DAG (max over
 * all parents + 1); folding by (depth, author, hash) linearises the log the SAME way on every peer, and the DAG
 * says which adjacent acts were genuinely CONCURRENT (same depth) so deny-wins fires only there. Because a
 * cross-author edge raises depth, a promoted non-founder's later evict folds AFTER its own promotion (so it has
 * authority), and a past eviction folded before a later demotion of its evictor stays applied (deny-wins falls
 * out of the order — no separate "was it before?" test). An equivocating author (two statements off one
 * `parentHash` — including same content but a different frontier, since deps is bound in the hash) is DISCOUNTED
 * wholesale.
 *
 * Statements in are the VERIFIED spine bodies (verifySpine passed): `{ kind, circleId, subject, author,
 * parentHash, hash, payload? }`, kind ∈ 'join' · 'leave' · 'evict' · 'role' (payload `{ role:'admin'|'member' }`).
 */

import { parentsOf } from './authorChain.js';

/** Kinds this fold understands; anything else is ignored (a future kind folds where its own head does). */
const MEMBERSHIP_KINDS = new Set(['join', 'leave', 'evict', 'role']);

/** Authors that equivocated (two statements off the same parent with different content) — discount them all. */
function equivocators(stmts) {
  const byParent = new Map();   // `${author}\n${parentHash}` → first hash seen
  const bad = new Set();
  for (const s of stmts) {
    const key = `${s.author}\n${s.parentHash ?? ''}`;
    const prev = byParent.get(key);
    if (prev === undefined) byParent.set(key, s.hash);
    else if (prev !== s.hash) bad.add(s.author);
  }
  return bad;
}

/**
 * Causal depth of each statement over the deps-DAG: its longest path from a root along ALL its parents — the
 * author's own `parentHash` chain UNION its `deps` (the cross-author frontier). This is the Lamport scalar the
 * DAG induces (max over present parents + 1), so a cross-author causal edge raises depth and a genuinely
 * concurrent act keeps an equal depth. A parent NOT present (a gap under partition) is skipped, so the fold
 * stays deterministic on whatever set a peer holds and converges when the gap fills.
 */
function depthOf(stmts) {
  const byHash = new Map(stmts.map((s) => [s.hash, s]));
  const memo = new Map();
  const inProgress = new Set();
  const depth = (s) => {
    if (memo.has(s.hash)) return memo.get(s.hash);
    if (inProgress.has(s.hash)) return 0;   // cycle guard (a forged parent-loop counts as a root)
    inProgress.add(s.hash);
    const parents = parentsOf(s).map((h) => byHash.get(h)).filter(Boolean);
    const d = parents.length ? 1 + Math.max(...parents.map(depth)) : 0;
    inProgress.delete(s.hash);
    memo.set(s.hash, d);
    return d;
  };
  const out = new Map();
  for (const s of stmts) out.set(s.hash, depth(s));
  return out;
}

/**
 * Fold spine membership statements into the roster head.
 *
 * @param {Array<object>} statements  VERIFIED spine bodies (verifySpine passed) for ONE circle.
 * @param {object} [opts]
 * @param {Array<string>} [opts.founders]  circle-scoped author keys that are admin + member by construction
 *                                         (the creators). Founders are not evictable (root of authority).
 * @param {{ members?: string[], admins?: string[] }} [opts.seed]  the roster the spine folds ON TOP OF — the
 *   pre-spine materialised HEAD at cutover (the current trail-derived roster). Seed members/admins are the
 *   starting state; UNLIKE founders they are ordinary members (evictable, demotable). Absent (the default) the
 *   fold starts from the founders alone, exactly as before — so pure-spine callers are unchanged.
 * @returns {{ members: string[], admins: string[] }}  sorted for a stable, comparable result.
 */
export function foldRoster(statements, { founders = [], seed = null } = {}) {
  const stmts = (Array.isArray(statements) ? statements : []).filter(
    (s) => s && typeof s === 'object' && MEMBERSHIP_KINDS.has(s.kind)
      && typeof s.author === 'string' && typeof s.subject === 'string' && typeof s.hash === 'string',
  );

  const disputed = equivocators(stmts);
  const live = stmts.filter((s) => !disputed.has(s.author));

  const depth = depthOf(live);
  // Deterministic total order: causal depth (parents before children), then author, then hash.
  const ordered = [...live].sort((a, b) =>
    (depth.get(a.hash) - depth.get(b.hash)) || (a.author < b.author ? -1 : a.author > b.author ? 1 : 0)
    || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0),
  );

  const founderSet = new Set(founders.filter((f) => typeof f === 'string' && f));
  const asKeys = (xs) => (Array.isArray(xs) ? xs.filter((x) => typeof x === 'string' && x) : []);
  // Seed = the pre-cutover roster the spine deltas fold onto. Founders are always in both sets; seed members
  // start IN but are ordinary (evictable) — a later evict/leave in the spine removes them like any member.
  const members = new Set([...founderSet, ...asKeys(seed?.members)]);
  const admins  = new Set([...founderSet, ...asKeys(seed?.admins)]);

  // Process DEPTH-BATCHED so concurrent (same-depth) conflicts resolve by DENY-WINS, not by the tiebreak: at a
  // depth, a removal (leave/evict) beats a join for the same subject, and a demotion beats a concurrent
  // promotion. Authority for a depth's actions is the admin set BEFORE the depth (minus any concurrent
  // demotion), so a just-promoted key cannot act at the same depth as its own promotion.
  //
  // DYNAMIC role authority is CORRECT because the depth is the deps-DAG causal depth: a promoted non-founder's
  // later act carries the promotion in its `deps`, so it folds at a STRICTLY GREATER depth than the promotion —
  // a separate, later batch where the key is already admin. And a past eviction folded before a later demotion
  // of its evictor (the demotion sees the eviction, so folds deeper) stays applied. Only genuinely CONCURRENT
  // acts (a demotion and an evict at the same depth, neither seeing the other) resolve by deny-wins here.
  const depths = [...new Set(ordered.map((s) => depth.get(s.hash)))].sort((a, b) => a - b);
  for (const d of depths) {
    const batch = ordered.filter((s) => depth.get(s.hash) === d);
    const adminBefore = new Set(admins);
    const memberBefore = new Set(members);
    const canAct = (author) => adminBefore.has(author) && memberBefore.has(author);

    const promoted = new Set(), demoted = new Set();
    for (const s of batch) {
      if (s.kind !== 'role' || !canAct(s.author)) continue;
      const role = s.payload && typeof s.payload === 'object' ? s.payload.role : undefined;
      if (role === 'admin') promoted.add(s.subject);
      else if (role === 'member' && !founderSet.has(s.subject)) demoted.add(s.subject);
    }
    for (const x of demoted) promoted.delete(x);                    // deny-wins: demote beats concurrent promote
    const canEvict = (author) => canAct(author) && !demoted.has(author);  // a concurrent demotion voids authority

    const removed = new Set();
    for (const s of batch) {
      if (s.kind === 'leave' && s.author === s.subject) removed.add(s.subject);
      else if (s.kind === 'evict' && canEvict(s.author) && !founderSet.has(s.subject)) removed.add(s.subject);
    }
    const joined = new Set();
    for (const s of batch) if (s.kind === 'join') joined.add(s.subject);

    // Apply: removals win over same-depth joins/promotes (deny-wins).
    for (const x of removed)  { members.delete(x); admins.delete(x); }
    for (const x of joined)   if (!removed.has(x)) members.add(x);
    for (const x of promoted) if (!removed.has(x)) { members.add(x); admins.add(x); }
    for (const x of demoted)  admins.delete(x);
  }

  return { members: [...members].sort(), admins: [...admins].sort() };
}

export default foldRoster;
