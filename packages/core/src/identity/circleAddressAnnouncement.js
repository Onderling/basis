// circleAddressAnnouncement.js — telling a circle which address you answer on, provably.
//
// ── The gap this closes ─────────────────────────────────────────────────────────────────────────
// Every member has a DIFFERENT address in every circle (`deriveCircleAddress(profileSeed, circleId)`).
// A join teaches exactly two devices about each other: the joiner presents + proves its per-circle
// address to the admin (`verifyMembershipCodeForPeer`), and the admin's proven address rides back on
// the redeem response (`recordRemoteRedemption`). Nothing ever taught two JOINERS each other's
// address — so in a circle of three, admin↔joiner delivery worked and joiner↔joiner silently did not
// (with the per-user global-address fallback off, which is the default, the send is refused outright
// rather than downgraded). It reads as "messages sometimes don't arrive".
//
// An ANNOUNCEMENT is the missing fact, in the smallest shape that can be believed by someone who was
// not present at the join:
//
//     { circleId, memberWebid, circleAddress, circleAddressProof }
//
// ── Why it needs no new proof primitive ─────────────────────────────────────────────────────────
// `circleAddressProof` is exactly what a join already carries: a signature by the key BEHIND the
// address over `circleLinkMessage(circleId, address)` — `signCircleLink` / `signCircleLinkFromSeed`,
// verified with the deny-by-default `verifyCircleLink`. Re-proving in place is deliberately no new
// power (Q1, 2026-07-31): re-joining the circle would achieve the same thing at the cost of history
// and standing, for identical security. One operation therefore covers re-announcing, and is the
// precondition for signed key handover later.
//
// ── Why the proof makes it RELAYABLE, which is the whole point ──────────────────────────────────
// The proof is verifiable by anyone who holds the announcement — it is bound to the address and the
// circle, not to the connection it arrived on. So a member who cannot yet reach a peer directly (the
// exact situation this fixes) can have the circle's admin CARRY their announcement, without the
// admin becoming someone who has to be trusted about the address: a carrier who alters the address
// invalidates the proof, and a carrier who invents one cannot sign it.
//
// ── What the proof does NOT bind, stated rather than implied ────────────────────────────────────
// It binds {circle, address}. It does NOT bind `memberWebid` — so a carrier can still assert that a
// (genuinely proven) address belongs to a DIFFERENT member of the same circle, which would send that
// member's messages to the wrong co-member. Two reasons it is left this way, both deliberate:
//
//   • Binding the webid into the signed message would change `circleLinkMessage`, i.e. the join
//     proof's wire format, for every existing peer.
//   • Signing a per-circle address with the CANONICAL key (the other obvious binding) would mint
//     transferable, cryptographic evidence that one person holds both — which is precisely the
//     linkage per-circle addressing exists to prevent. The roster's plaintext claim is a claim to
//     the circle; a signature is proof to the world.
//
// The residual trust is therefore the same trust the roster already places in whoever admitted the
// member, and no more. Recorded in `plans/DECISIONS-FOR-REVIEW.md` (2026-08-02).
import { signCircleLink, signCircleLinkFromSeed, verifyCircleLink } from './circleLink.js';
import { deriveCircleAddress } from './circleAddress.js';

/**
 * The ONE name for this signal — the peer wire subtype AND the fan-out `kind`. One string, imported
 * by the substrate that fans it and the app that receives it, so the two cannot drift.
 */
export const CIRCLE_ADDRESS_ANNOUNCE_KIND = 'circle-address-announce';

/**
 * Shape one announcement — a WHITELIST, like `rosterUpdatedPayload`: anything a caller passes that
 * is not one of these four fields is dropped here, at the boundary, rather than travelling.
 *
 * @param {object} a
 * @param {string} a.circleId
 * @param {string} a.memberWebid          whose address this is (the member's canonical signing key)
 * @param {string} a.circleAddress        the address they answer on IN THIS CIRCLE
 * @param {string} a.circleAddressProof   `signCircleLink(circleIdentity, circleId, circleAddress)`
 * @returns {{circleId: string, memberWebid: string, circleAddress: string, circleAddressProof: string}}
 */
export function circleAddressAnnouncement({
  circleId, memberWebid, circleAddress, circleAddressProof,
} = {}) {
  const s = (v) => (typeof v === 'string' ? v : '');
  return {
    circleId:           s(circleId),
    memberWebid:        s(memberWebid),
    circleAddress:      s(circleAddress),
    circleAddressProof: s(circleAddressProof),
  };
}

/**
 * Mint this device's own announcement for one circle, from the seams every host already exposes.
 *
 * Deny-by-default in the OUTBOUND direction too: an address this device cannot sign for is not
 * announced at all, rather than announced unproven for a receiver to drop.
 *
 * @param {object} a
 * @param {string} a.circleId
 * @param {string} a.memberWebid
 * @param {(circleId: string) => (string|null)} a.circleAddressFor
 * @param {(circleId: string, address: string) => (string|null)} a.signCircleAddress
 * @returns {{circleId, memberWebid, circleAddress, circleAddressProof}|null}
 */
export function ownCircleAddressAnnouncement({
  circleId, memberWebid, circleAddressFor, signCircleAddress,
} = {}) {
  if (typeof circleAddressFor !== 'function' || typeof signCircleAddress !== 'function') return null;
  if (typeof circleId !== 'string' || !circleId) return null;
  if (typeof memberWebid !== 'string' || !memberWebid) return null;
  try {
    const circleAddress = circleAddressFor(circleId);
    if (typeof circleAddress !== 'string' || !circleAddress) return null;
    const circleAddressProof = signCircleAddress(circleId, circleAddress);
    if (typeof circleAddressProof !== 'string' || !circleAddressProof) return null;
    return circleAddressAnnouncement({ circleId, memberWebid, circleAddress, circleAddressProof });
  } catch {
    return null;   // no signable address → announce nothing, exactly as `ownProvenCircleAddress` does
  }
}

/**
 * Vault-free variant for a caller that holds the profile seed itself (a host without the agent
 * seams, a test). Same output, same deny-by-default.
 *
 * @param {object} a
 * @param {Uint8Array} a.profileSeed
 * @param {string} a.circleId
 * @param {string} a.memberWebid
 * @param {string} [a.circleAddress]  defaults to the address the seed derives for this circle
 * @returns {{circleId, memberWebid, circleAddress, circleAddressProof}|null}
 */
export function ownCircleAddressAnnouncementFromSeed({
  profileSeed, circleId, memberWebid, circleAddress = null,
} = {}) {
  if (!profileSeed || typeof circleId !== 'string' || !circleId) return null;
  try {
    const address = circleAddress ?? deriveCircleAddress(profileSeed, circleId);
    if (typeof address !== 'string' || !address) return null;
    const proof = signCircleLinkFromSeed(profileSeed, circleId, circleId, address);
    return circleAddressAnnouncement({
      circleId, memberWebid, circleAddress: address, circleAddressProof: proof,
    });
  } catch {
    return null;
  }
}

/**
 * Verify ONE announcement. Deny-by-default: anything missing, malformed, or whose proof does not
 * check out against the address itself returns `null` — never a partial record a caller might store.
 *
 * The `circleId` a caller is EXPECTING is passed separately on purpose. An announcement's proof is
 * bound to the circle it names, so an announcement for circle Y that arrives on circle X's fan is
 * cryptographically valid and still wrong; requiring the caller to say which circle it asked about
 * is what makes that a refusal rather than a cross-circle write.
 *
 * @param {object} announcement
 * @param {string} [expectedCircleId]  when given, the announcement must name exactly this circle
 * @returns {{circleId, memberWebid, circleAddress, circleAddressProof}|null}
 */
export function verifyCircleAddressAnnouncement(announcement, expectedCircleId = null) {
  const a = circleAddressAnnouncement(announcement ?? {});
  if (!a.circleId || !a.memberWebid || !a.circleAddress || !a.circleAddressProof) return null;
  if (expectedCircleId != null && a.circleId !== expectedCircleId) return null;
  const proven = verifyCircleLink({
    groupId: a.circleId,
    address: a.circleAddress,
    proof:   a.circleAddressProof,
  });
  return proven ? a : null;
}

/**
 * Verify a LIST, keeping only what checks out. A malformed neighbour never costs a valid
 * announcement its delivery — the same best-effort-per-row discipline `bindCircleAddressKeys` uses,
 * for the same reason: a half-applied batch produces "some people can be messaged and some cannot"
 * with no visible cause.
 *
 * @param {Array<object>} announcements
 * @param {string} [expectedCircleId]
 * @returns {Array<{circleId, memberWebid, circleAddress, circleAddressProof}>}
 */
export function verifyCircleAddressAnnouncements(announcements, expectedCircleId = null) {
  const out = [];
  for (const one of Array.isArray(announcements) ? announcements : []) {
    const ok = verifyCircleAddressAnnouncement(one, expectedCircleId);
    if (ok) out.push(ok);
  }
  return out;
}

// Re-exported so a caller that mints announcements does not also have to reach into `circleLink.js`
// for the signer — the two are one operation from the outside.
export { signCircleLink, verifyCircleLink };
