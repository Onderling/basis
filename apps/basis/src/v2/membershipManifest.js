/**
 * membershipManifest — the DECLARED contract for the membership lane's log entries.
 *
 * Same shape and role as `governanceManifest`: a cross-cutting plumbing manifest declaring which signed
 * statement kinds the membership lane of the device log carries. The rail refuses anything else at both
 * ends (append + verify-on-ingest). The acts themselves are the membership writers in `@onderling/circles`
 * (redeem → join, leaveGroup → leave, removeMember → evict); role changes ride the same lane when the
 * dynamic-authority slice lands.
 */

/** The device-log lane membership statements ride (system lane; EXEMPT from compaction — the roster must
 *  stay rebuildable from the log, so a membership statement never folds away). */
export const MEMBERSHIP_LANE = 'membership';

export const membershipManifest = Object.freeze({
  app: 'membership',
  itemTypes: [],
  nouns: {},
  operations: [
    { id: 'membership.create', description: "The circle's creation — the creator's self-signed first statement, and the root of its authority. Folds as founder only where the trail corroborates it (or where there is no trail yet, which is what a brand-new circle is).", appends: [{ lane: MEMBERSHIP_LANE, kind: 'create' }] },
    { id: 'membership.join',  description: 'A member joins (self-authored with redemption proof, or admin-authored).', appends: [{ lane: MEMBERSHIP_LANE, kind: 'join' }] },
    { id: 'membership.leave', description: 'A member leaves (self-authored only — the fold enforces author == subject).', appends: [{ lane: MEMBERSHIP_LANE, kind: 'leave' }] },
    { id: 'membership.evict', description: 'An admin removes a member (authority checked at the fold, deny-wins).',       appends: [{ lane: MEMBERSHIP_LANE, kind: 'evict' }] },
    { id: 'membership.role',  description: 'A role change (promote/demote — folds via the causal authority rules).',      appends: [{ lane: MEMBERSHIP_LANE, kind: 'role' }] },
    // Device revocation (the eviction machinery pointed INWARD): the member stays; ONE of their own
    // addresses is retired. Self-subject at the fold — the statement acts only on the author's own
    // row — and deny-wins: a revoked address never re-enters the set, whatever announces later.
    { id: 'membership.addressRevoke', description: "A member revokes one of their OWN device addresses (self-subject; deny-wins — the revoked address never re-enters the row's set).", appends: [{ lane: MEMBERSHIP_LANE, kind: 'address-revoke' }] },
    // Re-acceptance after a rules change: a member signs that they stand on the circle's CURRENT rules
    // version. Self-subject at the fold (nobody accepts on another's behalf); an older acceptance is
    // stale-but-valid, so this statement is always the member's own act, never an obligation the fold
    // enforces — rule churn must not become invisible exclusion.
    { id: 'membership.rulesAccept', description: "A member re-accepts the circle's current rules version (self-subject; supersedes the version on their signed join).", appends: [{ lane: MEMBERSHIP_LANE, kind: 'rules-accept' }] },
  ],
});

export default membershipManifest;
