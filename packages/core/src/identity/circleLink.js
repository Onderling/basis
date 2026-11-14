// circleLink.js — proof of control over a per-circle key, for cross-circle linkability.
//
// A joiner who chooses "continue as an existing self" presents the per-circle ADDRESS they
// already use in another circle (`deriveCircleAddress` — a pubkey). On its own that is only a
// CLAIM: any co-member of that circle has seen the address and could assert it. To make
// "same person" *provable* (not merely assertable), the joiner also signs a challenge with
// the SOURCE circle's identity (`circleIdentity` — the private key behind that address). The
// admin verifies the signature against the presented address before recording the linkage.
//
// The message binds the proof to THIS circle, the presented address AND the member presenting it (their identity in
// this circle), so a proof minted to join circle Y cannot be replayed to join circle Z, a co-member who only knows the
// address cannot forge it (they lack the private key), and a co-member who COPIES a valid proof cannot use it for
// themselves (it names the other member). The earlier message (circle + address) assumed a replay only re-asserted the
// same identity; a replay by another member attached the address to them. See NOTE-identity-and-linkability Decision B.
import nacl from 'tweetnacl';
import { exactVerdictKey, processSignatureMemo, processVerdictMemo } from '../security/signatureMemo.js';
import { deriveCircleSeed } from './circleAddress.js';
import { encode as b64encode } from '../crypto/b64.js';

/**
 * The canonical challenge a link proof signs: the circle, the address AND THE MEMBER whose address it is in that circle
 * (their identity there). Without the member, a proof said only "whoever holds this address's key linked it to this
 * circle", and a member could put a copy of another member's address and proof on their own roster row (the roster then
 * showed it as the copier's device, and a device bound it to the copier as a person). v1 (circle + address) is refused.
 */
export function circleLinkMessage(groupId, address, memberRef) {
  return `onderling-circle-link-v2|${String(groupId)}|${String(address)}|${String(memberRef)}`;
}

/**
 * Sign the link challenge with the SOURCE circle's identity → the base64url proof to present
 * alongside the address. `identity` is `circleIdentity(derivationSeed, sourceCircleId, vault)`.
 * @returns {string} base64url Ed25519 signature
 */
export function signCircleLink(identity, groupId, address, memberRef) {
  if (typeof memberRef !== 'string' || !memberRef) throw new Error('signCircleLink: the member (memberRef) is required');
  return b64encode(identity.sign(circleLinkMessage(groupId, address, memberRef)));
}

/**
 * Vault-free variant: sign the challenge straight from the profile seed + source circleId
 * (the per-circle signing key is seed-derived, so no vault is needed). The host binds this on
 * the redeem seam so a joiner can prove control of the address they present.
 * @returns {string} base64url Ed25519 signature over `circleLinkMessage(groupId, address)`
 */
export function signCircleLinkFromSeed(derivationSeed, circleId, groupId, address, memberRef) {
  if (typeof memberRef !== 'string' || !memberRef) throw new Error('signCircleLinkFromSeed: the member (memberRef) is required');
  const kp = nacl.sign.keyPair.fromSeed(deriveCircleSeed(derivationSeed, circleId));
  return b64encode(nacl.sign.detached(new TextEncoder().encode(circleLinkMessage(groupId, address, memberRef)), kp.secretKey));
}

/**
 * Verify a presented linkage: the proof must be a signature over the challenge by the private
 * key behind `address`. Deny-by-default — anything missing or malformed is `false`.
 * @param {{groupId:string, address:string, proof:string, verifySignature?: (msg: string, sig: string, pubKey: string) => boolean}} a
 *   `verifySignature` — the pure signature check, default the process's memo under the name 'circle-link'
 * @returns {boolean}
 */
export function verifyCircleLink({ groupId, address, memberRef, proof, verifySignature, verdictMemo } = {}) {
  // the member is the ROW's subject as the verifier knows it (the redeem's requester, the announcement's member on this
  // device's roster), never a field that travels with the proof; no member, no pass
  if (!groupId || typeof address !== 'string' || !address || typeof proof !== 'string' || !proof
    || typeof memberRef !== 'string' || !memberRef) return false;
  // A pass for exactly these three is remembered (the process's verdict memo unless the caller brings its own check):
  // a roster re-derivation asks the same proofs again and again. Never a refusal.
  const memo = verdictMemo ?? (verifySignature ? null : processVerdictMemo('circle-link'));
  // the exact inputs (never coerced: an id that is not a string keys apart, or not at all)
  const key = memo ? exactVerdictKey([groupId, address, memberRef, proof]) : null;
  if (key && memo.has(key)) return true;
  const check = verifySignature ?? processSignatureMemo().verifierFor('circle-link');
  let good = false;
  try { good = check(circleLinkMessage(groupId, address, memberRef), proof, address) === true; }
  catch { good = false; }
  if (good && key) memo.remember(key);
  if (!good && earlierListener) noteIfEarlier(groupId, address, proof, check);
  return good;
}

/**
 * THE EARLIER PROOF SAYS SO. A proof signed over the earlier message (circle + address, no member) is refused like any
 * other; a device whose circles were made before the member was named loses every address in them, and without a word
 * only the screen would show it. When a listener is set (the app's refusal log), a refused proof is checked once more
 * against the earlier message, and a match is reported: no circle id, no address, only that it happened.
 */
let earlierListener = null;
/** @param {(() => void)|null} fn  called once per refused proof that the earlier message verifies */
export function onEarlierCircleLink(fn) { earlierListener = typeof fn === 'function' ? fn : null; }
function noteIfEarlier(groupId, address, proof, check) {
  try {
    if (check(`onderling-circle-link-v1|${String(groupId)}|${String(address)}`, proof, address) === true) earlierListener();
  } catch { /* a report never breaks a check */ }
}
