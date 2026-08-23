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
const MEMBERSHIP_KINDS = new Set(['join', 'leave', 'evict', 'role', 'rules-accept']);

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
 * @param {Array<string>} [opts.founders]  the circle's creators — admin + member by construction, and
 *   the fold's starting authority. They are **not evictable**: you cannot be put out of a circle you
 *   made. They ARE demotable once another admin exists (Frits, 2026-08-23), so a founder who steps
 *   back hands over rather than holding the circle open forever; the last-admin rule is what supplies
 *   the "once another admin exists" half.
 * @param {{ members?: string[], admins?: string[] }} [opts.seed]  the roster the spine folds ON TOP OF — the
 *   pre-spine materialised HEAD at cutover (the current trail-derived roster). Seed members/admins are the
 *   starting state; UNLIKE founders they are ordinary members (evictable, demotable). Absent (the default) the
 *   fold starts from the founders alone, exactly as before — so pure-spine callers are unchanged.
 * @param {{ versions?: string[]|Set<string> }} [opts.rulesGate]  RULES-GATED JOINS (task #80, sitting-A
 *   decision). When present, a `join` folds ONLY if its signed payload carries a non-empty
 *   `rulesAccepted` string — and, when `versions` is a non-empty set, one that is IN it (the set of
 *   rules-doc versions this circle has ever had; acceptance of a then-current version stays valid
 *   forever). Deny-favouring both ways: no acceptance → the join does not fold, on every device
 *   independently — the statement stays on the log as evidence, the joiner lands on nobody's roster.
 *   Founders and seed members never fold via `join`, so the gate cannot touch them. Absent (the
 *   default), joins fold exactly as before — the projector opts in, the kernel stays pure.
 * @returns {{ members: string[], admins: string[], rulesAccepted: Record<string,string> }}
 *   sorted members/admins for a stable, comparable result, plus each member's latest accepted
 *   rules version (from the join's payload, superseded by later `rules-accept` statements — the
 *   per-member "accepted v1, current v2" visibility rides this map).
 */
export function foldRoster(statements, { founders = [], seed = null, rulesGate = null } = {}) {
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
  const rulesAccepted = Object.create(null);   // subject → latest accepted rules version (fold-ordered)

  // The rules gate (see the option's doc above). `versions` normalised once; empty set = presence-only.
  const gateVersions = rulesGate
    ? new Set([...(rulesGate.versions ?? [])].filter((v) => typeof v === 'string' && v))
    : null;
  const joinPassesGate = (s) => {
    if (!rulesGate) return true;
    const v = s.payload && typeof s.payload === 'object' ? s.payload.rulesAccepted : undefined;
    if (typeof v !== 'string' || !v) return false;               // deny-favouring: no acceptance, no fold
    return gateVersions.size === 0 || gateVersions.has(v);       // wrong/unknown version → refused too
  };

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
      // A FOUNDER IS DEMOTABLE (Frits, 2026-08-23) — once the circle has another admin, which the
      // last-admin rule below supplies without a second condition here. The organiser who moves away
      // hands the street over and stops running it; permanence was never the point, continuity was.
      //
      // They stay a MEMBER, though: `evict` below still exempts them. You cannot be put out of the
      // circle you made — only relieved of running it.
      else if (role === 'member') demoted.add(s.subject);
    }
    for (const x of demoted) promoted.delete(x);                    // deny-wins: demote beats concurrent promote

    // A CIRCLE WITH MEMBERS ALWAYS HAS AN ADMIN. Demotions that would empty the admin set are
    // refused — all of them at this depth, so the outcome does not depend on which arrived first.
    //
    // This is not the deny-wins axis (that one asks "did someone lose a right"); it is the
    // governance-liveness one: a circle nobody can administer cannot admit, evict, or change its own
    // rules ever again, and there is no act left that could repair it. Refusing the last demotion is
    // the only outcome every device computes identically without needing an authority that no longer
    // exists.
    //
    // A last admin who LEAVES is deliberately not covered: `leave` is self-authored and always
    // stands (you may always walk out), which is exactly the case the caretaker appointment exists
    // for. Losing your only admin by accident is a bug; losing them because they left is a fact.
    if (demoted.size > 0) {
      const after = new Set([...admins, ...promoted]);
      for (const x of demoted) after.delete(x);
      if (after.size === 0) demoted.clear();
    }
    const canEvict = (author) => canAct(author) && !demoted.has(author);  // a concurrent demotion voids authority

    const removed = new Set();
    for (const s of batch) {
      if (s.kind === 'leave' && s.author === s.subject) removed.add(s.subject);
      else if (s.kind === 'evict' && canEvict(s.author) && !founderSet.has(s.subject)) removed.add(s.subject);
    }
    const joined = new Set();
    for (const s of batch) {
      if (s.kind !== 'join' || !joinPassesGate(s)) continue;
      joined.add(s.subject);
      // The acceptance rides the join's signed payload — record it with the membership it establishes.
      const v = s.payload && typeof s.payload === 'object' ? s.payload.rulesAccepted : undefined;
      if (typeof v === 'string' && v) rulesAccepted[s.subject] = v;
    }

    // Apply: removals win over same-depth joins/promotes (deny-wins).
    for (const x of removed)  { members.delete(x); admins.delete(x); delete rulesAccepted[x]; }
    for (const x of joined)   if (!removed.has(x)) members.add(x);
    for (const x of promoted) if (!removed.has(x)) { members.add(x); admins.add(x); }
    for (const x of demoted)  admins.delete(x);

    // `rules-accept` — re-acceptance after a rules change (task #80 slice d's statement kind; the fold
    // understands it from day one so catch-up replay is version-independent). SELF-only (author signs
    // for their own ref: the rail's read gate already pins authorRef = actor; here the subject must be
    // the statement's own authorRef so nobody accepts on another's behalf), and only for someone who IS
    // a member after this depth's joins/removals — an outsider's "acceptance" records nothing.
    for (const s of batch) {
      if (s.kind !== 'rules-accept') continue;
      const p = s.payload && typeof s.payload === 'object' ? s.payload : {};
      const v = p.rulesAccepted;
      if (typeof v !== 'string' || !v) continue;
      if (p.authorRef !== s.subject) continue;             // self-only
      if (!members.has(s.subject)) continue;               // members only
      rulesAccepted[s.subject] = v;
    }
  }

  return { members: [...members].sort(), admins: [...admins].sort(), rulesAccepted };
}

export default foldRoster;
