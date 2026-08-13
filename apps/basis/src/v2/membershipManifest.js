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
    { id: 'membership.join',  description: 'A member joins (self-authored with redemption proof, or admin-authored).', appends: [{ lane: MEMBERSHIP_LANE, kind: 'join' }] },
    { id: 'membership.leave', description: 'A member leaves (self-authored only — the fold enforces author == subject).', appends: [{ lane: MEMBERSHIP_LANE, kind: 'leave' }] },
    { id: 'membership.evict', description: 'An admin removes a member (authority checked at the fold, deny-wins).',       appends: [{ lane: MEMBERSHIP_LANE, kind: 'evict' }] },
    { id: 'membership.role',  description: 'A role change (promote/demote — folds via the causal authority rules).',      appends: [{ lane: MEMBERSHIP_LANE, kind: 'role' }] },
    // Device revocation (the eviction machinery pointed INWARD): the member stays; ONE of their own
    // addresses is retired. Self-subject at the fold — the statement acts only on the author's own
    // row — and deny-wins: a revoked address never re-enters the set, whatever announces later.
    { id: 'membership.addressRevoke', description: "A member revokes one of their OWN device addresses (self-subject; deny-wins — the revoked address never re-enters the row's set).", appends: [{ lane: MEMBERSHIP_LANE, kind: 'address-revoke' }] },
  ],
});

export default membershipManifest;
