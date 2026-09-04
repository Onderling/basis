// ceremonyCommitment.js — WHO may retire a member's device address in a circle: the owner root, and only
// at a ceremony.
//
// A member's roster row carries a per-circle COMMITMENT to the owner root, `H(rootPubKey ‖ circleId)`.
// Every one of the person's devices can produce it at join or announce time — the root's public key is
// public and rides in each device's delegation record — but none of them can USE it: a ceremony
// statement (`address-revoke`) carries a REVEAL, the root's public key plus a signature by the root
// over the statement's binding facts, and the root exists only inside a ceremony, reconstructed from the
// typed phrase and never resident. A stolen device, enrolled or not, therefore holds nothing that can
// revoke a sibling, and there is no window between a join and "the next ceremony".
//
// The commitment is per circle and pre-image resistant, so two circles cannot correlate a person by it.
// What a revocation reveals — the root public key — is seen by that circle's members only; someone who
// sits in two of the person's circles and witnesses a revocation in both can link them. Stated cost.
//
// The commitment is DECLARED by the member's device and signed with the circle key the address proves
// (`signCeremonyCommitment`), so a carrier relaying a member's announcement cannot substitute one.
import nacl from 'tweetnacl';
import { sha256 } from '@noble/hashes/sha2.js';
import { encode as b64encode, decode as b64decode } from '../crypto/b64.js';

const COMMIT_DOMAIN = 'onderling-ceremony-commitment-v1';
const REVEAL_DOMAIN = 'onderling-ceremony-reveal-v1';
const DECLARE_DOMAIN = 'onderling-ceremony-commitment-declare-v1';

const hex = (bytes) => { let s = ''; for (const b of bytes) s += b.toString(16).padStart(2, '0'); return s; };

/** The per-circle commitment to an owner root. `rootPubKeyB64` is the root's Ed25519 pubkey as b64 (the delegation record's `by`). */
export function ceremonyCommitment(rootPubKeyB64, circleId) {
  if (typeof rootPubKeyB64 !== 'string' || !rootPubKeyB64) throw new Error('ceremonyCommitment: rootPubKeyB64 required');
  if (typeof circleId !== 'string' || !circleId) throw new Error('ceremonyCommitment: circleId required');
  return hex(sha256(new TextEncoder().encode(`${COMMIT_DOMAIN}|${rootPubKeyB64}|${circleId}`)));
}

/** The root's pubkey in the encoding every commitment and reveal uses. */
export function rootPubKeyB64Of(rootSecret) {
  return b64encode(nacl.sign.keyPair.fromSeed(rootSecret).publicKey);
}

/** The statement a reveal signs — the binding facts of ONE revocation, so a reveal cannot be replayed onto another subject or circle. */
export function ceremonyRevealMessage({ circleId, kind, subject, authorRef }) {
  return `${REVEAL_DOMAIN}|${String(circleId)}|${String(kind)}|${String(subject)}|${String(authorRef)}`;
}

/**
 * Mint the reveal for a ceremony statement. Called where the root is transiently in hand.
 * @returns {{ rootPubKey: string, sig: string }}
 */
export function signCeremonyReveal(rootSecret, { circleId, kind, subject, authorRef } = {}) {
  if (!(rootSecret instanceof Uint8Array) || rootSecret.length !== 32) throw new Error('signCeremonyReveal: rootSecret must be a 32-byte Uint8Array');
  if (!circleId || !kind || !subject || !authorRef) throw new Error('signCeremonyReveal: circleId, kind, subject and authorRef are required');
  const kp = nacl.sign.keyPair.fromSeed(rootSecret);
  const msg = new TextEncoder().encode(ceremonyRevealMessage({ circleId, kind, subject, authorRef }));
  return { rootPubKey: b64encode(kp.publicKey), sig: b64encode(nacl.sign.detached(msg, kp.secretKey)) };
}

/**
 * Verify a reveal against a row's commitment. Deny-by-default: no reveal, no commitment, a key that does not
 * hash to the commitment, or a signature that does not cover these exact facts → false.
 */
export function verifyCeremonyReveal(reveal, { circleId, kind, subject, authorRef, commitment } = {}) {
  try {
    if (!reveal || typeof reveal.rootPubKey !== 'string' || typeof reveal.sig !== 'string') return false;
    if (typeof commitment !== 'string' || !commitment) return false;
    if (ceremonyCommitment(reveal.rootPubKey, circleId) !== commitment) return false;
    const msg = new TextEncoder().encode(ceremonyRevealMessage({ circleId, kind, subject, authorRef }));
    const key = b64decode(reveal.rootPubKey);
    const sig = b64decode(reveal.sig);
    if (key.length !== 32 || sig.length !== 64) return false;
    return nacl.sign.detached.verify(msg, sig, key);
  } catch { return false; }
}

/** The declaration a device signs with its per-circle key when it announces a commitment for its address. */
export function ceremonyCommitmentDeclaration({ circleId, circleAddress, commitment }) {
  return `${DECLARE_DOMAIN}|${String(circleId)}|${String(circleAddress)}|${String(commitment)}`;
}

/** Sign the declaration with a per-circle seed (the same key the address proves). Returns b64. */
export function signCeremonyCommitmentFromSeed(circleSeed, { circleId, circleAddress, commitment } = {}) {
  const kp = nacl.sign.keyPair.fromSeed(circleSeed);
  const msg = new TextEncoder().encode(ceremonyCommitmentDeclaration({ circleId, circleAddress, commitment }));
  return b64encode(nacl.sign.detached(msg, kp.secretKey));
}

/** Verify a declared commitment against the (proven) circle address that declared it. */
export function verifyCeremonyCommitmentDeclaration({ circleId, circleAddress, commitment, proof } = {}) {
  try {
    if (typeof commitment !== 'string' || !commitment || typeof proof !== 'string' || !proof) return false;
    const msg = new TextEncoder().encode(ceremonyCommitmentDeclaration({ circleId, circleAddress, commitment }));
    const key = b64decode(circleAddress); const sig = b64decode(proof);
    if (key.length !== 32 || sig.length !== 64) return false;
    return nacl.sign.detached.verify(msg, sig, key);
  } catch { return false; }
}
