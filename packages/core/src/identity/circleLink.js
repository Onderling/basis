// circleLink.js — proof of control over a per-circle key, for cross-circle linkability.
//
// A joiner who chooses "continue as an existing self" presents the per-circle ADDRESS they
// already use in another circle (`deriveCircleAddress` — a pubkey). On its own that is only a
// CLAIM: any co-member of that circle has seen the address and could assert it. To make
// "same person" *provable* (not merely assertable), the joiner also signs a challenge with
// the SOURCE circle's identity (`circleIdentity` — the private key behind that address). The
// admin verifies the signature against the presented address before recording the linkage.
//
// The message binds the proof to THIS join (the joining groupId + the presented address), so
// a proof minted to join circle Y cannot be replayed to join circle Z, and a co-member who
// only knows the address cannot forge it (they lack the private key). No nonce is needed:
// the attacker can't sign, and a replay only re-asserts the same identity into the same
// circle (idempotent). See docs — NOTE-identity-and-linkability Decision B (signing proof).
import nacl from 'tweetnacl';
import { AgentIdentity } from './AgentIdentity.js';
import { deriveCircleSeed } from './circleAddress.js';
import { encode as b64encode } from '../crypto/b64.js';

/** The canonical challenge a linkable joiner signs. Deterministic; binds join + address. */
export function circleLinkMessage(groupId, address) {
  return `onderling-circle-link-v1|${String(groupId)}|${String(address)}`;
}

/**
 * Sign the link challenge with the SOURCE circle's identity → the base64url proof to present
 * alongside the address. `identity` is `circleIdentity(derivationSeed, sourceCircleId, vault)`.
 * @returns {string} base64url Ed25519 signature
 */
export function signCircleLink(identity, groupId, address) {
  return b64encode(identity.sign(circleLinkMessage(groupId, address)));
}

/**
 * Vault-free variant: sign the challenge straight from the profile seed + source circleId
 * (the per-circle signing key is seed-derived, so no vault is needed). The host binds this on
 * the redeem seam so a joiner can prove control of the address they present.
 * @returns {string} base64url Ed25519 signature over `circleLinkMessage(groupId, address)`
 */
export function signCircleLinkFromSeed(derivationSeed, circleId, groupId, address) {
  const kp = nacl.sign.keyPair.fromSeed(deriveCircleSeed(derivationSeed, circleId));
  return b64encode(nacl.sign.detached(new TextEncoder().encode(circleLinkMessage(groupId, address)), kp.secretKey));
}

/**
 * Verify a presented linkage: the proof must be a signature over the challenge by the private
 * key behind `address`. Deny-by-default — anything missing or malformed is `false`.
 * @param {{groupId:string, address:string, proof:string}} a
 * @returns {boolean}
 */
export function verifyCircleLink({ groupId, address, proof } = {}) {
  if (!groupId || typeof address !== 'string' || !address || typeof proof !== 'string' || !proof) return false;
  try { return AgentIdentity.verify(circleLinkMessage(groupId, address), proof, address); }
  catch { return false; }
}
