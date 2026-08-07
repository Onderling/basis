/**
 * causalMerge — origin-timestamp + writer-id causal LWW for inbound item ingest (Objective L).
 *
 * THE PROBLEM (v0 was last-received-wins): `CircleItemStore.put` re-stamped `updatedAt` to the local ingest
 * time, so when a peer's item arrived it overwrote the local copy purely because it arrived LATER — even when
 * the local copy was causally NEWER. Arrival order clobbered causal order.
 *
 * THE FIX (this module): decide the winner by the item's ORIGIN clock, not by arrival. Each item already carries
 * `updatedAt` (the origin's write time — an ISO string or epoch number) and `updatedBy` (the writer id). Those
 * two fields ARE a coarse causal coordinate, so no new item field is required: the refinement is that inbound
 * ingest PRESERVES `updatedAt`/`updatedBy` from the payload instead of re-stamping them (see CircleItemStore.put
 * `origin:true`), and this comparator picks the causally-newer side.
 *
 * DESIGN CHOICE — origin-timestamp + writer-id causal LWW, NOT a full per-writer version vector.
 *   • Guarantees: an inbound item that is causally OLDER (earlier origin `updatedAt`) can NOT overwrite a newer
 *     local edit; a causally-NEWER inbound wins; two truly concurrent edits (equal `updatedAt`) resolve by a
 *     DETERMINISTIC tiebreak on writer id — so every peer converges to the SAME survivor regardless of the order
 *     envelopes arrived. That is exactly what stops arrival-order clobbering.
 *   • Limits: this is last-WRITER-wins at ITEM granularity, not a field-level merge — the losing side of a true
 *     concurrent edit is dropped whole (its distinct fields are not merged in). A full version vector (per-writer
 *     counters) would additionally DETECT concurrency vs causal descent and enable a 3-way field merge, but it is
 *     heavier (every writer must maintain + ship a counter map, and ingest must merge vectors). `sync-engine`'s
 *     `objectDiff` does a 3-way field merge but requires a per-item "last common state" (base) history, which the
 *     CircleItemStore substrate does not keep per item (`objectVersions` history is wired for the kring stores,
 *     not items). So reusing it here would mean inventing that base-state store — out of scope for the smallest
 *     correct fix. This LWW is the documented first step; upgrading to a vector is additive on top of it.
 *
 * BACKWARD COMPATIBILITY: a payload with no parseable `updatedAt` can not be causally ordered, so it falls back
 * to today's last-received-wins ('incoming' always applies). Items therefore ingest unchanged when a peer hasn't
 * been upgraded to send origin metadata — the change is additive, never a crash.
 */

/**
 * The causal coordinate of an item: `{ at, by }`.
 *   at — numeric origin clock parsed from `updatedAt` (epoch number as-is, ISO string via Date.parse);
 *        `NaN` when absent/unparseable (⇒ "no comparable clock").
 *   by — writer id (`updatedBy`) used only as the concurrency tiebreak; `''` when absent.
 * @param {object} item
 * @returns {{ at: number, by: string }}
 */
export function causalRank(item) {
  const raw = item == null ? undefined : item.updatedAt;
  let at = NaN;
  if (typeof raw === 'number') at = raw;
  else if (typeof raw === 'string') at = Date.parse(raw);
  const by = (item && typeof item.updatedBy === 'string') ? item.updatedBy : '';
  return { at, by };
}

/**
 * Decide which side to keep when an inbound item meets the local copy.
 *
 * @param {object|null|undefined} local     the currently-stored item (has a stamped `updatedAt`), or null/absent
 * @param {object} incoming                 the inbound PAYLOAD (its `updatedAt` is the origin clock, if present)
 * @returns {'incoming'|'local'}
 *   - no local                          → 'incoming' (first arrival / create)
 *   - incoming has no comparable clock  → 'incoming' (backward-compat last-received-wins)
 *   - local has no comparable clock     → 'incoming' (local predates metadata; accept the clock-bearing update)
 *   - incoming.updatedAt >  local       → 'incoming' (causally newer wins)
 *   - incoming.updatedAt <  local       → 'local'    (causally OLDER inbound must NOT clobber)
 *   - equal updatedAt, higher writer id → 'incoming' (deterministic concurrency tiebreak)
 *   - otherwise (fully equal / lower)   → 'local'    (idempotent: no rewrite, no churn)
 */
export function causalWinner(local, incoming) {
  if (!local) return 'incoming';
  const L = causalRank(local);
  const I = causalRank(incoming);
  const iHas = Number.isFinite(I.at);
  const lHas = Number.isFinite(L.at);
  if (!iHas) return 'incoming';   // incoming un-ordered → last-received-wins fallback
  if (!lHas) return 'incoming';   // local predates origin metadata → accept the update
  if (I.at > L.at) return 'incoming';
  if (I.at < L.at) return 'local';
  // Concurrent (identical origin clock): deterministic tiebreak on writer id so every
  // peer converges to the same survivor irrespective of arrival order. Ties (same writer,
  // idempotent redelivery) keep local — a no-op.
  return I.by > L.by ? 'incoming' : 'local';
}

// ── Immutable-once-set CLAIM reconciliation (the subtask decentralized-tree fix) ─────────────────────────
//
// The whole-item causal LWW above is too blunt for the ONE contended scalar in a subtask tree: the CLAIM.
// Two devices that claim the SAME task while partitioned each write their own claimant; plain item-LWW keeps
// the causally-NEWER write = the LATER claimant — the OPPOSITE of first-come. This resolves the claim cluster
// on its OWN rule, so first-come actually wins and every peer converges identically, independent of the
// content LWW. It is a per-FIELD rule for the claim cluster, NOT a general field merge or an OR-Set: the
// single-writer-per-node property a CONFIRMED claim buys makes a tree CRDT unnecessary (only the claim itself
// is ever contended). Rule (deterministic, order-independent):
//   1. a CONFIRMED claim beats an unconfirmed one (an authority spoke);
//   2. two confirmed claims → earliest `confirmedAt` wins (two authorities acted concurrently), tie by id;
//   3. two pending claims   → earliest `claimedAt` wins (first-come queue), tie by claimant id;
//   4. exactly one side carries a claim → it is preserved, so a concurrent claimLESS content edit on the
//      other side cannot silently drop the claim.
// SCOPE: a concurrent claim-vs-RELEASE is deliberately out of scope here — a release is issuer-driven and
//   rare, and rides the normal content LWW (the lease/expiry path is a separate, later concern).

// The claim cluster the verbs maintain. `claimSeq` is a single monotonic scalar (a Lamport counter on the
// claim, NOT a per-writer vector): every authoritative claim transition (claim/confirm/reassign/revoke) reads
// the current claim and writes `claimSeq+1`, so a transition that HAPPENED-AFTER the claim carries a higher
// sequence and supersedes it — while two CONCURRENT writes from the same base tie on the sequence and fall to
// the first-come rule. That is the precise meaning of "immutable-once-set": once set (seq≥1) only a
// higher-sequence act that read it can change it; a same-sequence race resolves earliest-wins.
const CLAIM_FIELDS = [
  'assignees', 'assignee', 'claimedAt', 'confirmedAssignee', 'confirmedAt', 'confirmedBy', 'confirmedSig',
  'claimSeq', 'claimReleasedAt',
];

/** The claim cluster of an item, or null when it carries no claim NOR any claim transition (non-task → null). */
function claimStateOf(item) {
  if (!item || typeof item !== 'object') return null;
  const assignees = Array.isArray(item.assignees) ? item.assignees
    : (item.assignee != null ? [item.assignee] : []);
  const confirmedAssignee = item.confirmedAssignee ?? null;
  const claimedAt = typeof item.claimedAt === 'number' ? item.claimedAt : null;
  const claimSeq = typeof item.claimSeq === 'number' ? item.claimSeq : null;
  const releasedAt = typeof item.claimReleasedAt === 'number' ? item.claimReleasedAt : null;
  // A claim-state exists when there is a live claim OR an authoritative claim TRANSITION on record — a release
  // still counts (it must be able to beat a stale claim on a peer that never saw the revoke).
  if (assignees.length === 0 && confirmedAssignee == null && claimedAt == null
      && claimSeq == null && releasedAt == null) {
    return null;
  }
  return {
    assignees,
    assignee: item.assignee ?? assignees[0] ?? null,
    claimedAt,
    confirmedAssignee,
    confirmedAt: typeof item.confirmedAt === 'number' ? item.confirmedAt : null,
    confirmedBy: item.confirmedBy ?? null,
    confirmedSig: item.confirmedSig ?? null,
    claimSeq: claimSeq ?? 0,
    releasedAt,
    released: assignees.length === 0 && confirmedAssignee == null,   // no live claimant (open / revoked)
  };
}

/** The identity used for the deterministic first-come tiebreak. */
function claimantId(s) {
  return String(s.confirmedAssignee ?? s.assignee ?? s.assignees[0] ?? '');
}

/** Which of two claim states wins. */
function claimWinner(a, b) {
  // (0) Higher authoritative SEQUENCE wins — a transition that read the set claim (confirm/reassign/revoke)
  //     supersedes it. Concurrent writes from the SAME base tie here and fall through to first-come.
  if (a.claimSeq !== b.claimSeq) return a.claimSeq > b.claimSeq ? a : b;
  // (1) Tie on sequence (the concurrent case, e.g. the claim RACE). Safety-over-liveness: a RELEASE/revoke
  //     beats a live claim (deny wins), and two releases resolve by the later marker.
  if (a.released !== b.released) return a.released ? a : b;
  if (a.released && b.released) return (a.releasedAt ?? 0) >= (b.releasedAt ?? 0) ? a : b;
  // (2) two live claims at the same sequence → a confirmed claim beats a pending one
  const aC = a.confirmedAssignee != null;
  const bC = b.confirmedAssignee != null;
  if (aC !== bC) return aC ? a : b;
  // (3)/(4) same status → earliest relevant clock wins (first-come), tie broken deterministically by id
  const [ak, bk] = aC ? [a.confirmedAt, b.confirmedAt] : [a.claimedAt, b.claimedAt];
  const at = ak == null ? Infinity : ak;
  const bt = bk == null ? Infinity : bk;
  if (at !== bt) return at < bt ? a : b;
  return claimantId(a) >= claimantId(b) ? a : b;
}

/**
 * The winning claim cluster to OVERLAY onto the content winner, or null when neither side carries a claim
 * (non-task items are unaffected). See the rule above.
 * @param {object|null|undefined} local
 * @param {object} incoming
 * @returns {object|null}
 */
export function reconcileClaim(local, incoming) {
  const a = claimStateOf(local);
  const b = claimStateOf(incoming);
  if (!a && !b) return null;
  if (a && !b) return a;
  if (b && !a) return b;
  return claimWinner(a, b);
}

/** Replace the claim cluster of `base` with `bundle` (absent fields are deleted, so nothing stale lingers). */
export function applyClaimOverlay(base, bundle) {
  const out = { ...base };
  for (const f of CLAIM_FIELDS) delete out[f];
  if (bundle.claimSeq != null) out.claimSeq = bundle.claimSeq;
  if (bundle.released) {
    // A released/revoked transition: keep the sequence + the release marker, no live claimant.
    if (bundle.releasedAt != null) out.claimReleasedAt = bundle.releasedAt;
    return out;
  }
  if (bundle.assignees && bundle.assignees.length) {
    out.assignees = bundle.assignees;
    out.assignee = bundle.assignee ?? bundle.assignees[0];
  } else if (bundle.assignee != null) {
    out.assignees = [bundle.assignee];
    out.assignee = bundle.assignee;
  }
  if (bundle.claimedAt != null) out.claimedAt = bundle.claimedAt;
  if (bundle.confirmedAssignee != null) {
    out.confirmedAssignee = bundle.confirmedAssignee;
    if (bundle.confirmedAt != null) out.confirmedAt = bundle.confirmedAt;
    if (bundle.confirmedBy != null) out.confirmedBy = bundle.confirmedBy;
    if (bundle.confirmedSig != null) out.confirmedSig = bundle.confirmedSig;   // the attestation rides its claim
  }
  return out;
}

/** True iff two items carry the SAME claim cluster (used to keep an origin merge idempotent — no churn). */
export function claimClusterEqual(a, b) {
  const sa = claimStateOf(a);
  const sb = claimStateOf(b);
  if (!sa && !sb) return true;
  if (!sa || !sb) return false;
  return sa.assignee === sb.assignee
    && sa.claimedAt === sb.claimedAt
    && sa.confirmedAssignee === sb.confirmedAssignee
    && sa.confirmedAt === sb.confirmedAt
    && sa.confirmedBy === sb.confirmedBy
    && sa.confirmedSig === sb.confirmedSig
    && sa.claimSeq === sb.claimSeq
    && sa.releasedAt === sb.releasedAt
    && sa.assignees.length === sb.assignees.length
    && sa.assignees.every((x, i) => x === sb.assignees[i]);
}
