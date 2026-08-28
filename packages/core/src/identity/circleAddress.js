// Identity step 3 — per-circle addresses (the unlinkability key layer).
//
// A DISTINCT key in each circle, so two circles (or any observer, whatever software they run)
// cannot correlate you by pubkey. Unlinkable-BY-DEFAULT; being "the same person" across circles is
// a deliberate linking act (present the profile's own key), never automatic.
//
// ── READ THE PARAMETER NAME CAREFULLY ────────────────────────────────────────────────────────────
// These take a DERIVATION SEED — "whatever root this device derives from" — NOT necessarily the
// profile's. The distinction is the whole point, and it hid for weeks behind the old parameter
// name, which asserted something false at every call site:
//
//   owner root ──deriveAgentSeed(profileId)──▶ profile seed ─┬──deriveCircleSeed(circleId)──▶ …
//                                                            └──deriveDeviceSeed(deviceId)──▶
//                                                               device seed ──deriveCircleSeed──▶ …
//
// An ENROLLED device passes its own device seed (see deviceDelegation.js), so it presents an
// honestly DISTINCT address per circle and the roster's address SET gains one entry per device. An
// UNENROLLED first device passes the profile's seed, so the two collapse. The live selection is one
// line in the basis agent: `deviceDerivationSeed = custodySeed ?? defaultProfileSeed`.
//
// So: same derivation seed + circleId → the same address, deterministically and recoverably. Two
// devices of one person do NOT agree unless both derive from the same root. Any consumer matching
// an author against a member must therefore read the roster's address SET, never the primary
// field alone.
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { AgentIdentity } from './AgentIdentity.js';

// HKDF domain-separation input (hashed, never displayed, never on the wire). Renaming it re-derives
// every per-circle address — a clean break, taken pre-launch (CLAUDE.md, 2026-07-28) rather than
// carrying the old spelling forever.
const HKDF_INFO_NS = 'onderling-identity-v1:';
// FIXED domain-separation salt — permanent, never change (would re-key every per-circle address).
const _CIRCLE_ADDR_SALT = new TextEncoder().encode('onderling-circle-addr-v1');
const _CIRCLE_ID_SALT   = new TextEncoder().encode('onderling-circle-id-v1');

/**
 * Derive a distinct 32-byte per-circle Ed25519 seed from a profile seed.
 * @param {Uint8Array} derivationSeed  this device's 32-byte derivation root: the profile's seed on an
 *   unenrolled device, the device seed (`deriveDeviceSeed`) on an enrolled one.
 * @param {string} circleId
 * @returns {Uint8Array} 32-byte seed.
 */
export function deriveCircleSeed(derivationSeed, circleId) {
  if (!(derivationSeed instanceof Uint8Array) || derivationSeed.length !== 32) {
    throw new Error('deriveCircleSeed: derivationSeed must be a 32-byte Uint8Array');
  }
  if (typeof circleId !== 'string' || circleId.length === 0) {
    throw new Error('deriveCircleSeed: circleId must be a non-empty string');
  }
  const info = new TextEncoder().encode(`${HKDF_INFO_NS}circle:${circleId}`);
  return hkdf(sha256, derivationSeed, _CIRCLE_ADDR_SALT, info, 32);
}

/**
 * The per-circle ADDRESS (pubKey) this device presents in a circle — vault-free, deterministic,
 * same encoding as `AgentIdentity.pubKey`.
 * @param {Uint8Array} derivationSeed  this device's derivation root — see the header.
 * @param {string} circleId
 * @returns {string} base64 pubKey.
 */
export function deriveCircleAddress(derivationSeed, circleId) {
  return AgentIdentity.pubKeyFromSeed(deriveCircleSeed(derivationSeed, circleId));
}

/**
 * The per-circle SIGNING identity — the AgentIdentity this device uses INSIDE a circle.
 * Its `pubKey` is the per-circle address (what the roster records + what peers route to); sign
 * circle messages with it so members/observers see an unrelated identity per circle. Deterministic
 * and re-derivable from the derivation seed, so `vault` may be ephemeral (a `VaultMemory`).
 *
 * @param {Uint8Array} derivationSeed  this device's derivation root — see the header.
 * @param {string} circleId
 * @param {import('./Vault.js').Vault} vault
 * @returns {Promise<AgentIdentity>}
 */
export function circleIdentity(derivationSeed, circleId, vault) {
  return AgentIdentity.fromSeed(deriveCircleSeed(derivationSeed, circleId), vault);
}

/**
 * A circle's IDENTITY — derived from the founder, never from what they typed.
 *
 * ── What this replaces, and why it is a security shape ───────────────────────────────────────────────
 * A circle's id used to be a slug of its NAME. Two people who both call their circle "Proeftuin" — or
 * "buurt", or "thuis" — therefore both hold `proeftuin`, and a device that learns of both MERGES them:
 * one circle, two unrelated groups of people, one roster. Found by walking it with Frits on 2026-08-27:
 * two independent peers created "Proeftuin" and both devices called it `proeftuin`, twenty minutes into
 * the first session with a person on the real UI.
 *
 * That is not untidiness. Membership is meant to have exactly one door — being admitted — and a
 * name-derived id adds a second: pick the right WORD and you are in someone's circle. Names are public,
 * guessable and often obvious ("buurt"), so the second door is not even narrow.
 *
 * ── Why derivation rather than a collision check ─────────────────────────────────────────────────────
 * A check detects the class; derivation makes it unrepresentable. Two founders collide only by finding
 * two inputs with one SHA-256 digest — the assumption every signature in this system already rests on.
 * Frits asked how we get to a 0% chance: there is no 0%, and this is the same "no" that key security
 * gives, which is the strongest honest answer available.
 *
 * The NAME is not lost — it stays what people read, and the id becomes what machines match. The two
 * were only ever conflated to save typing an identifier nobody looks at.
 *
 * ── Why the founder's device key, and not the per-circle key ─────────────────────────────────────────
 * The per-circle identity is derived FROM the circle id (`deriveCircleSeed` above), so it cannot also
 * produce it. The founder's own key can, and it carries the right meaning: this circle came from THIS
 * device, and nobody else's naming can reach it. The nonce keeps one founder's two circles distinct
 * even when they are made in the same second and named the same thing.
 *
 * @param {string} founderPubKey  the creating device's identity key (base64url)
 * @param {Uint8Array|string} nonce  fresh per creation — 16 random bytes is plenty
 * @param {number} [len=24]  hex characters to keep; 24 ≈ 96 bits
 * @returns {string} an opaque, stable circle id — lowercase hex, so it satisfies the id rules an
 *   id already had to satisfy (`isValidSlug`) and travels everywhere a slug travelled
 */
export function deriveCircleId(founderPubKey, nonce, len = 24) {
  if (typeof founderPubKey !== 'string' || !founderPubKey) {
    throw new Error('deriveCircleId: founderPubKey required — a circle id must come from its founder');
  }
  const enc = new TextEncoder();
  const nonceBytes = typeof nonce === 'string' ? enc.encode(nonce) : (nonce ?? new Uint8Array(0));
  if (!nonceBytes.length) {
    // A missing nonce would make one founder's circles collide with each other, which is the same
    // failure one layer in. Refuse rather than derive something quietly weaker.
    throw new Error('deriveCircleId: a nonce is required — without one a founder collides with themselves');
  }
  const material = new Uint8Array(_CIRCLE_ID_SALT.length + founderPubKey.length + nonceBytes.length);
  material.set(_CIRCLE_ID_SALT, 0);
  material.set(enc.encode(founderPubKey), _CIRCLE_ID_SALT.length);
  material.set(nonceBytes, _CIRCLE_ID_SALT.length + founderPubKey.length);
  // Lowercase HEX rather than base64url: an id has always had to satisfy `isValidSlug`
  // (`^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$`), and every place an id travels — a URL query, a store key, a
  // lane's `circleId` — was built for that shape. Keeping it means this change is the DERIVATION only,
  // with no second change riding along in what an id may look like.
  return [...sha256(material)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, len);
}
