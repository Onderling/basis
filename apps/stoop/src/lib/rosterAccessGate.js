/**
 * rosterAccessGate — who may read a circle's roster over the wire, and what of it they get.
 *
 * A roster reply is answered on THIS device. The gate therefore lives here, on the replying side:
 * a gate in the calling shell would sit on the asker's side of the trust boundary, and a peer holds
 * their own shell and can ask it anything. Two rules, both enforced where the data is:
 *
 *   1. A call from a FOREIGN caller — one whose acting webid is not this device's own — gets the
 *      roster only if they are themselves a member of THIS circle. A handshaked stranger is refused.
 *      A LOCAL call (this device's own shell, acting as our own webid) is our own view and passes
 *      unchanged.
 *   2. Even a member peer gets only what a member legitimately needs about another member — an
 *      ALLOWLIST of functional + released fields, never this device's private view of them.
 *
 * The allowlist is deliberate over a denylist: a denylist only strips the fields someone thought
 * of, and the leak arrives under the one they didn't (the same lesson the log redactor learned).
 *
 * NOTE on the local/foreign signal: the acting webid (`ctx.from`) equals the device's own
 * `localActor` for a local shell call, and differs for a real peer. This is the SAME signal every
 * other own-row-only stoop skill uses (`recordCircleAddressAnnouncement` etc.). It is NOT the
 * transport `_from`: the local shell reaches stoop as chatAgent→stoopAgent, which stamps a `_from`
 * of its own — so `_from` presence cannot tell local from foreign, but the acting webid can.
 */

/**
 * Fields a member peer may receive about another member: identity, the keys and address needed to
 * seal and route to them, their role AND how they came by it (governance is a member concern, and
 * "who runs this circle, and did anyone decide that" is the part of it a member reads), their
 * pseudonym floor, and their OWN release — the persona properties they chose to disclose to this
 * circle. Everything else (the local display cache `displayName`/`avatarUrl`, the viewer's "show me
 * names" preference, the viewer's relation/trust classification) is this device's private view and
 * never rides the wire.
 */
export const PEER_ROSTER_FIELDS = Object.freeze([
  'webid', 'id', 'pubKey', 'sealingPublicKey', 'circleAddress', 'circleAddressProof',
  // The member's full proven address SET (primary first) — same functional class as
  // `circleAddress`: a co-member needs every address the member answers on to route + seal to them.
  'circleAddresses',
  'role',
  // HOW an admin holds the role: `'founder'` · `'role'` (an admin promoted them) ·
  // `` `caretaker:<hash>` `` (nobody appointed them — the circle was left without an admin). It is a
  // projection of the same statements every member already folds for themselves, so it discloses
  // nothing new; leaving it out of the allowlist would simply strip it before any reader saw it.
  'adminVia',
  // …and whether that caretaker has signed for it. Same class as `adminVia` — derived from statements
  // the reader already folds — and it is the half a member actually acts on: an appointment nobody
  // has acknowledged is a circle whose new custodian may not know they have it.
  'adminViaAcknowledged',
  'handle', 'personaProperties',
]);

/**
 * True when the call came from a FOREIGN caller (a real peer), not this device's own shell.
 * Local ⇔ the acting webid is our own. Fail-open: with no `localActor` to compare against we cannot
 * positively identify a foreigner, so we do not gate — the gate strengthens where it can be sure,
 * and never refuses a call it cannot classify.
 */
export function rosterCallerIsForeign(caller, localActor) {
  return !!localActor && !!caller && caller !== localActor;
}

/** Is the verified remote caller a member of this circle's projected roster? */
export function callerIsCircleMember(scoped, callerId) {
  if (!callerId || !Array.isArray(scoped)) return false;
  // webid ≡ signing pubKey in basis; match either, so the gate holds whichever the transport carried.
  return scoped.some((m) => m?.webid === callerId || m?.id === callerId || m?.pubKey === callerId);
}

/** Project one roster row down to the peer allowlist. */
export function projectRosterRowForPeer(row) {
  const m = row && typeof row === 'object' ? row : {};
  const out = {};
  for (const k of PEER_ROSTER_FIELDS) if (m[k] != null) out[k] = m[k];
  return out;
}

/**
 * The whole decision for a REMOTE caller: refuse a non-member, else the allowlisted rows.
 * Returns `{ ok, members }` — `ok:false` means refuse (the skill answers `{members:[], reason}`).
 * Local calls never reach here; the skill returns its own full view for them.
 *
 * @param {object[]} scoped   the circle's projected roster (from `projectCircleRoster`)
 * @param {string}   callerId the transport-verified `_from`
 * @returns {{ok:boolean, members:object[]}}
 */
export function gateRosterReplyForPeer(scoped, callerId) {
  if (!callerIsCircleMember(scoped, callerId)) return { ok: false, members: [] };
  return { ok: true, members: (scoped ?? []).map(projectRosterRowForPeer) };
}
