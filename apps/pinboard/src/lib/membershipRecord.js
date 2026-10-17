/**
 * membershipRecord — the ONE record that binds a circle member's three key spaces so they move together.
 *
 * A member touches three independent key spaces, and before this helper each was read/rotated on its own,
 * from its own store:
 *   • signingPubKey  — the transport Ed25519 key (proofs + fan-out routing); lived in the MemberMap cache.
 *   • circleAddress  — the per-circle address (unlinkability); derived/stored separately.
 *   • sealingPubKey  — the group-key recipient key (at-rest sealing); lived in the control-agent roster.
 * They drifted: `circleMemberActors` resolved the SIGNING key from the (lossy) MemberMap while the SEALING
 * key came from the roster, so a member could be "present for signing, unresolved for sealing" — or the
 * reverse. A removal rotated the sealing group key in one place and dropped the MemberMap entry in another,
 * with no single record guaranteeing all three changed atomically.
 *
 * The durable `membership-redemption` trail ALREADY carries all three per (circle, member) — `deriveRoster`
 * projects them onto one roster row (`pubKey` = signing, `sealingPublicKey`, `circleAddress`). This helper
 * names that row as the ONE bound record: read the three keys FROM IT, and a join/leave/remove that acts on
 * the trail row moves all three together. There is no fourth source to fall out of step with.
 */

/**
 * Project a trail-derived roster row (or a control-agent roster entry) into the ONE bound membership record.
 * Tolerates the two roster shapes the codebase already holds:
 *   • the trail projection (`deriveRoster` / `listGroupMembers`) → `{ webid, pubKey, sealingPublicKey, circleAddress }`
 *   • the control-agent roster → `{ webId, publicKey }` (the group-key recipient / sealing key)
 *
 * @param {object|string} entry  a roster row (or a bare webid string)
 * @returns {{ webid: string|null, role: string, signingPubKey: string|null, circleAddress: string|null, sealingPubKey: string|null }}
 */
export function membershipRecord(entry) {
  if (typeof entry === 'string') {
    return { webid: entry, role: 'member', signingPubKey: null, circleAddress: null, sealingPubKey: null };
  }
  const e = entry && typeof entry === 'object' ? entry : {};
  return {
    webid:         e.webid ?? e.webId ?? e.id ?? null,
    role:          e.role === 'admin' ? 'admin' : (e.role ?? 'member'),
    // signing (transport / routing): the trail's `signingPublicKey`, projected onto the roster row as `pubKey`.
    signingPubKey: e.pubKey ?? e.signingPublicKey ?? null,
    // per-circle address (unlinkability).
    circleAddress: e.circleAddress ?? null,
    // sealing (at-rest group key): the trail's `sealingPublicKey`, or the control-agent roster's `publicKey`.
    sealingPubKey: e.sealingPublicKey ?? e.publicKey ?? null,
  };
}

/**
 * Project a whole roster into bound membership records, dropping rows with no webid. This is the single
 * projection any membership op (join/leave/remove) should read, so the three key spaces are never sourced
 * from three places that can drift.
 *
 * @param {Array<object|string>} roster
 * @returns {Array<ReturnType<typeof membershipRecord>>}
 */
export function membershipRecords(roster = []) {
  return (Array.isArray(roster) ? roster : [])
    .map(membershipRecord)
    .filter((r) => r.webid != null);
}

/**
 * True when the bound record has all three key spaces resolved — i.e. the member is reachable for signing
 * (routing), addressing, AND sealing at once. A `false` is the honest "not fully bound yet" signal (e.g. a
 * code-redeemer captured before a key exchange) — surface it, never fabricate a missing key.
 *
 * @param {ReturnType<typeof membershipRecord>} rec
 * @returns {boolean}
 */
export function keyspacesBound(rec) {
  return !!(rec && rec.signingPubKey && rec.circleAddress && rec.sealingPubKey);
}

export default membershipRecord;
