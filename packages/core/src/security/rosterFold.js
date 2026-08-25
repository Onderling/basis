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
import { hashHex } from '../hashHex.js';

/**
 * THE caretaker succession order — one implementation, exported so nothing computes a second one.
 *
 * A deterministic shuffle of the candidates seeded by the departing admin's final event hash:
 * `hashHex(seed|candidate)` ascending, ties broken on the candidate itself. Every replica computes
 * the same order from the same log, which is the whole point — a locally-rolled pick would diverge
 * and the FIX would itself be a fork (docs/decisions.md 2026-07-25).
 *
 * KEYED ON THE MEMBER REF, not the per-circle address the decision names. The fold speaks refs and
 * holds no address map; in basis the ref IS the derived signing key, so they coincide, and where
 * they do not the ref is the identifier every replica provably shares — agreeing-without-forking is
 * the property the decision cares about. Grinding an identifier to win buys nothing either way: the
 * seed is a departure hash nobody can know before joining.
 *
 * @param {string[]} candidates
 * @param {string} seed  the departing admin's final event hash
 * @returns {string[]} the candidates, in succession order
 */
export function caretakerOrder(candidates, seed) {
  return (Array.isArray(candidates) ? candidates : [])
    .filter((c) => typeof c === 'string' && c)
    .map((ref) => ({ ref, key: hashHex(`${String(seed)}|${ref}`) }))
    .sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : (x.ref < y.ref ? -1 : 1)))
    .map(({ ref }) => ref);
}

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
 * @returns {{ members: string[], admins: string[], rulesAccepted: Record<string,string>,
 *   adminProvenance: Record<string,string>, caretakerAcknowledged: Record<string,string> }}
 *   sorted members/admins for a stable, comparable result, plus each member's latest accepted
 *   rules version (from the join's payload, superseded by later `rules-accept` statements — the
 *   per-member "accepted v1, current v2" visibility rides this map), plus HOW each admin holds it:
 *   `'founder'` · `'role'` · `` `caretaker:<hash>` `` (see the note where `adminVia` is built), plus
 *   which caretakers have SIGNED for their own appointment (`caretakerAcknowledged`: ref → seed hash).
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

  // ── HOW EACH ADMIN CAME TO BE ONE ──────────────────────────────────────────────────────────────
  // Three ways in, and until now all three rendered as the same word. `role: 'admin'` on a roster row
  // could mean the person made the circle, that someone promoted them, or that the log appointed them
  // because the last admin walked out and nobody was asked. The third is the one a person most needs
  // told, and it was the one nothing could distinguish.
  //
  //   'founder'              they made the circle (or were seeded as admin at cutover)
  //   'role'                 an admin promoted them — a decision someone took
  //   `caretaker:<hash>`     the fold appointed them when a departure emptied the admin set; the hash
  //                          is the statement that emptied it, so the same appointment has the same
  //                          name on every device, and a NEW departure yields a NEW name (which is
  //                          what lets a notice fire once per transition rather than once per fold).
  //
  // Derived, not stored: it is a projection of the same statements, so it cannot disagree with the
  // roster it describes.
  const adminVia = new Map();
  for (const f of founderSet) adminVia.set(f, 'founder');
  for (const a of asKeys(seed?.admins)) if (!adminVia.has(a)) adminVia.set(a, 'founder');

  // ── AND WHO HAS ACKNOWLEDGED BEING ONE ─────────────────────────────────────────────────────────
  // A caretaker appointment is the one authority change nobody performs: it is derived, so that every
  // replica reaches it alone and offline. That makes it correct, and it also made it SILENT — there
  // was no entry anywhere saying it happened, and no way to tell whether the person it happened to
  // had noticed.
  //
  // So the appointee signs for it. A self-authored `role` statement with `payload
  // { role: 'admin', caretakerFor: <the hash that emptied the admin set> }` is admissible ONLY when
  // the fold has independently derived that same appointment with that same seed. It grants nothing —
  // by the time it can be admitted the signer is already an admin — which is exactly the point: the
  // derivation stays authoritative and the log gains the event, rather than the log becoming a second
  // authority that could disagree with it.
  //
  // What it buys, beyond the record: the other members can see that the caretaker KNOWS. "The log says
  // you are running this circle" and "you know you are running this circle" are different facts, and
  // only the second one is any use to the people relying on it.
  const caretakerAcknowledged = Object.create(null);   // ref → the seed hash they signed for

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

    const viaBefore = new Map(adminVia);
    const promoted = new Set(), demoted = new Set();
    const demotedBy = new Map();   // subject → the hash of the statement that demoted them (a seed, like a departure)
    for (const s of batch) {
      if (s.kind !== 'role' || !canAct(s.author)) continue;
      const p = s.payload && typeof s.payload === 'object' ? s.payload : {};
      // An acknowledgement is not a promotion. Once a caretaker is admin, `canAct` passes for their own
      // self-signed statement, and folding it as an ordinary promote would re-title them as `'role'` —
      // erasing the very provenance the statement exists to record.
      if (s.author === s.subject && typeof p.caretakerFor === 'string' && p.caretakerFor) continue;
      const role = p.role;
      if (role === 'admin') promoted.add(s.subject);
      // A FOUNDER IS DEMOTABLE (Frits, 2026-08-23) — once the circle has another admin, which the
      // last-admin rule below supplies without a second condition here. The organiser who moves away
      // hands the street over and stops running it; permanence was never the point, continuity was.
      //
      // They stay a MEMBER, though: `evict` below still exempts them. You cannot be put out of the
      // circle you made — only relieved of running it.
      else if (role === 'member') { demoted.add(s.subject); demotedBy.set(s.subject, s.hash); }
    }
    for (const x of demoted) promoted.delete(x);                    // deny-wins: demote beats concurrent promote

    // A CIRCLE WITH MEMBERS ALWAYS HAS AN ADMIN — the one rule, and now it has one mechanism.
    //
    // This is not the deny-wins axis (that one asks "did someone lose a right"); it is the
    // governance-liveness one: a circle nobody can administer cannot admit, evict, or change its own
    // rules ever again, and there is no act left that could repair it.
    //
    // A demotion that would empty the admin set used to be REFUSED, while a departure that emptied it
    // appointed a caretaker. Two answers to one question, and the refusal was the worse of them: it
    // told an organiser stepping back that their own act had simply not happened, silently, on a path
    // where the very next thing they would do is stop paying attention. Both cases HAND OVER now —
    // the caretaker block at the end of this depth does it, seeded by whichever statement emptied the
    // set (a departure's hash or a demotion's), so the two paths cannot drift apart.
    //
    // The demotion only fails to stand when there is nobody to hand to (every remaining member was
    // demoted at this same depth), and that case is restored there rather than pre-empted here.
    const canEvict = (author) => canAct(author) && !demoted.has(author);  // a concurrent demotion voids authority

    const removed = new Set();
    const removedBy = new Map();   // subject → the hash of the statement that removed them (the seed)
    for (const s of batch) {
      if (s.kind === 'leave' && s.author === s.subject) { removed.add(s.subject); removedBy.set(s.subject, s.hash); }
      else if (s.kind === 'evict' && canEvict(s.author) && !founderSet.has(s.subject)) { removed.add(s.subject); removedBy.set(s.subject, s.hash); }
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
    for (const x of removed)  { members.delete(x); admins.delete(x); adminVia.delete(x); delete rulesAccepted[x]; }
    for (const x of joined)   if (!removed.has(x)) members.add(x);
    for (const x of promoted) if (!removed.has(x)) { members.add(x); admins.add(x); adminVia.set(x, 'role'); }
    for (const x of demoted)  { admins.delete(x); adminVia.delete(x); }

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

    // ── THE LAST-ADMIN CARETAKER ────────────────────────────────────────────────────────────────
    // If this depth left the circle with members but no admin, appoint one HERE — before the next
    // depth folds, so a later statement finds an authority to check against.
    //
    // Why the fold and not an op: the appointment must be AGREED without coordination, and the only
    // thing every replica provably shares is the log. Decided 2026-07-25 (docs/decisions.md,
    // "Last-admin"): a deterministic caretaker rather than a fresh vote, because a vote needs quorum
    // and leaves an adminless gap — and rather than a local random pick, because independent dice
    // diverge and the FIX would itself be a fork. `hashHex` lives in the kernel for exactly this
    // (its own header says so).
    //
    // This is why `leave` is deliberately unconditional above: you may always walk out. The circle
    // is not left unadministrable, because the walking-out appoints a successor. Without this half
    // wired, a founder leaving stranded the circle permanently — every appointing act is admin-gated
    // and admin is only ever granted at creation.
    //
    // SEEDED BY THE DEPARTURE, ordered `hashHex(seed|candidate)` ascending. Two deliberate notes:
    //   · The decision names the member's PER-CIRCLE ADDRESS as the hash input; the fold speaks REFS
    //     and has no address map. In basis the ref IS the derived signing key, so they coincide;
    //     where they do not, the ref is the identifier every replica provably shares, and
    //     agreeing-without-forking is the property the decision cares most about.
    //   · Skipping UNREACHABLE candidates (next-in-line) needs a live fact the log does not carry,
    //     so it is not done here. `appointCaretaker` in the app layer takes `unreachable` for that;
    //     this is the floor — a circle always has an admin — not the whole refinement.
    if (members.size > 0 && admins.size === 0) {
      // Seeded by whatever emptied the set: a departure (leave/evict) or a demotion. Sorted so that
      // several at the same depth pick the same one on every device.
      const seeds = [
        ...[...removed].map((r) => removedBy.get(r)),
        ...[...demoted].map((d) => demotedBy.get(d)),
      ].filter((h) => typeof h === 'string' && h).sort();
      const seed2 = seeds[seeds.length - 1];
      // Never the person just demoted. Appointing them back would undo the demotion while reporting
      // that it worked — the one outcome worse than refusing it.
      const candidates = [...members].filter((m) => !demoted.has(m));
      const [caretaker] = (seed2 && candidates.length) ? caretakerOrder(candidates, seed2) : [];
      if (caretaker) {
        admins.add(caretaker);
        adminVia.set(caretaker, `caretaker:${seed2}`);
      } else if (demoted.size > 0) {
        // Nobody to hand to — every remaining member was demoted at this depth. The demotion cannot
        // stand: a circle whose only members have all stepped down has no act left that could repair
        // it, and no authority exists that could appoint one later.
        for (const x of demoted) { admins.add(x); adminVia.set(x, viaBefore.get(x) ?? 'role'); }
      }
    }

    // ── THE CARETAKER'S OWN SIGNATURE ON IT ─────────────────────────────────────────────────────
    // Admitted only where it MATCHES the derivation (see the note where `caretakerAcknowledged` is
    // built). A statement naming a seed the fold did not derive — a stale one, a guessed one, a
    // hostile one — records nothing; it stays on the log as evidence and moves no authority.
    for (const s of batch) {
      if (s.kind !== 'role' || s.author !== s.subject) continue;
      const p = s.payload && typeof s.payload === 'object' ? s.payload : {};
      if (p.role !== 'admin' || typeof p.caretakerFor !== 'string' || !p.caretakerFor) continue;
      if (adminVia.get(s.subject) === `caretaker:${p.caretakerFor}`) caretakerAcknowledged[s.subject] = p.caretakerFor;
    }
    // Someone who is no longer an admin has nothing to have acknowledged.
    for (const x of [...removed, ...demoted]) delete caretakerAcknowledged[x];
  }

  const adminProvenance = Object.create(null);
  for (const a of [...admins].sort()) adminProvenance[a] = adminVia.get(a) ?? 'role';
  return { members: [...members].sort(), admins: [...admins].sort(), rulesAccepted, adminProvenance, caretakerAcknowledged };
}

export default foldRoster;
