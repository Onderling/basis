/**
 * rosterAccessGate — who may read a circle's roster over the wire, and what of it they get.
 *
 * A roster reply is answered on THIS device. The gate therefore lives here, on the replying side:
 * a gate in the calling shell would sit on the asker's side of the trust boundary, and a peer holds
 * their own shell and can ask it anything. Two rules, both enforced where the data is:
 *
 *   1. A REMOTE caller (one the transport verified — it carries a `_from`) gets the roster only if
 *      they are themselves a member of THIS circle. A handshaked stranger is refused. A LOCAL call
 *      (this device's own shell, no `_from`) is our own view and passes unchanged.
 *   2. Even a member peer gets only what a member legitimately needs about another member — an
 *      ALLOWLIST of functional + released fields, never this device's private view of them.
 *
 * The allowlist is deliberate over a denylist: a denylist only strips the fields someone thought
 * of, and the leak arrives under the one they didn't (the same lesson the log redactor learned).
 */

/**
 * Fields a member peer may receive about another member: identity, the keys and address needed to
 * seal and route to them, their role (governance is a member concern), their pseudonym floor, and
 * their OWN release — the persona properties they chose to disclose to this circle. Everything else
 * (the local display cache `displayName`/`avatarUrl`, the viewer's "show me names" preference, the
 * viewer's relation/trust classification) is this device's private view and never rides the wire.
 */
export const PEER_ROSTER_FIELDS = Object.freeze([
  'webid', 'id', 'pubKey', 'sealingPublicKey', 'circleAddress', 'circleAddressProof',
  'role', 'handle', 'personaProperties',
]);

/** True when the call came from a transport-verified peer (vs this device's own shell). */
export function rosterCallerIsRemote(ctx) {
  return !!(ctx?.envelope && ctx.envelope._from);
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
